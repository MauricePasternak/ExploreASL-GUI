/** Exact native processing protocol and presentation-only progress events. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  LockCreatedPayloadSchema,
  LockRemovedPayloadSchema,
  ProcessingLifecycleSnapshotSchema,
  ProcessingRunSnapshotSchema,
  ProcessingRequestSchema,
  ProcessingReservationSchema,
  StatusFileCreatedPayloadSchema,
  PROCESSING_MODULES,
  type ProcessingRequest,
  type ProcessingRunSnapshot,
  type SubjectInfo,
  type SubjectModuleStatus,
} from "../schemas/processingSchemas";
import { aslRunsEqual, normalizeAslRunId } from "./aslRun";
import { captureProjectLease, isCurrentProjectLease } from "./projectLifecycle";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { reconcileProcessingTerminal } from "./processingTerminalCoordinator";

export type {
  LockCreatedPayload,
  LockRemovedPayload,
  ProcessingRunSnapshot,
  StatusFileCreatedPayload,
} from "../schemas/processingSchemas";

const RUST_MODULE_MAP: Record<string, (typeof PROCESSING_MODULES)[number]> = {
  xASL_module_Structural: "structural",
  xASL_module_ASL: "asl",
  xASL_module_Population: "population",
};

function mapModuleName(rustName: string): (typeof PROCESSING_MODULES)[number] | undefined {
  if (rustName in RUST_MODULE_MAP) return RUST_MODULE_MAP[rustName];
  if ((PROCESSING_MODULES as readonly string[]).includes(rustName)) {
    return rustName as (typeof PROCESSING_MODULES)[number];
  }
  return undefined;
}

export async function reserveProcessingRun(request: ProcessingRequest, projectRoot: string) {
  return ProcessingReservationSchema.parse(
    await invoke("reserve_processing_run", {
      request: ProcessingRequestSchema.parse(request),
      admission: { projectRoot },
    }),
  );
}
export async function getActiveRun(): Promise<ProcessingRunSnapshot | null> {
  const raw = await invoke<unknown>("get_active_run");
  return raw == null ? null : ProcessingRunSnapshotSchema.parse(raw);
}
export async function attachRun(runId: string) {
  return ProcessingRunSnapshotSchema.parse(await invoke("attach_run", { runId }));
}
export async function runProcessingPipeline(runId: string) {
  return ProcessingRunSnapshotSchema.parse(await invoke("run_pipeline", { runId }));
}
export async function stopProcessingPipeline(runId: string) {
  return ProcessingRunSnapshotSchema.parse(await invoke("kill_pipeline", { runId }));
}
export async function confirmProcessingWorkersStopped(runId: string, revision: number) {
  const snapshot = ProcessingRunSnapshotSchema.parse(
    await invoke("confirm_processing_workers_stopped", { runId, revision }),
  );
  if (snapshot.runId !== runId || snapshot.revision <= revision) {
    throw new Error("Processing confirmation returned a stale snapshot");
  }
  return snapshot;
}
export async function loadSubjects(
  projectRoot: string,
  dataSource?: "dicom" | "bids",
): Promise<SubjectInfo[]> {
  return invoke<SubjectInfo[]>("list_subjects", { projectRoot, dataSource: dataSource ?? null });
}

export async function loadLockStatus(projectRoot: string): Promise<SubjectModuleStatus[]> {
  const raw = await invoke<SubjectModuleStatus[]>("read_lock_status", { projectRoot });
  return raw
    .map((entry) => {
      const module = mapModuleName(entry.module as string);
      if (!module) return null;
      return {
        ...entry,
        subjectSession: entry.subjectSession ?? "",
        module,
        run: entry.run != null ? normalizeAslRunId(entry.run) : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null) as SubjectModuleStatus[];
}

function isAttachedRunCurrent(runId: string, lease: ReturnType<typeof captureProjectLease>) {
  const state = useProcessingStore.getState();
  return Boolean(
    lease &&
    isCurrentProjectLease(lease) &&
    state.attachmentGeneration === lease.generation &&
    (state.activeRunId === runId || state.terminalRunId === runId),
  );
}

/** Only accepted current snapshots may trigger exact terminal persistence. */
export async function projectProcessingSnapshot(
  snapshot: ProcessingRunSnapshot,
  lease = captureProjectLease(),
): Promise<void> {
  if (!isAttachedRunCurrent(snapshot.runId, lease)) return;
  const previous = useProcessingStore.getState().snapshot;
  useProcessingStore.getState().reconcileRunSnapshot(snapshot);
  const state = useProcessingStore.getState();
  if (
    state.snapshot?.revision !== snapshot.revision ||
    state.snapshot.runId !== snapshot.runId ||
    !state.terminalRunId
  ) {
    if (
      state.snapshot?.revision === snapshot.revision &&
      snapshot.populationExecutionCommitted &&
      !previous?.populationExecutionCommitted
    )
      await useProjectStore.getState().refreshProject();
    return;
  }
  await reconcileProcessingTerminal(lease);
}

/** Install callbacks bound to both one project lease and one native run. */
export async function setupProcessingListeners(runId: string): Promise<() => void> {
  if (!runId) throw new Error("Processing listeners require a run ID");
  const lease = captureProjectLease();
  let disposed = false;
  const cleanups: (() => void)[] = [];
  async function subscribe(name: string, callback: (event: { payload: unknown }) => void) {
    const cleanup = await listen<unknown>(name, callback);
    cleanups.push(cleanup);
    return cleanup;
  }
  const admitted = <T>(
    schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
    value: unknown,
  ): T | null => {
    const parsed = schema.safeParse(value);
    if (!parsed.success || disposed || !isAttachedRunCurrent(runId, lease)) return null;
    const payload = parsed.data! as T & { runId: string };
    return payload.runId === runId ? (payload as T) : null;
  };

  try {
    const unlistenStatus = await subscribe("StatusFileCreated", (event) => {
      const payload = admitted(StatusFileCreatedPayloadSchema, event.payload);
      if (!payload) return;
      const module = mapModuleName(payload.module);
      if (!module) return;
      const normalizedRun = payload.run != null ? normalizeAslRunId(payload.run) : undefined;
      const store = useProcessingStore.getState();
      const existing = store.subjectStatuses.find(
        (status) =>
          status.subjectSession === (payload.subjectSession ?? "") &&
          status.module === module &&
          aslRunsEqual(status.run, normalizedRun),
      );
      const complete = payload.stepCode === "999_ready";
      if (existing?.status === "complete" && !complete) return;
      store.updateSubjectStatus({
        subjectSession: payload.subjectSession ?? "",
        module,
        run: normalizedRun,
        status: complete ? "complete" : "incomplete",
        completedSteps: existing
          ? complete
            ? existing.completedSteps
            : [...new Set([...existing.completedSteps, payload.stepCode])]
          : complete
            ? []
            : [payload.stepCode],
        locked: complete ? false : (existing?.locked ?? false),
      });
    });

    const updateLock =
      (
        schema: typeof LockCreatedPayloadSchema | typeof LockRemovedPayloadSchema,
        locked: boolean,
      ) =>
      (event: { payload: unknown }) => {
        const payload = admitted(schema, event.payload);
        if (!payload) return;
        const module = mapModuleName(payload.module);
        if (!module) return;
        const normalizedRun = payload.run != null ? normalizeAslRunId(payload.run) : undefined;
        const store = useProcessingStore.getState();
        const existing = store.subjectStatuses.find(
          (status) =>
            status.subjectSession === (payload.subjectSession ?? "") &&
            status.module === module &&
            aslRunsEqual(status.run, normalizedRun),
        );
        if (!existing && !locked) return;
        if (existing?.status === "complete" && locked) return;
        store.updateSubjectStatus({
          subjectSession: payload.subjectSession ?? "",
          module,
          run: normalizedRun,
          status: existing?.status ?? "pending",
          completedSteps: existing?.completedSteps ?? [],
          locked,
        });
      };
    const unlistenLock = await subscribe("LockCreated", updateLock(LockCreatedPayloadSchema, true));
    const unlistenLockRemoved = await subscribe(
      "LockRemoved",
      updateLock(LockRemovedPayloadSchema, false),
    );
    const unlistenLifecycle = await subscribe("ProcessingLifecycleSnapshot", (event) => {
      const payload = admitted(ProcessingLifecycleSnapshotSchema, event.payload);
      if (!payload) return;
      void projectProcessingSnapshot(payload, lease).catch(() => undefined);
    });

    return () => {
      disposed = true;
      unlistenStatus();
      unlistenLock();
      unlistenLockRemoved();
      unlistenLifecycle();
    };
  } catch (error) {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
    throw error;
  }
}

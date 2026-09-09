/** Native import-run protocol clients and run-scoped diagnostic listeners. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

import type { ExecutionProfile } from "../schemas/executionProfile";
import {
  ImportRunSnapshotSchema,
  type ImportRunSnapshot,
  type StagingEntry,
} from "../schemas/importSchemas";
import { captureProjectLease, isCurrentProjectLease, type ProjectLease } from "./projectLifecycle";
import { reconcileImportTerminal } from "./importTerminalCoordinator";
import { useImportStore } from "../stores/importStore";

let activeListenerCleanup: (() => void) | null = null;
let listenerSetupGeneration = 0;
const SECTION_DIVIDER_RE = /^\[\s={5,}/;

function createLogBatcher(flushLines: (lines: string[]) => void) {
  let lines: string[] = [];
  let frame: number | null = null;
  const flush = () => {
    if (lines.length > 0) flushLines(lines.splice(0));
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const cancel = () => {
    lines = [];
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const push = (line: string) => {
    lines.push(line);
    if (SECTION_DIVIDER_RE.test(line)) {
      flush();
    } else if (frame === null) {
      frame = requestAnimationFrame(flush);
    }
  };
  return { push, flush, cancel };
}

export function clearImportListeners() {
  listenerSetupGeneration += 1;
  activeListenerCleanup?.();
  activeListenerCleanup = null;
}

function parseSnapshot(value: unknown): ImportRunSnapshot {
  return ImportRunSnapshotSchema.parse(value);
}

export async function reserveImportRun(params: {
  subjectList: string[];
  relocationPlanId: string;
  profileId: string;
  subjectsToPreserve?: string[];
  preserveStaging: boolean;
}): Promise<ImportRunSnapshot> {
  return parseSnapshot(await invoke("reserve_import_run", params));
}

export async function getActiveImportRun(): Promise<ImportRunSnapshot | null> {
  const response = await invoke<unknown>("get_active_import_run");
  return response == null ? null : parseSnapshot(response);
}

export async function attachImportRun(runId: string): Promise<ImportRunSnapshot> {
  return parseSnapshot(await invoke("attach_import_run", { runId }));
}

export async function launchImportRun(params: {
  runId: string;
  stagingEntries: StagingEntry[];
  sourcestructureJson: Record<string, unknown>;
  studyparJson: Record<string, unknown>;
  executionProfile: ExecutionProfile;
  subjectList: string[];
  relocationPlanId: string;
}): Promise<ImportRunSnapshot> {
  return parseSnapshot(await invoke("launch_import_run", params));
}

export async function cancelImportRun(runId: string): Promise<ImportRunSnapshot> {
  return parseSnapshot(await invoke("cancel_import_run", { runId }));
}

const SnapshotEventSchema = z.object({ payload: ImportRunSnapshotSchema }).strict();
const RawEventSchema = z
  .object({
    line: z.string(),
    runId: z.string().min(1),
    ownershipGeneration: z.number().int().nonnegative(),
  })
  .strict();
const StructuredEventSchema = z
  .object({
    runId: z.string().min(1),
    ownershipGeneration: z.number().int().nonnegative(),
    type: z.string(),
    subject: z.string().optional(),
    step: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export interface ImportListenerController {
  bindRun: (runId: string) => void;
  cleanup: () => void;
}

type ImportEventChannel = "snapshot" | "raw" | "structured";

/** Install before discovery, then bind native identity and replay events that
 * raced discovery. Listeners never call staging/finalization authority IPC. */
async function createImportListeners(
  initialRunId: string | null,
  lease: ProjectLease | null = captureProjectLease(),
): Promise<ImportListenerController> {
  clearImportListeners();
  const setupGeneration = listenerSetupGeneration;
  let boundRunId = initialRunId;
  let cleaned = false;
  const queued: Array<{ channel: ImportEventChannel; payload: unknown }> = [];
  const isCurrent = (runId: string, generation?: number) =>
    Boolean(
      lease &&
      isCurrentProjectLease(lease) &&
      (useImportStore.getState().activeRunId ?? useImportStore.getState().terminalRunId) ===
        runId &&
      (generation === undefined || useImportStore.getState().ownershipGeneration === generation),
    );
  const logBatcher = createLogBatcher((lines) => {
    const runId = boundRunId;
    if (!cleaned && runId && isCurrent(runId)) useImportStore.getState().addLogLines(lines);
  });
  const dispatch = (channel: ImportEventChannel, payload: unknown) => {
    const runId = boundRunId;
    if (!runId) {
      if (queued.length < 256) queued.push({ channel, payload });
      return;
    }
    if (channel === "snapshot") {
      const parsed = SnapshotEventSchema.safeParse({ payload });
      if (
        !parsed.success ||
        !isCurrent(runId, parsed.data.payload.ownershipGeneration) ||
        parsed.data.payload.runId !== runId
      )
        return;
      useImportStore.getState().reconcileImportRunSnapshot(parsed.data.payload, lease);
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(parsed.data.payload.lifecycle)
      ) {
        void reconcileImportTerminal(runId, lease).catch(() => undefined);
      }
      return;
    }
    if (channel === "raw") {
      const parsed = RawEventSchema.safeParse(payload);
      if (
        !parsed.success ||
        !isCurrent(runId, parsed.data.ownershipGeneration) ||
        parsed.data.runId !== runId
      )
        return;
      logBatcher.push(parsed.data.line);
      return;
    }
    const parsed = StructuredEventSchema.safeParse(payload);
    if (
      !parsed.success ||
      !isCurrent(runId, parsed.data.ownershipGeneration) ||
      parsed.data.runId !== runId
    )
      return;
    // Completion parser output is diagnostic only. Subject starts/failures
    // decorate provisional rows, then snapshots replace them.
    if (parsed.data.type === "subject_start" && parsed.data.subject) {
      useImportStore.getState().markSubjectRunning(parsed.data.subject);
    }
    if (parsed.data.type === "import_failed" && parsed.data.subject) {
      useImportStore
        .getState()
        .markSubjectDiagnosticFailure(
          parsed.data.subject,
          parsed.data.message ?? "Import diagnostic failure",
        );
    }
  };
  const unlisteners: Array<() => void> = [];
  try {
    unlisteners.push(
      await listen<unknown>("import-run-snapshot", (event) => dispatch("snapshot", event.payload)),
    );
    unlisteners.push(
      await listen<unknown>("import-raw-event", (event) => dispatch("raw", event.payload)),
    );
    unlisteners.push(
      await listen<unknown>("import-structured-event", (event) =>
        dispatch("structured", event.payload),
      ),
    );
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten());
    throw error;
  }
  if (setupGeneration !== listenerSetupGeneration) {
    logBatcher.cancel();
    unlisteners.forEach((unlisten) => unlisten());
    return { bindRun: () => undefined, cleanup: () => undefined };
  }
  const cleanup = () => {
    if (cleaned) return;
    logBatcher.flush();
    cleaned = true;
    queued.length = 0;
    unlisteners.forEach((unlisten) => unlisten());
    if (activeListenerCleanup === cleanup) activeListenerCleanup = null;
  };
  activeListenerCleanup = cleanup;
  const bindRun = (runId: string) => {
    if (cleaned) return;
    boundRunId = runId;
    const raced = queued.splice(0);
    for (const event of raced) dispatch(event.channel, event.payload);
  };
  return { bindRun, cleanup };
}

export async function setupImportDiscoveryListeners(
  lease: ProjectLease | null = captureProjectLease(),
): Promise<ImportListenerController> {
  return createImportListeners(null, lease);
}

export async function setupImportListeners(
  runId: string,
  lease: ProjectLease | null = captureProjectLease(),
): Promise<() => void> {
  const controller = await createImportListeners(runId, lease);
  return controller.cleanup;
}

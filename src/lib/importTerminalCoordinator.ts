/** Persist native terminal import authority before exact-run acknowledgement. */
import { invoke } from "@tauri-apps/api/core";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
  type ProjectLease,
} from "./projectLifecycle";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { ImportRunSnapshotSchema, type ImportRunSnapshot } from "../schemas/importSchemas";
import { computeStaleness } from "./importStaleness";
import { readImportStatus } from "./importStatus";

const pending = new Set<string>();

function ownsTerminal(runId: string, lease: ProjectLease): boolean {
  const project = useProjectStore.getState().project;
  return (
    isCurrentProjectLease(lease) &&
    project?.projectMeta.id === lease.projectId &&
    project.projectMeta.rootPath === lease.rootPath &&
    useImportStore.getState().terminalRunId === runId
  );
}

export function reconcileImportTerminal(
  runId: string,
  lease: ProjectLease | null = captureProjectLease(),
): Promise<void> {
  const key = lease ? `${lease.generation}:${runId}` : runId;
  if (
    !lease ||
    !isCurrentProjectLease(lease) ||
    !isProjectWorkAccepted() ||
    pending.has(key) ||
    !ownsTerminal(runId, lease)
  )
    return Promise.resolve();
  pending.add(key);
  let stage: "save" | "acknowledgement" = "save";
  // Register a thunk, not an already-started promise. Closing a project must
  // either drain this terminal save/acknowledgement or reject it before any
  // project mutation begins.
  const operation = async () => {
    try {
      if (!ownsTerminal(runId, lease)) return;
      useProjectStore.getState().syncImportState(useImportStore.getState());
      await useProjectStore.getState().saveProject();
      if (!ownsTerminal(runId, lease)) return;
      stage = "acknowledgement";
      await invoke("acknowledge_import_run", { runId });
      if (ownsTerminal(runId, lease)) {
        useImportStore.setState({ terminalRunId: null, ownershipGeneration: null });
      }
    } catch (error) {
      if (ownsTerminal(runId, lease)) {
        useImportStore.setState({
          importRunError: `Failed import terminal ${stage}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      throw error;
    } finally {
      pending.delete(key);
    }
  };
  try {
    return registerProjectTask(operation);
  } catch (error) {
    pending.delete(key);
    throw error;
  }
}

/** Activation-level reconciliation. Components consume same coordinator but
 * terminal save/ack does not depend on Step 5 mounting. */
export async function reconcileImportRunForActivation(): Promise<ImportRunSnapshot | null> {
  const lease = captureProjectLease();
  if (!lease || !isCurrentProjectLease(lease)) return null;
  const raw = await invoke<unknown>("get_active_import_run");
  if (!isCurrentProjectLease(lease)) return null;
  if (raw == null) {
    await reconcileCommittedImportStatus(lease);
    return null;
  }
  const snapshot = ImportRunSnapshotSchema.parse(raw);
  useImportStore.getState().bindImportRunSnapshot(snapshot);
  if (["completed", "failed", "cancelled", "interrupted"].includes(snapshot.lifecycle)) {
    await reconcileImportTerminal(snapshot.runId, lease);
  }
  return snapshot;
}

/** Transition-owned reconciliation after native shutdown settles execution.
 * Admission is closed, so this path is awaited directly instead of registering
 * new project work. */
export async function reconcileImportRunAfterShutdown(): Promise<void> {
  const lease = captureProjectLease();
  if (!lease || !isCurrentProjectLease(lease)) return;
  const raw = await invoke<unknown>("get_active_import_run");
  if (!isCurrentProjectLease(lease) || raw == null) return;
  const snapshot = ImportRunSnapshotSchema.parse(raw);
  if (!["completed", "failed", "cancelled", "interrupted"].includes(snapshot.lifecycle)) {
    throw new Error(`Native import remained ${snapshot.lifecycle} after shutdown.`);
  }
  useImportStore.getState().bindImportRunSnapshot(snapshot);
  useProjectStore.getState().syncImportState(useImportStore.getState());
  await useProjectStore.getState().saveProject({ allowClosedAdmission: true });
  if (!ownsTerminal(snapshot.runId, lease)) return;
  await invoke("acknowledge_import_run", { runId: snapshot.runId });
  if (ownsTerminal(snapshot.runId, lease)) {
    useImportStore.setState({ terminalRunId: null, ownershipGeneration: null });
  }
}

export async function reconcileCommittedImportStatus(
  lease: ProjectLease | null = captureProjectLease(),
): Promise<void> {
  if (!lease || !isCurrentProjectLease(lease)) return;
  const statuses = await readImportStatus();
  if (!isCurrentProjectLease(lease)) return;
  const store = useImportStore.getState();
  const subjects = [...new Set(store.subjectRows.map((row) => row.subject))];
  store.reconstructProgressFromLockFiles(
    statuses,
    subjects,
    computeStaleness(store, store.mostRecentConfig),
  );
}

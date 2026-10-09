/** Persist native terminal import authority before exact-run acknowledgement. */
import { invoke } from "@tauri-apps/api/core";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
  type ProjectLease,
} from "./projectLifecycle";
import { acceptedImportSettings, useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { ImportRunSnapshotSchema, type ImportRunSnapshot } from "../schemas/importSchemas";
import { computeStaleness } from "./importStaleness";
import { readImportStatus } from "./importStatus";
import { projectRequest } from "./projectPersistence";
import type { ProjectSnapshot } from "../generated/project/ProjectSnapshot";

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
  if (
    !lease ||
    !isCurrentProjectLease(lease) ||
    !isProjectWorkAccepted() ||
    useImportStore.getState().confirmationRequired ||
    !ownsTerminal(runId, lease)
  )
    return Promise.resolve();
  // Register a thunk, not an already-started promise. Closing a project must
  // either drain this terminal save/acknowledgement or reject it before any
  // project mutation begins.
  const operation = async () => {
    try {
      if (!ownsTerminal(runId, lease)) return;
      const accepted = await projectRequest<ProjectSnapshot>("reconcile_import_result", {
        runId,
        generation: useProjectStore.getState().project!.activationGeneration,
      });
      if (ownsTerminal(runId, lease)) {
        useProjectStore.getState().acceptSnapshot(accepted);
        useImportStore.setState({ terminalRunId: null, ownershipGeneration: null });
      }
    } catch (error) {
      if (ownsTerminal(runId, lease)) {
        useImportStore.setState({
          importRunError: `Failed import terminal reconciliation: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      throw error;
    }
  };
  return registerProjectTask(operation);
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
  if (
    ["completed", "failed", "cancelled", "interrupted"].includes(snapshot.lifecycle) &&
    !snapshot.confirmationRequired
  ) {
    await reconcileImportTerminal(snapshot.runId, lease);
  }
  return snapshot;
}

export async function reconcileCommittedImportStatus(
  lease: ProjectLease | null = captureProjectLease(),
): Promise<void> {
  if (!lease || !isCurrentProjectLease(lease)) return;
  const statuses = await readImportStatus();
  if (!isCurrentProjectLease(lease)) return;
  const store = useImportStore.getState();
  const subjects = [...new Set(acceptedImportSettings().subjectRows.map((row) => row.subject))];
  store.reconstructProgressFromLockFiles(
    statuses,
    subjects,
    computeStaleness(
      acceptedImportSettings(),
      useProjectStore.getState().project?.uiState.import?.mostRecentConfig ?? null,
    ),
  );
}

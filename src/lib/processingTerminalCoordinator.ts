import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
  type ProjectLease,
} from "./projectLifecycle";
import { getActiveRun } from "./processingEvents";
import {
  clearProcessingListeners,
  isActiveProcessingPhase,
  useProcessingStore,
} from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { projectRequest } from "./projectPersistence";
import type { ProjectSnapshot } from "../generated/project/ProjectSnapshot";
import type { ProcessingRunSnapshot } from "../schemas/processingSchemas";

function ownsTerminal(snapshot: ProcessingRunSnapshot, lease: ProjectLease) {
  const state = useProcessingStore.getState();
  const project = useProjectStore.getState().project;
  return (
    isCurrentProjectLease(lease) &&
    project?.projectMeta.id === lease.projectId &&
    project.projectMeta.rootPath === lease.rootPath &&
    snapshot.projectRoot === lease.rootPath &&
    state.attachmentGeneration === lease.generation &&
    state.terminalRunId === snapshot.runId &&
    state.snapshot?.terminalRevision === snapshot.terminalRevision
  );
}

export function reconcileProcessingTerminal(
  lease = captureProjectLease(),
  allowClosedAdmission = false,
): Promise<void> {
  const snapshot = useProcessingStore.getState().snapshot;
  const project = useProjectStore.getState().project;
  if (
    !lease ||
    !project ||
    !snapshot ||
    !isCurrentProjectLease(lease) ||
    snapshot.terminalRevision === null ||
    snapshot.availableAction !== "acknowledge" ||
    !ownsTerminal(snapshot, lease) ||
    (!allowClosedAdmission && !isProjectWorkAccepted())
  )
    return Promise.resolve();
  const operation = async () => {
    try {
      if (!ownsTerminal(snapshot, lease)) return;
      const accepted = await projectRequest<ProjectSnapshot>("reconcile_processing_result", {
        generation: project.activationGeneration,
        runId: snapshot.runId,
        terminalRevision: snapshot.terminalRevision,
      });
      if (!ownsTerminal(snapshot, lease)) return;
      useProjectStore.getState().acceptSnapshot(accepted);
      clearProcessingListeners(snapshot.runId);
      useProcessingStore.setState({
        terminalRunId: null,
        availableAction: "none",
        processingError: null,
      });
    } catch (error) {
      if (ownsTerminal(snapshot, lease))
        useProcessingStore.setState({
          processingError: `Failed processing terminal reconciliation: ${error instanceof Error ? error.message : String(error)}`,
        });
      throw error;
    }
  };
  return allowClosedAdmission ? operation() : registerProjectTask(operation);
}

export async function reconcileProcessingRunAfterShutdown(): Promise<void> {
  const lease = captureProjectLease();
  if (!lease) return;
  const snapshot = await getActiveRun();
  if (!isCurrentProjectLease(lease) || !snapshot) return;
  if (isActiveProcessingPhase(snapshot.lifecycle))
    throw new Error(`Native processing remained ${snapshot.lifecycle} after shutdown.`);
  useProcessingStore.getState().bindRunSnapshot(snapshot);
  await reconcileProcessingTerminal(lease, true);
}

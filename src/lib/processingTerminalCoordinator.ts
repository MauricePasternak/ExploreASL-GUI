/** Processing-specific terminal persistence through the existing project save queue. */
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
  type ProjectLease,
} from "./projectLifecycle";
import { acknowledgeProcessingRun, getActiveRun } from "./processingEvents";
import {
  clearProcessingListeners,
  isActiveProcessingPhase,
  useProcessingStore,
} from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import type { ProcessingRunSnapshot } from "../schemas/processingSchemas";

const pending = new Map<string, Promise<void>>();

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

function persistMetadata(snapshot: ProcessingRunSnapshot) {
  const project = useProjectStore.getState();
  project.syncProcessingState(useProcessingStore.getState());
  if (!snapshot.populationExecutionCommitted) return;
  const summary = snapshot.terminalSummary!;
  project.setPopulationCompleted(summary.populationCompleted && summary.result === "completed");
  project.setLastRunProfileId("population", summary.profileId, {
    exploreASLVersion: snapshot.versions?.exploreAsl ?? summary.exploreAslVersion ?? "unknown",
    matlabVersion: snapshot.versions?.matlab ?? "unknown",
    guiVersion: snapshot.versions?.gui ?? "unknown",
  });
  project.setLastPopulationRunMtime(
    summary.populationCompleted && summary.result === "completed"
      ? snapshot.populationReadyMtimeMs
      : null,
  );
}

export function reconcileProcessingTerminal(
  lease = captureProjectLease(),
  allowClosedAdmission = false,
): Promise<void> {
  const snapshot = useProcessingStore.getState().snapshot;
  if (
    !lease ||
    !snapshot ||
    snapshot.terminalRevision === null ||
    !snapshot.terminalSummary ||
    snapshot.availableAction !== "acknowledge" ||
    !ownsTerminal(snapshot, lease) ||
    (!allowClosedAdmission && !isProjectWorkAccepted())
  )
    return Promise.resolve();
  const key = `${lease.generation}:${snapshot.runId}:${snapshot.terminalRevision}`;
  const existing = pending.get(key);
  if (existing) return existing;
  let stage = "save";
  const operation = async () => {
    try {
      if (!ownsTerminal(snapshot, lease)) return;
      persistMetadata(snapshot);
      await useProjectStore.getState().saveProject({ allowClosedAdmission });
      if (!ownsTerminal(snapshot, lease)) return;
      stage = "acknowledgement";
      await acknowledgeProcessingRun(snapshot.runId, snapshot.terminalRevision!);
      if (!ownsTerminal(snapshot, lease)) return;
      clearProcessingListeners(snapshot.runId);
      useProcessingStore.setState({
        terminalRunId: null,
        availableAction: "none",
        processingError: null,
      });
    } catch (error) {
      if (ownsTerminal(snapshot, lease))
        useProcessingStore.setState({
          processingError: `Failed processing terminal ${stage}: ${error instanceof Error ? error.message : String(error)}`,
        });
      throw error;
    } finally {
      pending.delete(key);
    }
  };
  const promise = allowClosedAdmission ? operation() : registerProjectTask(operation);
  pending.set(key, promise);
  return promise;
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

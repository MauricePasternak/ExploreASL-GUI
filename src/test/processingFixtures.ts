import type {
  ProcessingHistoricalReplay,
  ProcessingRunSnapshot,
} from "../schemas/processingSchemas";

export const processingProfile = {
  id: "12345678-1234-4234-8234-123456789abc",
  type: "matlab" as const,
  label: "MATLAB",
  matlabPath: "/opt/matlab",
  exploreAslPath: "/opt/ExploreASL",
};

export function processingSnapshot(
  overrides: Partial<ProcessingRunSnapshot> = {},
): ProcessingRunSnapshot {
  return {
    runId: "12345678-1234-4234-8234-123456789001",
    requestId: "12345678-1234-4234-8234-123456789002",
    projectRoot: "/project",
    lifecycle: "preparing",
    selectedModules: ["structural"],
    selectedSubjectSessions: ["sub-001_01"],
    startTime: 1,
    revision: 1,
    expectedTargets: [],
    logicalExits: [],
    workerCount: 1,
    error: null,
    availableAction: "stop",
    terminalSummary: null,
    terminalRevision: null,
    executionCommitted: false,
    populationExecutionCommitted: false,
    versions: null,
    populationReadyMtimeMs: null,
    ...overrides,
  };
}

export function processingTerminal(
  overrides: Partial<ProcessingRunSnapshot> = {},
): ProcessingRunSnapshot {
  return processingSnapshot({
    lifecycle: "completed",
    revision: 5,
    terminalRevision: 5,
    terminalResult: "completed",
    availableAction: "acknowledge",
    executionCommitted: true,
    terminalSummary: {
      result: "completed",
      executionCommitted: true,
      populationCompleted: false,
      profileId: processingProfile.id,
      exploreAslVersion: "1.2.3",
    },
    versions: { exploreAsl: "1.2.3", matlab: "R2024a", gui: "2.0.0" },
    ...overrides,
  });
}

export function processingReplay(snapshot = processingTerminal()): ProcessingHistoricalReplay {
  return {
    version: 2,
    projectIdDigest: "a".repeat(64),
    requestId: snapshot.requestId!,
    runId: snapshot.runId,
    terminalRevision: snapshot.terminalRevision!,
    requestDigest: "b".repeat(64),
    outcome: snapshot.terminalResult!,
    acknowledged: true,
    historicalReplay: true,
    summary: {
      result: snapshot.terminalResult!,
      executionCommitted: snapshot.executionCommitted,
      populationCompleted: snapshot.terminalSummary!.populationCompleted,
      profileId: processingProfile.id,
      expectedTargetCount: 1,
      workerCount: 1,
      failedWorkerCount: 0,
      errorCode: null,
      errorMessage: null,
    },
  };
}

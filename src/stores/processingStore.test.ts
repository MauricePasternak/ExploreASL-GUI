import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { cleanup, renderHook } from "@testing-library/react";
import { useProcessingSync } from "../hooks/useProcessingSync";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import {
  processingProfile,
  processingReplay,
  processingSnapshot,
  processingTerminal,
} from "../test/processingFixtures";
import { useGlobalStore } from "./globalStore";
import { useDataParStore } from "./dataParStore";
import { useProjectStore } from "./projectStore";
import { clearProcessingListeners, useProcessingStore } from "./processingStore";
vi.mock("../lib/processingEvents", () => ({
  reserveProcessingRun: vi.fn(),
  runProcessingPipeline: vi.fn(),
  stopProcessingPipeline: vi.fn(),
  getActiveRun: vi.fn(),
  attachRun: vi.fn(),
  setupProcessingListeners: vi.fn(),
  confirmProcessingWorkersStopped: vi.fn(),
  loadSubjects: vi.fn(),
  loadLockStatus: vi.fn(),
  projectProcessingSnapshot: vi.fn(),
  acknowledgeProcessingRun: vi.fn(),
}));
import {
  attachRun,
  confirmProcessingWorkersStopped,
  getActiveRun,
  loadLockStatus,
  loadSubjects,
  projectProcessingSnapshot,
  reserveProcessingRun,
  runProcessingPipeline,
  setupProcessingListeners,
  stopProcessingPipeline,
} from "../lib/processingEvents";

const config = {
  subjects: ["sub-001_01"],
  modules: ["structural"] as "structural"[],
  selectedProfileId: processingProfile.id,
  workers: 2,
  rerunBids2Legacy: true,
};
describe("processing store", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    clearProcessingListeners();
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    useProjectStore.setState({ project: projectView(projectFixture()) });
    activateProjectLease("project-1", "/project");
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [processingProfile] },
      profileValidationState: { [processingProfile.id]: { valid: true, errors: [] } },
    });
    useDataParStore.getState().resetDataPar();
    vi.spyOn(useProjectStore.getState(), "saveProject").mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("hydrates active-looking persisted phases to idle with complete initial authority state", () => {
    useProjectStore.getState().project!.uiState.processing = { currentPhase: "running", config };
    useProcessingStore.getState().hydrateProcessing();
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "idle",
      activeRunId: null,
      terminalRunId: null,
      snapshot: null,
      availableAction: "none",
      actionPending: false,
    });
  });
  it("rejects missing config before native reservation", async () => {
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow("No config set");
    expect(reserveProcessingRun).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[processing] Start request failed",
      {
        operation: "validate_request",
        runId: null,
        phase: "idle",
        projectGeneration: 1,
      },
      expect.objectContaining({ message: "No config set" }),
    );
  });
  it("rejects empty module selection before native reservation", async () => {
    useProjectStore.getState().project!.uiState.processing = { config: { ...config, modules: [] } };

    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      "No modules selected",
    );
    expect(reserveProcessingRun).not.toHaveBeenCalled();
  });
  it("blocks deleted and invalid execution profiles without creating a native reservation", async () => {
    useProjectStore.getState().project!.uiState.processing = {
      config: { ...config, selectedProfileId: "deleted-profile" },
    };
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().profileError).toContain(
      "Selected profile was deleted or is invalid",
    );
    expect(reserveProcessingRun).not.toHaveBeenCalled();

    useProjectStore.getState().project!.uiState.processing = { config };
    useGlobalStore.setState({
      profileValidationState: {
        [processingProfile.id]: { valid: false, errors: ["MATLAB missing"] },
      },
    });
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().profileError).toContain("MATLAB missing");
    expect(reserveProcessingRun).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
  it("reserves before launch with pure request and attaches listeners", async () => {
    const project = useProjectStore.getState().project!;
    useProjectStore.setState({
      project: {
        ...project,
        mappingState: {
          ...project.mappingState,
          subjectRows: [
            { id: "sub-001/01", subject: "sub-001", session: "01", groupId: "group-1" },
          ],
          metadataGroups: [{ id: "group-1", label: "Group 1", bidsParams: {} }] as never,
        },
      },
    });
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project!,
        dataPar: {
          enableMetadataGroupingCorrection: true,
          WMHsegmAlg: "LGA",
          bRunLongReg: 1,
          nCompartments: 2,
        },
      },
    });
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "sub-001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
    useProjectStore.getState().project!.uiState.processing = { config };
    vi.mocked(reserveProcessingRun).mockResolvedValue({
      kind: "current",
      snapshot: processingSnapshot(),
    });
    vi.mocked(runProcessingPipeline).mockResolvedValue(
      processingSnapshot({ lifecycle: "running", revision: 2 }),
    );
    vi.mocked(setupProcessingListeners).mockResolvedValue(vi.fn());
    vi.mocked(attachRun).mockResolvedValue(
      processingSnapshot({ lifecycle: "running", revision: 2 }),
    );
    let release!: () => void;
    const save = vi.spyOn(useProjectStore.getState(), "saveProject").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const start = useProcessingStore.getState().startProcessing();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(reserveProcessingRun).not.toHaveBeenCalled();
    release();
    await start;
    save.mockRestore();
    expect(reserveProcessingRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        selectedModules: ["structural"],
        selectedSubjectSessions: ["sub-001_01"],
        executionProfile: processingProfile,
        dataPar: expect.any(Object),
        participants: {
          correction: true,
          subjectRows: [{ subject: "sub-001", session: "01", groupId: "group-1" }],
          metadataGroups: [{ id: "group-1", label: "Group 1" }],
        },
        workers: 1,
        rerunBids2legacy: true,
      }),
      "/project",
    );
    const request = vi.mocked(reserveProcessingRun).mock.calls[0]![0];
    expect(request.dataPar.x).toMatchObject({
      WMHsegmAlg: "LGA",
      modules: { bRunLongReg: 1 },
      Q: { nCompartments: 2 },
    });
    expect(request.dataPar.x).not.toHaveProperty("modules.asl.SpikeRemovalAbsoluteThreshold");
    expect(request.dataPar).not.toHaveProperty("opts");
    expect(request.dataPar).not.toHaveProperty("dataset");
    expect(runProcessingPipeline).toHaveBeenCalledWith(processingSnapshot().runId);
    await vi.waitFor(() =>
      expect(setupProcessingListeners).toHaveBeenCalledWith(processingSnapshot().runId),
    );
  });
  it("does not launch historical replay", async () => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "sub-001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
    useProjectStore.getState().project!.uiState.processing = { config };
    vi.mocked(reserveProcessingRun).mockResolvedValue({
      kind: "historical",
      replay: processingReplay(),
    });
    await useProcessingStore.getState().startProcessing();
    expect(runProcessingPipeline).not.toHaveBeenCalled();
  });
  it.each(["reservation", "launch", "listener setup", "listener attachment"])(
    "logs %s rejection once with original error and run context",
    async (stage) => {
      const error = new Error(`${stage} unavailable`);
      useProjectStore.getState().project!.uiState.processing = {
        config: { ...config, subjects: [], modules: ["population"], workers: 1 },
      };
      vi.mocked(reserveProcessingRun).mockResolvedValue({
        kind: "current",
        snapshot: processingSnapshot(),
      });
      vi.mocked(runProcessingPipeline).mockResolvedValue(
        processingSnapshot({ lifecycle: "running", revision: 2 }),
      );
      vi.mocked(setupProcessingListeners).mockResolvedValue(vi.fn());
      vi.mocked(attachRun).mockResolvedValue(processingSnapshot());
      const operation = {
        reservation: "reserve_processing_run",
        launch: "run_pipeline",
        "listener setup": "setup_processing_listeners",
        "listener attachment": "attach_run",
      }[stage];
      if (stage === "reservation") vi.mocked(reserveProcessingRun).mockRejectedValueOnce(error);
      if (stage === "launch") vi.mocked(runProcessingPipeline).mockRejectedValueOnce(error);
      if (stage === "listener setup")
        vi.mocked(setupProcessingListeners).mockRejectedValueOnce(error);
      if (stage === "listener attachment") vi.mocked(attachRun).mockRejectedValueOnce(error);

      const start = useProcessingStore.getState().startProcessing();
      if (stage.startsWith("listener")) await start;
      else await expect(start).rejects.toBe(error);
      await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
      expect(console.error).toHaveBeenCalledWith(
        expect.any(String),
        {
          operation,
          runId: stage === "reservation" ? null : processingSnapshot().runId,
          phase: stage === "reservation" ? "idle" : "preparing",
          projectGeneration: 1,
        },
        error,
      );
      if (stage.startsWith("listener")) expect(runProcessingPipeline).toHaveBeenCalledOnce();
    },
  );
  it("logs rejected discovery without changing its error", async () => {
    const error = new Error("discovery unavailable");
    vi.mocked(getActiveRun).mockRejectedValueOnce(error);
    await expect(useProcessingStore.getState().synchronizeProcessingRun()).rejects.toBe(error);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[processing] Run discovery failed",
      {
        operation: "get_active_run",
        runId: null,
        phase: "idle",
        projectGeneration: 1,
      },
      error,
    );
  });
  it("blocks native reservation and launch when Start persistence fails", async () => {
    useProjectStore.getState().project!.uiState.processing = {
      config: { ...config, subjects: [], modules: ["population"], workers: 1 },
    };
    vi.mocked(useProjectStore.getState().saveProject).mockRejectedValueOnce(new Error("Disk full"));
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow("Disk full");
    expect(reserveProcessingRun).not.toHaveBeenCalled();
    expect(runProcessingPipeline).not.toHaveBeenCalled();
    expect(useProcessingStore.getState()).toMatchObject({
      actionPending: false,
      processingError: "Disk full",
    });
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each([
    ["malformed", "not-a-subject"],
    ["missing", "sub-missing_01"],
  ])("rejects a %s selected subject before reservation", async (_case, subject) => {
    useProjectStore.getState().project!.uiState.processing = {
      config: { ...config, subjects: [subject] },
    };

    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow();
    expect(reserveProcessingRun).not.toHaveBeenCalled();
  });
  it("rejects processing without the active project capability", async () => {
    resetProjectLifecycleForTests();
    useProjectStore.getState().project!.uiState.processing = { config };
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      "No project loaded",
    );
    expect(reserveProcessingRun).not.toHaveBeenCalled();
  });
  it("projects native phases, preserves incomplete status, and rejects stale snapshots", () => {
    const store = useProcessingStore.getState();
    store.bindRunSnapshot(processingSnapshot({ lifecycle: "preparing", revision: 1 }));
    store.updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "structural",
      status: "incomplete",
      completedSteps: ["010"],
      locked: false,
    });
    store.reconcileRunSnapshot(processingSnapshot({ lifecycle: "running", revision: 2 }));
    store.reconcileRunSnapshot(processingSnapshot({ lifecycle: "preparing", revision: 1 }));
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "running",
      subjectStatuses: [expect.objectContaining({ status: "incomplete" })],
    });
    store.reconcileRunSnapshot(processingTerminal({ revision: 3 }));
    expect(useProcessingStore.getState().terminalRunId).toBe(processingSnapshot().runId);
  });
  it("upserts normalized sibling ASL statuses without replacing incomplete work", () => {
    const store = useProcessingStore.getState();
    store.updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "asl",
      run: "01",
      status: "incomplete",
      completedSteps: ["010"],
      locked: true,
    });
    store.updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "asl",
      run: "2",
      status: "pending",
      completedSteps: [],
      locked: false,
    });
    store.updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "asl",
      run: "1",
      status: "incomplete",
      completedSteps: ["010", "020"],
      locked: false,
    });
    expect(useProcessingStore.getState().subjectStatuses).toEqual([
      expect.objectContaining({ run: "1", completedSteps: ["010", "020"], status: "incomplete" }),
      expect.objectContaining({ run: "2" }),
    ]);
  });
  it("confirms the exact interrupted native run revision", async () => {
    const run = processingSnapshot({
      lifecycle: "interrupted",
      revision: 2,
      availableAction: "confirmStopped",
    });
    useProcessingStore.getState().bindRunSnapshot(run);
    vi.mocked(confirmProcessingWorkersStopped).mockResolvedValue(
      processingSnapshot({
        lifecycle: "cancelled",
        revision: 3,
        availableAction: "acknowledge",
        terminalResult: "cancelled",
        terminalRevision: 3,
      }),
    );
    await useProcessingStore.getState().confirmProcessingStopped();
    expect(confirmProcessingWorkersStopped).toHaveBeenCalledWith(run.runId, 2);
  });
  it("stops only the exact nonterminal retry-cleanup run", async () => {
    const run = processingSnapshot({
      lifecycle: "cancelling",
      availableAction: "retryCleanup",
      revision: 4,
    });
    vi.mocked(stopProcessingPipeline).mockResolvedValue(
      processingSnapshot({ lifecycle: "cancelling", availableAction: "retryCleanup", revision: 4 }),
    );
    useProcessingStore.getState().bindRunSnapshot(run);
    await useProcessingStore.getState().killProcessing();
    expect(stopProcessingPipeline).toHaveBeenCalledWith(run.runId);
  });
  it.each(["stop", "confirm"])(
    "logs rejected %s once and preserves original error",
    async (action) => {
      const run = processingSnapshot({
        lifecycle: action === "stop" ? "running" : "interrupted",
        availableAction: action === "stop" ? "stop" : "confirmStopped",
        revision: 2,
      });
      useProcessingStore.getState().bindRunSnapshot(run);
      const error = new Error("IPC rejected");
      vi.mocked(
        action === "stop" ? stopProcessingPipeline : confirmProcessingWorkersStopped,
      ).mockRejectedValueOnce(error);
      await expect(
        action === "stop"
          ? useProcessingStore.getState().killProcessing()
          : useProcessingStore.getState().confirmProcessingStopped(),
      ).rejects.toBe(error);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        expect.objectContaining({
          operation: action === "stop" ? "kill_pipeline" : "confirm_processing_workers_stopped",
          runId: run.runId,
          phase: run.lifecycle,
          projectGeneration: 1,
        }),
        error,
      );
      expect(console.info).toHaveBeenCalledOnce();
    },
  );
  it("does not duplicate snapshot reconciliation diagnostics after stop", async () => {
    useProcessingStore
      .getState()
      .bindRunSnapshot(processingSnapshot({ lifecycle: "running", availableAction: "stop" }));
    vi.mocked(stopProcessingPipeline).mockResolvedValueOnce(processingSnapshot());
    const error = new Error("already logged by projectRequest");
    vi.mocked(projectProcessingSnapshot).mockRejectedValueOnce(error);
    await expect(useProcessingStore.getState().killProcessing()).rejects.toBe(error);
    expect(console.error).not.toHaveBeenCalled();
  });
  it("makes only one pending confirmation request", async () => {
    let resolveConfirmation!: (snapshot: ReturnType<typeof processingSnapshot>) => void;
    vi.mocked(confirmProcessingWorkersStopped).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    useProcessingStore.getState().bindRunSnapshot(
      processingSnapshot({
        lifecycle: "interrupted",
        revision: 2,
        availableAction: "confirmStopped",
      }),
    );

    const first = useProcessingStore.getState().confirmProcessingStopped();
    const second = useProcessingStore.getState().confirmProcessingStopped();
    await vi.waitFor(() => expect(confirmProcessingWorkersStopped).toHaveBeenCalledOnce());
    resolveConfirmation(
      processingTerminal({ lifecycle: "cancelled", revision: 3, terminalRevision: 3 }),
    );
    await Promise.all([first, second]);
  });
  it("drops a stale confirmation response after project and run replacement", async () => {
    let resolveConfirmation!: (snapshot: ReturnType<typeof processingTerminal>) => void;
    vi.mocked(confirmProcessingWorkersStopped).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const interrupted = processingSnapshot({
      lifecycle: "interrupted",
      revision: 2,
      availableAction: "confirmStopped",
    });
    useProcessingStore.getState().bindRunSnapshot(interrupted);
    const confirmation = useProcessingStore.getState().confirmProcessingStopped();
    await vi.waitFor(() => expect(confirmProcessingWorkersStopped).toHaveBeenCalledOnce());

    await useProcessingStore.getState().resetProcessing();
    useProjectStore.setState({
      project: projectView(projectFixture("project-2", "Other", "/other")),
    });
    activateProjectLease("project-2", "/other");
    const replacement = processingSnapshot({
      projectRoot: "/other",
      runId: "12345678-1234-4234-8234-123456789099",
      lifecycle: "running",
      revision: 1,
    });
    useProcessingStore.getState().bindRunSnapshot(replacement);
    resolveConfirmation(
      processingTerminal({ lifecycle: "cancelled", revision: 3, terminalRevision: 3 }),
    );
    await confirmation;

    expect(useProcessingStore.getState().snapshot).toMatchObject({
      runId: replacement.runId,
      lifecycle: "running",
    });
  });
  it("normalizes subject and lock-status results for the current project", async () => {
    vi.mocked(loadSubjects).mockResolvedValue([
      {
        subjectSession: "sub-001_01",
        subject: "sub-001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["01"],
      },
    ]);
    vi.mocked(loadLockStatus).mockResolvedValue([
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "1",
        status: "pending",
        completedSteps: [],
        locked: true,
      },
    ]);
    const edits = vi.spyOn(useProjectStore.getState(), "submitEdit");
    renderHook(useProcessingSync);
    await vi.waitFor(() => expect(useProcessingStore.getState().subjectStatuses).toHaveLength(1));
    expect(useProcessingStore.getState().availableSubjects[0].aslRuns).toEqual(["1"]);
    expect(useProcessingStore.getState().subjectStatuses[0].run).toBe("1");
    expect(edits).not.toHaveBeenCalled();
    expect(useProjectStore.getState().saveProject).not.toHaveBeenCalled();
  });
  it("drops subject reads resolving after lease replacement", async () => {
    let resolveSubjects!: (subjects: Awaited<ReturnType<typeof loadSubjects>>) => void;
    vi.mocked(loadSubjects).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubjects = resolve;
        }),
    );
    const scan = useProcessingStore.getState().scanAvailableSubjects();
    activateProjectLease("project-2", "/other");
    resolveSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "sub-001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["01"],
      },
    ]);
    await scan;

    expect(useProcessingStore.getState().availableSubjects).toEqual([]);
  });
  it("drops lock-status reads resolving after lease replacement", async () => {
    let resolveStatuses!: (statuses: Awaited<ReturnType<typeof loadLockStatus>>) => void;
    vi.mocked(loadLockStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatuses = resolve;
        }),
    );
    const locks = useProcessingStore.getState().loadLockFileStatus();
    activateProjectLease("project-2", "/other");
    resolveStatuses([
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "01",
        status: "pending",
        completedSteps: [],
        locked: true,
      },
    ]);
    await locks;

    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });
  it("cleans actual listener state on reset and discovers active snapshot", async () => {
    vi.spyOn(useProjectStore.getState(), "refreshProject").mockResolvedValue(undefined);
    vi.mocked(getActiveRun).mockResolvedValue(processingSnapshot({ lifecycle: "running" }));
    const cleanup = vi.fn();
    vi.mocked(setupProcessingListeners).mockResolvedValue(cleanup);
    vi.mocked(attachRun).mockResolvedValue(
      processingSnapshot({ lifecycle: "running", revision: 2 }),
    );
    await useProcessingStore.getState().synchronizeProcessingRun();
    expect(useProcessingStore.getState().activeRunId).toBe(processingSnapshot().runId);
    await useProcessingStore.getState().resetProcessing();
    expect(useProcessingStore.getState().activeRunId).toBeNull();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

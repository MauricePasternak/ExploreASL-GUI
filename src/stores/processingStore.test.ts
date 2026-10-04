import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_FILE } from "../schemas/project";
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
  acknowledgeProcessingRun,
  confirmProcessingWorkersStopped,
  getActiveRun,
  loadLockStatus,
  loadSubjects,
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
    clearProcessingListeners();
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    useProjectStore.setState({ project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project") });
    activateProjectLease("project-1", "/project");
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [processingProfile] },
      profileValidationState: { [processingProfile.id]: { valid: true, errors: [] } },
    });
    useDataParStore.getState().resetDataPar();
  });
  it("hydrates initial state and enforces module/population mutual exclusion", () => {
    expect(useProcessingStore.getState().processingPhase).toBe("idle");
    useProcessingStore.getState().setConfig({ ...config, modules: ["structural", "population"] });
    expect(useProcessingStore.getState().config?.modules).toEqual(["population"]);
    expect(useProcessingStore.getState().config?.workers).toBe(1);
  });
  it("hydrates active-looking persisted phases to idle with complete initial authority state", () => {
    useProcessingStore.getState().hydrateProcessing({ currentPhase: "running", config });
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "idle",
      activeRunId: null,
      terminalRunId: null,
      snapshot: null,
      availableAction: "none",
      actionPending: false,
      config,
    });
  });
  it.each([
    { modules: ["population", "asl"] as ("population" | "asl")[], expected: ["asl"], workers: 2 },
    { modules: ["population"] as "population"[], expected: ["population"], workers: 1 },
  ])("normalizes config $modules", ({ modules, expected, workers }) => {
    if (modules.length > 1)
      useProcessingStore.getState().setConfig({ ...config, modules: ["population"] });
    useProcessingStore
      .getState()
      .setConfig({ ...config, modules, workers: 2, rerunBids2Legacy: true });
    expect(useProcessingStore.getState().config).toMatchObject({
      modules: expected,
      workers,
      rerunBids2Legacy: expected[0] === "population" ? false : true,
    });
  });
  it("rejects missing config before native reservation", async () => {
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow("No config set");
    expect(reserveProcessingRun).not.toHaveBeenCalled();
  });
  it("rejects empty module selection before native reservation", async () => {
    useProcessingStore.getState().setConfig({ ...config, modules: [] });

    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      "No modules selected",
    );
    expect(reserveProcessingRun).not.toHaveBeenCalled();
  });
  it("blocks deleted and invalid execution profiles without creating a native reservation", async () => {
    useProcessingStore.getState().setConfig({ ...config, selectedProfileId: "deleted-profile" });
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().profileError).toContain(
      "Selected profile was deleted or is invalid",
    );
    expect(reserveProcessingRun).not.toHaveBeenCalled();

    useProcessingStore.getState().setConfig(config);
    useGlobalStore.setState({
      profileValidationState: {
        [processingProfile.id]: { valid: false, errors: ["MATLAB missing"] },
      },
    });
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().profileError).toContain("MATLAB missing");
    expect(reserveProcessingRun).not.toHaveBeenCalled();
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
    useDataParStore.getState().setDataParField("enableMetadataGroupingCorrection", true);
    useDataParStore.getState().setDataParField("WMHsegmAlg", "LGA");
    useDataParStore.getState().setDataParField("bRunLongReg", 1);
    useDataParStore.getState().setDataParField("nCompartments", 2);
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
    useProcessingStore.getState().setConfig(config);
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
    await useProcessingStore.getState().startProcessing();
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
    useProcessingStore.getState().setConfig(config);
    vi.mocked(reserveProcessingRun).mockResolvedValue({
      kind: "historical",
      replay: processingReplay(),
    });
    await useProcessingStore.getState().startProcessing();
    expect(runProcessingPipeline).not.toHaveBeenCalled();
  });
  it.each([
    ["malformed", "not-a-subject"],
    ["missing", "sub-missing_01"],
  ])("rejects a %s selected subject before reservation", async (_case, subject) => {
    useProcessingStore.getState().setConfig({ ...config, subjects: [subject] });

    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow();
    expect(reserveProcessingRun).not.toHaveBeenCalled();
  });
  it("rejects processing without the active project capability", async () => {
    resetProjectLifecycleForTests();
    useProjectStore.setState({ project: null });
    useProcessingStore.getState().setConfig(config);

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
    useProjectStore.setState({ project: DEFAULT_PROJECT_FILE("project-2", "Other", "/other") });
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
    expect(acknowledgeProcessingRun).not.toHaveBeenCalled();
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
    await useProcessingStore.getState().scanAvailableSubjects();
    await useProcessingStore.getState().loadLockFileStatus();
    expect(useProcessingStore.getState().availableSubjects[0].aslRuns).toEqual(["1"]);
    expect(useProcessingStore.getState().subjectStatuses[0].run).toBe("1");
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

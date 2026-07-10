import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessConfig, SubjectInfo, SubjectModuleStatus } from "../schemas/processingSchemas";
import type { ExecutionProfile } from "../schemas/executionProfile";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import {
  loadSubjects,
  loadLockStatus,
  runProcessingPipeline,
  setupProcessingListeners,
  stopProcessingPipeline,
  watchLockDir,
} from "../lib/processingEvents";
import { invoke } from "@tauri-apps/api/core";
import { useGlobalStore } from "./globalStore";
import { useProcessingStore } from "./processingStore";

const { mockSetPopulationCompleted, mockSetLastRunProfileId, mockSetLastPopulationRunMtime } =
  vi.hoisted(() => ({
    mockSetPopulationCompleted: vi.fn(),
    mockSetLastRunProfileId: vi.fn(),
    mockSetLastPopulationRunMtime: vi.fn(),
  }));

vi.mock("../lib/processingEvents", () => ({
  runProcessingPipeline: vi.fn().mockResolvedValue([1234]),
  stopProcessingPipeline: vi.fn().mockResolvedValue(undefined),
  setupProcessingListeners: vi.fn().mockReturnValue(() => {}),
  watchLockDir: vi.fn().mockResolvedValue(undefined),
  stopWatcher: vi.fn().mockResolvedValue(undefined),
  loadSubjects: vi.fn().mockResolvedValue([]),
  loadLockStatus: vi.fn().mockResolvedValue([]),
  clearStaleLocks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./projectStore", () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      project: {
        projectMeta: { rootPath: "/test/project", dataSource: "dicom" as const },
        mappingState: {},
      },
      setPopulationCompleted: mockSetPopulationCompleted,
      setLastRunProfileId: mockSetLastRunProfileId,
      setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
    })),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "capture_environment_versions")
      return Promise.resolve({ explore_asl: "1.0.0", matlab: "R2023b" });
    if (cmd === "read_population_ready_mtime") return Promise.resolve(1700000000000);
    return Promise.resolve(null);
  }),
}));

const MATLAB_PROFILE: ExecutionProfile = {
  id: "profile-1",
  type: "matlab",
  label: "MATLAB R2023b",
  matlabPath: "/usr/local/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
};

beforeEach(() => {
  useGlobalStore.setState({
    settings: { ...DEFAULT_SETTINGS, executionProfiles: [MATLAB_PROFILE] },
    profileValidationState: { "profile-1": { valid: true, errors: [] } },
  });
});

afterEach(() => {
  useProcessingStore.getState().resetProcessing();
  vi.clearAllMocks();
  // Restore the default invoke mock implementation. Per-test overrides
  // (e.g. Phase 8.2 `ensure_rawdata_dir` mocks returning null for unknown
  // commands) would otherwise leak into the version-capture tests below
  // and cause capture_environment_versions to return null — making
  // setLastRunProfileId resolve to "unknown" and the test at line ~1085
  // to fail. This is a TEST ISOLATION fix, not a BIDS-direct bug.
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "capture_environment_versions")
      return Promise.resolve({ explore_asl: "1.0.0", matlab: "R2023b" });
    if (cmd === "read_population_ready_mtime") return Promise.resolve(1700000000000);
    return Promise.resolve(null);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRUCTURAL_ASL_CONFIG: ProcessConfig = {
  subjects: ["sub-001_01", "sub-002_02"],
  modules: ["structural", "asl"],
  selectedProfileId: "profile-1",
  workers: 4,
};

const POPULATION_CONFIG: ProcessConfig = {
  subjects: [],
  modules: ["population"],
  selectedProfileId: "profile-1",
  workers: 8,
};

const STATUS_A: SubjectModuleStatus = {
  subjectSession: "sub-001_01",
  module: "asl",
  status: "pending",
  completedSteps: [],
  locked: false,
};

const STATUS_A_UPDATED: SubjectModuleStatus = {
  subjectSession: "sub-001_01",
  module: "asl",
  status: "complete",
  completedSteps: ["ASL", "CBF"],
  locked: true,
};

const STATUS_B: SubjectModuleStatus = {
  subjectSession: "sub-002_01",
  module: "structural",
  status: "incomplete",
  completedSteps: ["T1"],
  locked: false,
};

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

describe("processingStore initial state", () => {
  it("starts with phase idle", () => {
    expect(useProcessingStore.getState().processingPhase).toBe("idle");
  });

  it("starts with null config", () => {
    expect(useProcessingStore.getState().config).toBeNull();
  });

  it("starts with empty arrays", () => {
    const state = useProcessingStore.getState();
    expect(state.availableSubjects).toEqual([]);
    expect(state.subjectStatuses).toEqual([]);
    expect(state.workerPids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setConfig
// ---------------------------------------------------------------------------

describe("processingStore setConfig", () => {
  it("stores config", () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    expect(useProcessingStore.getState().config).toEqual(STRUCTURAL_ASL_CONFIG);
  });

  it("forces workers=1 when population in modules", () => {
    useProcessingStore.getState().setConfig(POPULATION_CONFIG);
    expect(useProcessingStore.getState().config?.workers).toBe(1);
  });

  it("does not force workers when population not in modules", () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    expect(useProcessingStore.getState().config?.workers).toBe(4);
  });

  it("removes structural and asl when population is added", () => {
    const { setConfig } = useProcessingStore.getState();
    setConfig({
      subjects: [],
      modules: ["structural", "asl"],
      selectedProfileId: "profile-1",
      workers: 4,
    });
    setConfig({
      subjects: [],
      modules: ["structural", "asl", "population"],
      selectedProfileId: "profile-1",
      workers: 4,
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 8.1 — subjectFolder inject for BIDS projects
  // ---------------------------------------------------------------------------

  describe("processingStore subjectFolder inject (BIDS)", () => {
    const defaultProjectState = {
      project: {
        projectMeta: { rootPath: "/test/project", dataSource: "dicom" as const },
        mappingState: {},
      },
      setPopulationCompleted: mockSetPopulationCompleted,
      setLastRunProfileId: mockSetLastRunProfileId,
      setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
    };

    beforeEach(() => {
      useProcessingStore.getState().setAvailableSubjects([
        {
          subjectSession: "sub-001_01",
          subject: "001",
          session: "01",
          hasStructural: true,
          hasASL: true,
          aslRuns: [],
        },
        {
          subjectSession: "sub-002_02",
          subject: "002",
          session: "02",
          hasStructural: true,
          hasASL: true,
          aslRuns: [],
        },
      ]);
    });

    afterEach(async () => {
      // Restore default projectStore mock
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue(defaultProjectState);
    });

    it("injects subjectFolder in dataParJson when dataSource is bids", async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        project: {
          projectMeta: { rootPath: "/home/user/ds000240", dataSource: "bids" as const },
          mappingState: {},
        },
        setPopulationCompleted: mockSetPopulationCompleted,
        setLastRunProfileId: mockSetLastRunProfileId,
        setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
      });

      // Mock invoke to handle ensure_rawdata_dir
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ensure_rawdata_dir")
          return Promise.resolve({ created: true, warning: null, bidsignoreUpdated: true });
        return Promise.resolve(null);
      });

      useProcessingStore.getState().setConfig({
        ...STRUCTURAL_ASL_CONFIG,
        subjects: ["sub-001_01", "sub-002_02"],
      });
      await useProcessingStore.getState().startProcessing();

      expect(runProcessingPipeline).toHaveBeenCalled();
      const lastCall = (runProcessingPipeline as ReturnType<typeof vi.fn>).mock.lastCall;
      const dataParJson = lastCall?.[2];
      expect(dataParJson.x.opts).toEqual({ subjectFolder: "/home/user/ds000240" });
    });

    it("does NOT inject subjectFolder when dataSource is dicom", async () => {
      useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
      await useProcessingStore.getState().startProcessing();

      expect(runProcessingPipeline).toHaveBeenCalled();
      const lastCall = (runProcessingPipeline as ReturnType<typeof vi.fn>).mock.lastCall;
      const dataParJson = lastCall?.[2];
      expect(dataParJson.x.opts?.subjectFolder).toBeUndefined();
    });

    it("calls invoke('ensure_rawdata_dir') when dataSource is bids", async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        project: {
          projectMeta: { rootPath: "/test/bids", dataSource: "bids" as const },
          mappingState: {},
        },
        setPopulationCompleted: mockSetPopulationCompleted,
        setLastRunProfileId: mockSetLastRunProfileId,
        setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
      });

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ensure_rawdata_dir")
          return Promise.resolve({ created: true, warning: null, bidsignoreUpdated: true });
        return Promise.resolve(null);
      });

      useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
      await useProcessingStore.getState().startProcessing();

      expect(invoke).toHaveBeenCalledWith("ensure_rawdata_dir", { rootPath: "/test/bids" });
    });

    it("does NOT call invoke('ensure_rawdata_dir') when dataSource is dicom", async () => {
      useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
      await useProcessingStore.getState().startProcessing();

      expect(invoke).not.toHaveBeenCalledWith("ensure_rawdata_dir", expect.any(Object));
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 8.2 — ensure_rawdata_dir warning UX
  // ---------------------------------------------------------------------------

  describe("processingStore ensure_rawdata_dir warning UX", () => {
    const defaultProjectState = {
      project: {
        projectMeta: { rootPath: "/test/project", dataSource: "dicom" as const },
        mappingState: {},
      },
      setPopulationCompleted: mockSetPopulationCompleted,
      setLastRunProfileId: mockSetLastRunProfileId,
      setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
    };

    beforeEach(() => {
      useProcessingStore.getState().setAvailableSubjects([
        {
          subjectSession: "sub-001_01",
          subject: "001",
          session: "01",
          hasStructural: true,
          hasASL: true,
          aslRuns: [],
        },
      ]);
    });

    afterEach(async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue(defaultProjectState);
    });

    it("sets pendingRawdataWarning when ensure_rawdata_dir returns warning", async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        project: {
          projectMeta: { rootPath: "/test/bids", dataSource: "bids" as const },
          mappingState: {},
        },
        setPopulationCompleted: mockSetPopulationCompleted,
        setLastRunProfileId: mockSetLastRunProfileId,
        setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
      });

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ensure_rawdata_dir")
          return Promise.resolve({
            created: false,
            warning: "rawdata/ already contains 5 sub-directories",
            bidsignoreUpdated: false,
          });
        return Promise.resolve(null);
      });

      useProcessingStore.getState().setConfig({
        ...STRUCTURAL_ASL_CONFIG,
        subjects: ["sub-001_01"],
      });
      await useProcessingStore.getState().startProcessing();

      // Warning should be set
      expect(useProcessingStore.getState().pendingRawdataWarning).toBe(
        "rawdata/ already contains 5 sub-directories",
      );
      // Should NOT have reached running phase
      expect(useProcessingStore.getState().processingPhase).not.toBe("running");
      // runProcessingPipeline should NOT have been called
      expect(runProcessingPipeline).not.toHaveBeenCalled();
    });

    it("clears pendingRawdataWarning and proceeds when startProcessing(true) called after warning", async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        project: {
          projectMeta: { rootPath: "/test/bids", dataSource: "bids" as const },
          mappingState: {},
        },
        setPopulationCompleted: mockSetPopulationCompleted,
        setLastRunProfileId: mockSetLastRunProfileId,
        setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
      });

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ensure_rawdata_dir")
          return Promise.resolve({
            created: false,
            warning: "rawdata/ already contains 5 sub-directories",
            bidsignoreUpdated: false,
          });
        return Promise.resolve(null);
      });

      useProcessingStore.getState().setConfig({
        ...STRUCTURAL_ASL_CONFIG,
        subjects: ["sub-001_01"],
      });
      await useProcessingStore.getState().startProcessing();
      expect(useProcessingStore.getState().pendingRawdataWarning).toBeTruthy();

      // Now call with explicitConfirm=true
      await useProcessingStore.getState().startProcessing(true);
      expect(useProcessingStore.getState().pendingRawdataWarning).toBeNull();
      expect(useProcessingStore.getState().processingPhase).toBe("running");
      expect(runProcessingPipeline).toHaveBeenCalled();
    });

    it("clearPendingRawdataWarning resets the warning state", async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        project: {
          projectMeta: { rootPath: "/test/bids", dataSource: "bids" as const },
          mappingState: {},
        },
        setPopulationCompleted: mockSetPopulationCompleted,
        setLastRunProfileId: mockSetLastRunProfileId,
        setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
      });

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ensure_rawdata_dir")
          return Promise.resolve({
            created: false,
            warning: "rawdata/ already contains 5 sub-directories",
            bidsignoreUpdated: false,
          });
        return Promise.resolve(null);
      });

      useProcessingStore.getState().setConfig({
        ...STRUCTURAL_ASL_CONFIG,
        subjects: ["sub-001_01"],
      });
      await useProcessingStore.getState().startProcessing();
      expect(useProcessingStore.getState().pendingRawdataWarning).toBeTruthy();

      useProcessingStore.getState().clearPendingRawdataWarning();
      expect(useProcessingStore.getState().pendingRawdataWarning).toBeNull();
    });

    it("does not set pendingRawdataWarning when ensure_rawdata_dir returns no warning", async () => {
      const { useProjectStore } = await import("./projectStore");
      (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        project: {
          projectMeta: { rootPath: "/test/bids", dataSource: "bids" as const },
          mappingState: {},
        },
        setPopulationCompleted: mockSetPopulationCompleted,
        setLastRunProfileId: mockSetLastRunProfileId,
        setLastPopulationRunMtime: mockSetLastPopulationRunMtime,
      });

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "ensure_rawdata_dir")
          return Promise.resolve({ created: true, warning: null, bidsignoreUpdated: true });
        return Promise.resolve(null);
      });

      useProcessingStore.getState().setConfig({
        ...STRUCTURAL_ASL_CONFIG,
        subjects: ["sub-001_01"],
      });
      await useProcessingStore.getState().startProcessing();

      expect(useProcessingStore.getState().pendingRawdataWarning).toBeNull();
      expect(useProcessingStore.getState().processingPhase).toBe("running");
      expect(runProcessingPipeline).toHaveBeenCalled();
    });
  });

  it("removes population when structural is added", () => {
    const { setConfig } = useProcessingStore.getState();
    setConfig({
      subjects: [],
      modules: ["population"],
      selectedProfileId: "profile-1",
      workers: 1,
    });
    setConfig({
      subjects: [],
      modules: ["population", "structural"],
      selectedProfileId: "profile-1",
      workers: 1,
    });
    expect(useProcessingStore.getState().config?.modules).toEqual(["structural"]);
  });

  it("removes population when asl is added", () => {
    const { setConfig } = useProcessingStore.getState();
    setConfig({
      subjects: [],
      modules: ["population"],
      selectedProfileId: "profile-1",
      workers: 1,
    });
    setConfig({
      subjects: [],
      modules: ["population", "asl"],
      selectedProfileId: "profile-1",
      workers: 1,
    });
    expect(useProcessingStore.getState().config?.modules).toEqual(["asl"]);
  });
});

// ---------------------------------------------------------------------------
// Phase Transitions
// ---------------------------------------------------------------------------

describe("processingStore phase transitions", () => {
  beforeEach(() => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });
  it("startProcessing sets phase to running", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().processingPhase).toBe("running");
  });

  it("killProcessing sets phase to cancelled", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    await useProcessingStore.getState().killProcessing();
    expect(useProcessingStore.getState().processingPhase).toBe("cancelled");
  });

  it("resetProcessing resets to idle", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    useProcessingStore.getState().resetProcessing();
    expect(useProcessingStore.getState().processingPhase).toBe("idle");
    expect(useProcessingStore.getState().config).toBeNull();
    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateSubjectStatus
// ---------------------------------------------------------------------------

describe("processingStore updateSubjectStatus", () => {
  it("adds new status entry", () => {
    useProcessingStore.getState().updateSubjectStatus(STATUS_A);
    expect(useProcessingStore.getState().subjectStatuses).toEqual([STATUS_A]);
  });

  it("updates existing status entry (upsert)", () => {
    useProcessingStore.getState().updateSubjectStatus(STATUS_A);
    useProcessingStore.getState().updateSubjectStatus(STATUS_A_UPDATED);

    const statuses = useProcessingStore.getState().subjectStatuses;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual(STATUS_A_UPDATED);
  });

  it("can add multiple different subjects", () => {
    useProcessingStore.getState().updateSubjectStatus(STATUS_A);
    useProcessingStore.getState().updateSubjectStatus(STATUS_B);

    const statuses = useProcessingStore.getState().subjectStatuses;
    expect(statuses).toHaveLength(2);
    expect(statuses).toContainEqual(STATUS_A);
    expect(statuses).toContainEqual(STATUS_B);
  });

  it("distinguishes entries by run field for ASL multi-run", () => {
    const run1: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "1",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    };
    const run2: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "2",
      status: "incomplete",
      completedSteps: [],
      locked: true,
    };

    useProcessingStore.getState().updateSubjectStatus(run1);
    useProcessingStore.getState().updateSubjectStatus(run2);

    const statuses = useProcessingStore.getState().subjectStatuses;
    expect(statuses).toHaveLength(2);
    expect(statuses).toContainEqual(run1);
    expect(statuses).toContainEqual(run2);
  });

  it("normalizes padded BIDS run ids so 01 and 1 upsert the same entry", () => {
    useProcessingStore.getState().updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "asl",
      run: "01",
      status: "incomplete",
      completedSteps: [],
      locked: true,
    });
    useProcessingStore.getState().updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "asl",
      run: "1",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    });

    const statuses = useProcessingStore.getState().subjectStatuses;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual({
      subjectSession: "sub-001_01",
      module: "asl",
      run: "1",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    });
  });

  it("updates correct run entry without clobbering sibling run", () => {
    const run1: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "1",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    };
    const run2: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "2",
      status: "incomplete",
      completedSteps: [],
      locked: true,
    };
    const run2Updated: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "2",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    };

    useProcessingStore.getState().updateSubjectStatus(run1);
    useProcessingStore.getState().updateSubjectStatus(run2);
    useProcessingStore.getState().updateSubjectStatus(run2Updated);

    const statuses = useProcessingStore.getState().subjectStatuses;
    expect(statuses).toHaveLength(2);
    expect(statuses.find((s) => s.run === "1")).toEqual(run1);
    expect(statuses.find((s) => s.run === "2")).toEqual(run2Updated);
  });
});

// ---------------------------------------------------------------------------
// startProcessing clears stale subjectStatuses
// ---------------------------------------------------------------------------

describe("processingStore startProcessing clears stale statuses", () => {
  beforeEach(() => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });

  it("clears subjectStatuses when startProcessing is called", async () => {
    // Seed stale statuses (simulates previous completed run)
    useProcessingStore.getState().updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "structural",
      status: "complete",
      completedSteps: [
        "010_LinearReg_T1w2MNI",
        "020_LinearReg_FLAIR2T1w",
        "030_FLAIR_BiasfieldCorrection",
        "040_LST_Segment_FLAIR_WMH",
        "050_LST_T1w_LesionFilling_WMH",
        "060_Segment_T1w",
        "070_CleanUpWMH_SEGM",
        "080_Resample2StandardSpace",
        "090_GetVolumetrics",
        "100_VisualQC_Structural",
      ],
      locked: false,
    });
    useProcessingStore.getState().updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "structural",
      status: "complete",
      completedSteps: ["999_ready"],
      locked: false,
    });

    expect(useProcessingStore.getState().subjectStatuses).toHaveLength(1);

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    // After startProcessing, statuses should be cleared
    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });

  it("clears subjectStatuses even when no stale statuses exist", async () => {
    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });

  it("clears subjectStatuses for all modules, not just enabled ones", async () => {
    // Seed statuses for structural, asl, and population
    useProcessingStore.getState().updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "structural",
      status: "complete",
      completedSteps: ["060_Segment_T1w"],
      locked: false,
    });
    useProcessingStore.getState().updateSubjectStatus({
      subjectSession: "sub-001_01",
      module: "asl",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    });

    expect(useProcessingStore.getState().subjectStatuses).toHaveLength(2);

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tauri Integration — startProcessing
// ---------------------------------------------------------------------------

describe("processingStore Tauri integration: startProcessing", () => {
  beforeEach(() => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });
  it("calls runProcessingPipeline with config and dataParJson", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(runProcessingPipeline).toHaveBeenCalledWith(
      STRUCTURAL_ASL_CONFIG,
      MATLAB_PROFILE,
      expect.any(Object),
    );
  });

  it("calls watchLockDir with project root", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(watchLockDir).toHaveBeenCalledWith("/test/project");
  });

  it("calls setupProcessingListeners", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(setupProcessingListeners).toHaveBeenCalled();
  });

  it("stores returned worker pids", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().workerPids).toEqual([1234]);
  });

  it("sets phase to running after pipeline starts", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(useProcessingStore.getState().processingPhase).toBe("running");
  });

  it("sets phase to preparing before pipeline starts", async () => {
    const phases: string[] = [];
    (runProcessingPipeline as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      phases.push(useProcessingStore.getState().processingPhase);
      return [5678];
    });

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(phases).toContain("preparing");

    // Restore default mock
    (runProcessingPipeline as ReturnType<typeof vi.fn>).mockResolvedValue([1234]);
  });

  it("throws when no config is set", async () => {
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow("No config set");
  });

  it("throws when no modules are selected", async () => {
    useProcessingStore.getState().setConfig({ ...STRUCTURAL_ASL_CONFIG, modules: [] });
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      "No modules selected",
    );
  });

  it("throws when no project is loaded", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    const { useProjectStore } = await import("./projectStore");
    (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      project: null,
    });
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      "No project loaded",
    );
  });

  it("includes ForceInclusionList in dataParJson when subjects are configured", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(runProcessingPipeline).toHaveBeenCalled();
    const lastCall = (runProcessingPipeline as ReturnType<typeof vi.fn>).mock.lastCall;
    expect(lastCall?.[0]).toEqual(STRUCTURAL_ASL_CONFIG);
    expect(lastCall?.[1]).toEqual(MATLAB_PROFILE);
    expect(lastCall?.[2].x.dataset).toEqual({
      subjectRegexp: "^(sub-001_01|sub-002_02)$",
      ForceInclusionList: STRUCTURAL_ASL_CONFIG.subjects,
    });
  });

  it("omits ForceInclusionList from dataParJson when no subjects are configured", async () => {
    useProcessingStore.getState().setConfig(POPULATION_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(runProcessingPipeline).toHaveBeenCalled();
    const lastCall = (runProcessingPipeline as ReturnType<typeof vi.fn>).mock.lastCall;
    const expectedConfig = { ...POPULATION_CONFIG, workers: 1 };
    expect(lastCall?.[0]).toEqual(expectedConfig);
    expect(lastCall?.[2].x.dataset).toEqual({
      subjectRegexp: "^sub-.*$",
    });
    expect(lastCall?.[2].x.dataset.ForceInclusionList).toBeUndefined();
  });

  it("throws an error when configured subjects are not present in scanned availableSubjects", async () => {
    // Clear availableSubjects
    useProcessingStore.getState().setAvailableSubjects([]);

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      'Selected subject session "sub-001_01" is not present in the rawdata folder',
    );
  });

  it("throws an error when configured subjects do not match BIDS syntax", async () => {
    const invalidConfig: ProcessConfig = {
      ...STRUCTURAL_ASL_CONFIG,
      subjects: ["sub-001"], // missing session part
    };
    // Set availableSubjects to contain "sub-001" to bypass presence check
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001",
        subject: "001",
        session: "",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);

    useProcessingStore.getState().setConfig(invalidConfig);
    await expect(useProcessingStore.getState().startProcessing()).rejects.toThrow(
      'Subject session "sub-001" does not match BIDS syntax (sub-<subject>_<session>)',
    );
  });
});

// ---------------------------------------------------------------------------
// Profile resolution + validation gating (Group 7.1)
// ---------------------------------------------------------------------------

describe("processingStore startProcessing profile gating", () => {
  beforeEach(() => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });

  it("resolves and passes the valid profile to runProcessingPipeline", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    const lastCall = (runProcessingPipeline as ReturnType<typeof vi.fn>).mock.lastCall;
    expect(lastCall?.[1]).toEqual(MATLAB_PROFILE);
    expect(useProcessingStore.getState().profileError).toBeNull();
  });

  it("blocks with an inline error when the profile cannot be found (no failed transition)", async () => {
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [] },
      profileValidationState: {},
    });

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    expect(useProcessingStore.getState().profileError).toBeTruthy();
    expect(useProcessingStore.getState().processingPhase).not.toBe("failed");
    expect(useProcessingStore.getState().processingPhase).toBe("idle");
    expect(runProcessingPipeline).not.toHaveBeenCalled();
  });

  it("blocks with an inline error when the profile is invalid (no failed transition)", async () => {
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [MATLAB_PROFILE] },
      profileValidationState: {
        "profile-1": { valid: false, errors: ["MATLAB not found"] },
      },
    });

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    expect(useProcessingStore.getState().profileError).toBeTruthy();
    expect(useProcessingStore.getState().processingPhase).not.toBe("failed");
    expect(useProcessingStore.getState().processingPhase).toBe("idle");
    expect(runProcessingPipeline).not.toHaveBeenCalled();
  });

  it("clears a previous profileError once a valid profile is resolved", async () => {
    useProcessingStore.setState({ profileError: "stale error" });
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();

    expect(useProcessingStore.getState().profileError).toBeNull();
    expect(useProcessingStore.getState().processingPhase).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// Tauri Integration — killProcessing
// ---------------------------------------------------------------------------

describe("processingStore Tauri integration: killProcessing", () => {
  beforeEach(() => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });
  it("calls stopProcessingPipeline", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    await useProcessingStore.getState().killProcessing();
    expect(stopProcessingPipeline).toHaveBeenCalled();
  });

  it("sets phase to cancelled", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    await useProcessingStore.getState().killProcessing();
    expect(useProcessingStore.getState().processingPhase).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Tauri Integration — scanAvailableSubjects
// ---------------------------------------------------------------------------

const SUBJECT_INFOS: SubjectInfo[] = [
  {
    subjectSession: "sub-001_01",
    subject: "sub-001",
    session: "01",
    hasStructural: true,
    hasASL: true,
    aslRuns: [],
  },
  {
    subjectSession: "sub-002_01",
    subject: "sub-002",
    session: "01",
    hasStructural: false,
    hasASL: true,
    aslRuns: [],
  },
];

describe("processingStore Tauri integration: scanAvailableSubjects", () => {
  it("calls loadSubjects with project root", async () => {
    (loadSubjects as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SUBJECT_INFOS);
    await useProcessingStore.getState().scanAvailableSubjects();
    expect(loadSubjects).toHaveBeenCalledWith("/test/project", "dicom");
  });

  it("updates availableSubjects in store", async () => {
    (loadSubjects as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SUBJECT_INFOS);
    await useProcessingStore.getState().scanAvailableSubjects();
    expect(useProcessingStore.getState().availableSubjects).toEqual(SUBJECT_INFOS);
  });

  it("throws when no project is loaded", async () => {
    const { useProjectStore } = await import("./projectStore");
    (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      project: null,
    });
    await expect(useProcessingStore.getState().scanAvailableSubjects()).rejects.toThrow(
      "No project loaded",
    );
  });
});

// ---------------------------------------------------------------------------
// Tauri Integration — loadLockFileStatus
// ---------------------------------------------------------------------------

describe("processingStore Tauri integration: loadLockFileStatus", () => {
  it("calls loadLockStatus with project root", async () => {
    (loadLockStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([STATUS_A]);
    await useProcessingStore.getState().loadLockFileStatus();
    expect(loadLockStatus).toHaveBeenCalledWith("/test/project");
  });

  it("updates subjectStatuses in store", async () => {
    (loadLockStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([STATUS_A, STATUS_B]);
    await useProcessingStore.getState().loadLockFileStatus();
    expect(useProcessingStore.getState().subjectStatuses).toEqual([STATUS_A, STATUS_B]);
  });

  it("throws when no project is loaded", async () => {
    const { useProjectStore } = await import("./projectStore");
    (useProjectStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      project: null,
    });
    await expect(useProcessingStore.getState().loadLockFileStatus()).rejects.toThrow(
      "No project loaded",
    );
  });
});

// ---------------------------------------------------------------------------
// Tauri Integration — Event Listener Cleanup
// ---------------------------------------------------------------------------

describe("processingStore Tauri integration: event listener cleanup", () => {
  beforeEach(() => {
    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });
  it("resetProcessing calls cleanup function from setupProcessingListeners", async () => {
    const cleanupFn = vi.fn();
    (setupProcessingListeners as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cleanupFn);

    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    useProcessingStore.getState().resetProcessing();

    expect(cleanupFn).toHaveBeenCalled();
  });

  it("resetProcessing is safe to call without prior startProcessing", () => {
    expect(() => useProcessingStore.getState().resetProcessing()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Manifest version capture during startProcessing
// ---------------------------------------------------------------------------

describe("processingStore manifest version capture", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    mockSetPopulationCompleted.mockClear();
    mockSetLastRunProfileId.mockClear();
    mockSetLastPopulationRunMtime.mockClear();

    useProcessingStore.getState().setAvailableSubjects([
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
      {
        subjectSession: "sub-002_02",
        subject: "002",
        session: "02",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ]);
  });

  it("calls capture_environment_versions when population is in modules", async () => {
    useProcessingStore.getState().setConfig(POPULATION_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(invoke).toHaveBeenCalledWith(
      "capture_environment_versions",
      expect.objectContaining({
        exploreAslPath: "/opt/ExploreASL",
        matlabPath: "/usr/local/bin/matlab",
      }),
    );
  });

  it("does not call capture_environment_versions when population is not in modules", async () => {
    useProcessingStore.getState().setConfig(STRUCTURAL_ASL_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(invoke).not.toHaveBeenCalledWith("capture_environment_versions", expect.any(Object));
  });

  it("calls setLastRunProfileId after version capture with profileId and mapped fields", async () => {
    useProcessingStore.getState().setConfig(POPULATION_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(mockSetLastRunProfileId).toHaveBeenCalledWith(
      "population",
      "profile-1",
      expect.objectContaining({
        exploreASLVersion: "1.0.0",
        matlabVersion: "R2023b",
        guiVersion: expect.any(String),
      }),
    );
  });

  it("clears population completed flag when re-running Population", async () => {
    useProcessingStore.getState().setConfig(POPULATION_CONFIG);
    await useProcessingStore.getState().startProcessing();
    expect(mockSetPopulationCompleted).toHaveBeenCalledWith(false);
  });

  it("falls back to unknown versions when capture_environment_versions throws", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "capture_environment_versions")
        return Promise.reject(new Error("MATLAB not found"));
      return Promise.resolve(null);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    useProcessingStore.getState().setConfig(POPULATION_CONFIG);
    await useProcessingStore.getState().startProcessing();

    expect(mockSetLastRunProfileId).toHaveBeenCalledWith(
      "population",
      "profile-1",
      expect.objectContaining({
        exploreASLVersion: "unknown",
        matlabVersion: "unknown",
        guiVersion: "unknown",
      }),
    );
    warnSpy.mockRestore();

    // Restore default invoke mock
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "capture_environment_versions")
        return Promise.resolve({ explore_asl: "1.0.0", matlab: "R2023b" });
      if (cmd === "read_population_ready_mtime") return Promise.resolve(1700000000000);
      return Promise.resolve(null);
    });
  });
});

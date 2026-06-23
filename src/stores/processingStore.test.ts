import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessConfig, SubjectInfo, SubjectModuleStatus } from "../schemas/processingSchemas";
import {
  loadSubjects,
  loadLockStatus,
  runProcessingPipeline,
  setupProcessingListeners,
  stopProcessingPipeline,
  watchLockDir,
} from "../lib/processingEvents";
import { useProcessingStore } from "./processingStore";

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
        projectMeta: { rootPath: "/test/project" },
      },
      setPopulationCompleted: vi.fn(),
    })),
  },
}));

afterEach(() => {
  useProcessingStore.getState().resetProcessing();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRUCTURAL_ASL_CONFIG: ProcessConfig = {
  subjects: ["sub-001_01", "sub-002_02"],
  modules: ["structural", "asl"],
  matlabPath: "/usr/local/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
  workers: 4,
  subjectRegexp: "^(sub-001_01|sub-002_02)$",
};

const POPULATION_CONFIG: ProcessConfig = {
  subjects: [],
  modules: ["population"],
  matlabPath: "/usr/local/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
  workers: 8,
  subjectRegexp: "^sub-.*$",
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

  it("recomputes subjectRegexp when subjects change", () => {
    const config: ProcessConfig = {
      subjects: [],
      modules: ["structural", "asl"],
      matlabPath: "/usr/local/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
      workers: 4,
      subjectRegexp: "^sub-.*$",
    };
    useProcessingStore.getState().setConfig(config);
    expect(useProcessingStore.getState().config?.subjectRegexp).toBe("^sub-.*$");
  });

  it("recomputes subjectRegexp to alternation when subjects are selected", () => {
    const config: ProcessConfig = {
      subjects: ["sub-001", "sub-002"],
      modules: ["structural", "asl"],
      matlabPath: "/usr/local/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
      workers: 4,
      subjectRegexp: "^sub-.*$",
    };
    useProcessingStore.getState().setConfig(config);
    expect(useProcessingStore.getState().config?.subjectRegexp).toBe("^(sub-001|sub-002)$");
  });

  it("recomputes subjectRegexp when setConfig changes subjects", () => {
    const initial: ProcessConfig = {
      subjects: [],
      modules: ["structural"],
      matlabPath: "/usr/local/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
      workers: 2,
      subjectRegexp: "^sub-.*$",
    };
    useProcessingStore.getState().setConfig(initial);
    expect(useProcessingStore.getState().config?.subjectRegexp).toBe("^sub-.*$");

    const updated: ProcessConfig = {
      ...initial,
      subjects: ["sub-003"],
      subjectRegexp: "^sub-.*$",
    };
    useProcessingStore.getState().setConfig(updated);
    expect(useProcessingStore.getState().config?.subjectRegexp).toBe("^(sub-003)$");
  });

  it("escapes regex special characters in subject names", () => {
    const config: ProcessConfig = {
      subjects: ["sub-001.5", "sub+002"],
      modules: ["structural"],
      matlabPath: "/usr/local/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
      workers: 2,
      subjectRegexp: "^sub-.*$",
    };
    useProcessingStore.getState().setConfig(config);
    expect(useProcessingStore.getState().config?.subjectRegexp).toBe("^(sub-001\\.5|sub\\+002)$");
  });

  it("removes structural and asl when population is added", () => {
    const { setConfig } = useProcessingStore.getState();
    setConfig({
      subjects: [],
      modules: ["structural", "asl"],
      matlabPath: "",
      exploreAslPath: "",
      workers: 4,
      subjectRegexp: "",
    });
    setConfig({
      subjects: [],
      modules: ["structural", "asl", "population"],
      matlabPath: "",
      exploreAslPath: "",
      workers: 4,
      subjectRegexp: "",
    });
    expect(useProcessingStore.getState().config?.modules).toEqual(["population"]);
  });

  it("removes population when structural is added", () => {
    const { setConfig } = useProcessingStore.getState();
    setConfig({
      subjects: [],
      modules: ["population"],
      matlabPath: "",
      exploreAslPath: "",
      workers: 1,
      subjectRegexp: "",
    });
    setConfig({
      subjects: [],
      modules: ["population", "structural"],
      matlabPath: "",
      exploreAslPath: "",
      workers: 1,
      subjectRegexp: "",
    });
    expect(useProcessingStore.getState().config?.modules).toEqual(["structural"]);
  });

  it("removes population when asl is added", () => {
    const { setConfig } = useProcessingStore.getState();
    setConfig({
      subjects: [],
      modules: ["population"],
      matlabPath: "",
      exploreAslPath: "",
      workers: 1,
      subjectRegexp: "",
    });
    setConfig({
      subjects: [],
      modules: ["population", "asl"],
      matlabPath: "",
      exploreAslPath: "",
      workers: 1,
      subjectRegexp: "",
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
      run: "01",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    };
    const run2: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "02",
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

  it("updates correct run entry without clobbering sibling run", () => {
    const run1: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "01",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    };
    const run2: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "02",
      status: "incomplete",
      completedSteps: [],
      locked: true,
    };
    const run2Updated: SubjectModuleStatus = {
      subjectSession: "sub-001_01",
      module: "asl",
      run: "02",
      status: "complete",
      completedSteps: ["ASL"],
      locked: false,
    };

    useProcessingStore.getState().updateSubjectStatus(run1);
    useProcessingStore.getState().updateSubjectStatus(run2);
    useProcessingStore.getState().updateSubjectStatus(run2Updated);

    const statuses = useProcessingStore.getState().subjectStatuses;
    expect(statuses).toHaveLength(2);
    expect(statuses.find((s) => s.run === "01")).toEqual(run1);
    expect(statuses.find((s) => s.run === "02")).toEqual(run2Updated);
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
    expect(runProcessingPipeline).toHaveBeenCalledWith(STRUCTURAL_ASL_CONFIG, expect.any(Object));
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
    expect(lastCall?.[1].x.dataset).toEqual({
      subjectRegexp: STRUCTURAL_ASL_CONFIG.subjectRegexp,
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
    expect(lastCall?.[1].x.dataset).toEqual({
      subjectRegexp: POPULATION_CONFIG.subjectRegexp,
    });
    expect(lastCall?.[1].x.dataset.ForceInclusionList).toBeUndefined();
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
    expect(loadSubjects).toHaveBeenCalledWith("/test/project");
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

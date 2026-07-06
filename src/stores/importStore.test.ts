import { afterEach, describe, expect, it, vi } from "vitest";

import type { MetadataGroup, PathPattern, ImportSnapshot } from "../schemas/importSchemas";
import { computeStaleness } from "../lib/importStaleness";
import { useImportStore } from "./importStore";

// Reset store state between tests
afterEach(() => {
  useImportStore.getState().resetImport();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_PATTERNS: PathPattern[] = [
  {
    signature: "VARYING/VARYING/VARYING",
    samplePath: "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
    blocks: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"],
    uniqueNames: {
      0: ["BAR"],
      1: ["05022026_01"],
      2: ["sernum-0001_ser-AAHead_Scout"],
    },
    count: 1,
    depth: 3,
  },
];

const SAMPLE_PATHS = ["/data/BAR/05022026_01/sernum-0001_ser-AAHead_Scout"];

const VALID_METADATA_GROUP: MetadataGroup = {
  id: "global-defaults",
  label: "Global Defaults",
  bidsParams: {
    ArterialSpinLabelingType: "PCASL",
    PostLabelingDelay: [1.8],
    MRAcquisitionType: "3D",
    MagneticFieldStrength: 3,
    Manufacturer: "Siemens",
    ASLContext: "control,label",
    M0Type: "Separate",
    LabelingDuration: 1.8,
    BackgroundSuppression: false,
  },
};

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------
describe("importStore initial state", () => {
  it("starts with activeStep 0", () => {
    expect(useImportStore.getState().activeStep).toBe(0);
  });

  it("starts with empty paths and patterns", () => {
    const state = useImportStore.getState();
    expect(state.rawPaths).toEqual([]);
    expect(state.pathPatterns).toEqual([]);
    expect(state.ingestionComplete).toBe(false);
  });

  it("starts with bMatchDirectories true", () => {
    expect(useImportStore.getState().bMatchDirectories).toBe(true);
  });

  it("starts with empty tokenizer configs", () => {
    expect(useImportStore.getState().tokenizerConfigs).toEqual({});
  });

  it("starts with empty aliases", () => {
    const state = useImportStore.getState();
    expect(state.modalityAliases).toEqual([]);
    expect(state.sessionAliases).toEqual([]);
    expect(state.runAliases).toEqual([]);
    expect(state.subjectRenames).toEqual([]);
  });

  it("starts with import not running", () => {
    const state = useImportStore.getState();
    expect(state.importRunning).toBe(false);
    expect(state.importSummary).toBeNull();
    expect(state.importPhase).toBe("idle");
    expect(state.importCompleted).toBe(false);
    expect(state.importLog).toEqual([]);
    expect(state.failedSubjects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 1: Ingestion
// ---------------------------------------------------------------------------
describe("importStore ingestion actions", () => {
  it("setIngestionResults stores paths and patterns", () => {
    const { setIngestionResults } = useImportStore.getState();
    setIngestionResults(SAMPLE_PATHS, SAMPLE_PATTERNS);

    const state = useImportStore.getState();
    expect(state.rawPaths).toEqual(SAMPLE_PATHS);
    expect(state.pathPatterns).toEqual(SAMPLE_PATTERNS);
    expect(state.ingestionComplete).toBe(true);
  });

  it("setIngestionResults with empty paths sets ingestionComplete false", () => {
    const { setIngestionResults } = useImportStore.getState();
    setIngestionResults([], []);

    expect(useImportStore.getState().ingestionComplete).toBe(false);
  });

  it("setBMatchDirectories updates the flag", () => {
    const { setBMatchDirectories } = useImportStore.getState();
    setBMatchDirectories(false);
    expect(useImportStore.getState().bMatchDirectories).toBe(false);
  });

  it("setSourceDataPath stores the path", () => {
    const { setSourceDataPath } = useImportStore.getState();
    setSourceDataPath("/data/project/sourcedata");
    expect(useImportStore.getState().sourceDataPath).toBe("/data/project/sourcedata");
  });
});

// ---------------------------------------------------------------------------
// Step 2: Tokenizer
// ---------------------------------------------------------------------------
describe("importStore tokenizer actions", () => {
  it("setTokenAssignment adds assignment for a pattern", () => {
    const { setTokenAssignment } = useImportStore.getState();
    setTokenAssignment("VARYING/VARYING/VARYING", 0, null, "Subject");

    const configs = useImportStore.getState().tokenizerConfigs;
    expect(configs["VARYING/VARYING/VARYING"]).toHaveLength(1);
    expect(configs["VARYING/VARYING/VARYING"][0]).toEqual({
      blockIndex: 0,
      subBlockIndex: null,
      tag: "Subject",
    });
  });

  it("setTokenAssignment replaces existing assignment at same position", () => {
    const { setTokenAssignment } = useImportStore.getState();
    setTokenAssignment("sig", 0, null, "Subject");
    setTokenAssignment("sig", 0, null, "Session");

    const configs = useImportStore.getState().tokenizerConfigs;
    expect(configs["sig"]).toHaveLength(1);
    expect(configs["sig"][0].tag).toBe("Session");
  });

  it("setTokenAssignment accumulates assignments at different positions", () => {
    const { setTokenAssignment } = useImportStore.getState();
    setTokenAssignment("sig", 0, null, "Subject");
    setTokenAssignment("sig", 2, null, "Modality");

    const configs = useImportStore.getState().tokenizerConfigs;
    expect(configs["sig"]).toHaveLength(2);
  });

  it("removeTokenAssignment removes specific assignment", () => {
    const { setTokenAssignment, removeTokenAssignment } = useImportStore.getState();
    setTokenAssignment("sig", 0, null, "Subject");
    setTokenAssignment("sig", 2, null, "Modality");
    removeTokenAssignment("sig", 0, null);

    const configs = useImportStore.getState().tokenizerConfigs;
    expect(configs["sig"]).toHaveLength(1);
    expect(configs["sig"][0].blockIndex).toBe(2);
  });

  it("setTokenizerConfig replaces all assignments for a pattern", () => {
    const { setTokenAssignment, setTokenizerConfig } = useImportStore.getState();
    setTokenAssignment("sig", 0, null, "Subject");

    setTokenizerConfig("sig", [{ blockIndex: 1, subBlockIndex: null, tag: "Session" }]);

    const configs = useImportStore.getState().tokenizerConfigs;
    expect(configs["sig"]).toHaveLength(1);
    expect(configs["sig"][0].tag).toBe("Session");
  });
});

// ---------------------------------------------------------------------------
// Step 3: Aliases
// ---------------------------------------------------------------------------
describe("importStore alias actions", () => {
  it("setModalityAliases stores aliases", () => {
    const { setModalityAliases } = useImportStore.getState();
    const aliases = [
      { captured: "t1_mpr", mapped: "T1w" as const },
      { captured: "pcasl", mapped: "ASL4D" as const },
    ];
    setModalityAliases(aliases);
    expect(useImportStore.getState().modalityAliases).toEqual(aliases);
  });

  it("updateModalityAlias updates a specific alias", () => {
    const { setModalityAliases, updateModalityAlias } = useImportStore.getState();
    setModalityAliases([
      { captured: "t1_mpr", mapped: "T1w" },
      { captured: "pcasl", mapped: "ASL4D" },
    ]);
    updateModalityAlias("t1_mpr", "T2w");

    const aliases = useImportStore.getState().modalityAliases;
    expect(aliases[0].mapped).toBe("T2w");
    expect(aliases[1].mapped).toBe("ASL4D");
  });

  it("setSessionAliases stores session aliases", () => {
    const { setSessionAliases } = useImportStore.getState();
    const aliases = [
      { captured: "visit_1", alias: "ASL_1", index: 1 },
      { captured: "visit_2", alias: "ASL_2", index: 2 },
    ];
    setSessionAliases(aliases);
    expect(useImportStore.getState().sessionAliases).toEqual(aliases);
  });

  it("setRunAliases stores run aliases", () => {
    const { setRunAliases } = useImportStore.getState();
    const aliases = [
      { captured: "run_a", alias: "ASL_1", index: 1 },
      { captured: "run_b", alias: "ASL_2", index: 2 },
    ];
    setRunAliases(aliases);
    expect(useImportStore.getState().runAliases).toEqual(aliases);
  });

  it("setSubjectRenames stores renames", () => {
    const { setSubjectRenames } = useImportStore.getState();
    const renames = [
      { original: "BAR", target: "sub-BAR" },
      { original: "FOO", target: "sub-FOO" },
    ];
    setSubjectRenames(renames);
    expect(useImportStore.getState().subjectRenames).toEqual(renames);
  });

  it("updateSubjectRename updates a specific rename", () => {
    const { setSubjectRenames, updateSubjectRename } = useImportStore.getState();
    setSubjectRenames([
      { original: "BAR", target: "BAR" },
      { original: "FOO", target: "FOO" },
    ]);
    updateSubjectRename("BAR", "sub-001");

    const renames = useImportStore.getState().subjectRenames;
    expect(renames[0].target).toBe("sub-001");
    expect(renames[1].target).toBe("FOO");
  });
});

// ---------------------------------------------------------------------------
// Step 4: Metadata Groups
// ---------------------------------------------------------------------------
describe("importStore metadata group actions", () => {
  const defaultGroup: MetadataGroup = {
    id: "global",
    label: "Global Defaults",
    bidsParams: { ArterialSpinLabelingType: "PCASL" },
  };

  it("addMetadataGroup appends a group", () => {
    const { addMetadataGroup } = useImportStore.getState();
    addMetadataGroup(defaultGroup);

    expect(useImportStore.getState().metadataGroups).toHaveLength(1);
    expect(useImportStore.getState().metadataGroups[0].id).toBe("global");
  });

  it("removeMetadataGroup removes by id", () => {
    const { addMetadataGroup, removeMetadataGroup } = useImportStore.getState();
    addMetadataGroup(defaultGroup);
    addMetadataGroup({ ...defaultGroup, id: "override-1", label: "Override" });
    removeMetadataGroup("global");

    const groups = useImportStore.getState().metadataGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("override-1");
  });

  it("updateMetadataGroup partially updates a group", () => {
    const { addMetadataGroup, updateMetadataGroup } = useImportStore.getState();
    addMetadataGroup(defaultGroup);
    updateMetadataGroup("global", { label: "Updated Label" });

    const group = useImportStore.getState().metadataGroups[0];
    expect(group.label).toBe("Updated Label");
    expect(group.bidsParams.ArterialSpinLabelingType).toBe("PCASL");
  });

  it("setSubjectRows stores rows", () => {
    const { setSubjectRows } = useImportStore.getState();
    const rows = [
      {
        id: "BAR/01",
        subject: "BAR",
        session: "01",
        groupId: "global",
      },
    ];
    setSubjectRows(rows);
    expect(useImportStore.getState().subjectRows).toEqual(rows);
  });

  it("updateSubjectRowGroup changes group for selected rows", () => {
    const { setSubjectRows, updateSubjectRowGroup } = useImportStore.getState();
    setSubjectRows([
      {
        id: "BAR/01",
        subject: "BAR",
        session: "01",
        groupId: "global",
      },
      {
        id: "FOO/01",
        subject: "FOO",
        session: "01",
        groupId: "global",
      },
    ]);

    updateSubjectRowGroup(["BAR/01"], "override-1");

    const rows = useImportStore.getState().subjectRows;
    expect(rows[0].groupId).toBe("override-1");
    expect(rows[1].groupId).toBe("global");
  });
});

// ---------------------------------------------------------------------------
// Step 5: Import Execution
// ---------------------------------------------------------------------------
describe("importStore import execution actions", () => {
  it("setImportRunning updates running state", () => {
    const { setImportRunning } = useImportStore.getState();
    setImportRunning(true);
    expect(useImportStore.getState().importRunning).toBe(true);
  });

  it("updateImportProgress updates specific subject", () => {
    const { updateImportProgress } = useImportStore.getState();
    updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "running",
      currentStep: "DCM2NII",
    });

    const progress = useImportStore.getState().importProgress;
    expect(progress["BAR"].status).toBe("running");
    expect(progress["BAR"].currentStep).toBe("DCM2NII");
  });

  it("setImportSummary stores summary", () => {
    const { setImportSummary } = useImportStore.getState();
    const summary = { succeeded: 5, failed: 1, errors: ["Error for BAR"] };
    setImportSummary(summary);
    expect(useImportStore.getState().importSummary).toEqual(summary);
  });

  it("startImport prepares progress rows from subject rows", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      {
        id: "BAR/01",
        subject: "BAR",
        session: "01",
        groupId: "global",
      },
      {
        id: "FOO/02",
        subject: "FOO",
        session: "02",
        groupId: "global",
      },
    ]);
    store.addLogLine("stale line");
    store.markSubjectFailed("OLD", "DCM2NII", "stale failure");

    store.startImport();

    const state = useImportStore.getState();
    expect(state.importPhase).toBe("preparing");
    expect(state.importCompleted).toBe(false);
    expect(state.importLog).toEqual([]);
    expect(state.failedSubjects).toEqual([]);
    expect(state.importProgress).toEqual({
      BAR: {
        subject: "BAR",
        session: "01",
        status: "pending",
      },
      FOO: {
        subject: "FOO",
        session: "02",
        status: "pending",
      },
    });
  });

  it("startImport clears progress when no subject rows exist", () => {
    const store = useImportStore.getState();
    store.updateImportProgress("STALE", {
      subject: "STALE",
      session: "01",
      status: "failed",
      error: "previous run",
    });

    store.startImport();

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "preparing",
      failedSubjects: [],
      importLog: [],
    });
    expect(useImportStore.getState().importProgress).toEqual({});
  });

  it("tracks idle to completed import transitions", () => {
    const store = useImportStore.getState();

    expect(store.importPhase).toBe("idle");
    store.setImportPhase("preparing");
    expect(useImportStore.getState().importPhase).toBe("preparing");
    store.setImportPhase("running");
    expect(useImportStore.getState().importPhase).toBe("running");
    store.completeImport();

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "completed",
      importCompleted: true,
      importRunning: false,
    });
  });

  it("tracks failed import transitions", () => {
    const store = useImportStore.getState();

    store.setImportPhase("running");
    store.failImport();

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "failed",
      importCompleted: false,
      importRunning: false,
    });
  });

  it("cancels running imports and running subjects", () => {
    const store = useImportStore.getState();
    store.updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "running",
      currentStep: "DCM2NII",
    });
    store.updateImportProgress("FOO", {
      subject: "FOO",
      session: "01",
      status: "completed",
      duration: 12,
    });
    store.setImportPhase("running");

    store.cancelImport();

    const state = useImportStore.getState();
    expect(state.importPhase).toBe("cancelled");
    expect(state.importRunning).toBe(false);
    expect(state.importProgress.BAR.status).toBe("cancelled");
    expect(state.importProgress.FOO.status).toBe("completed");
  });

  it("updates subject running, completed, failed, and cancelled status", () => {
    const store = useImportStore.getState();
    store.updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "pending",
    });

    store.markSubjectRunning("BAR");
    expect(useImportStore.getState().importProgress.BAR).toMatchObject({
      status: "running",
    });

    store.markSubjectCompleted("BAR", 42);
    expect(useImportStore.getState().importProgress.BAR).toMatchObject({
      status: "completed",
      duration: 42,
    });
    expect(useImportStore.getState().failedSubjects).toEqual([]);

    store.markSubjectFailed("BAR", "NII2BIDS", "Bad metadata");
    expect(useImportStore.getState().importProgress.BAR).toMatchObject({
      status: "failed",
      errorStep: "NII2BIDS",
      error: "Bad metadata",
    });
    expect(useImportStore.getState().failedSubjects).toEqual(["BAR"]);

    store.markSubjectCancelled("BAR");
    expect(useImportStore.getState().importProgress.BAR.status).toBe("cancelled");
    expect(useImportStore.getState().failedSubjects).toEqual([]);
  });

  it("does not remove subjects from failedSubjects or mark them completed if they already failed", () => {
    const store = useImportStore.getState();
    store.markSubjectFailed("BAR", "NII2BIDS", "Bad metadata");
    store.markSubjectFailed("FOO", "DCM2NII", "Conversion failed");

    store.markSubjectCompleted("BAR", 9);

    expect(useImportStore.getState().failedSubjects).toEqual(["BAR", "FOO"]);
    expect(useImportStore.getState().importProgress.BAR.status).toBe("failed");
  });

  it("removes subjects from failedSubjects when they are cancelled", () => {
    const store = useImportStore.getState();
    store.markSubjectFailed("BAR", "NII2BIDS", "Bad metadata");
    store.markSubjectFailed("FOO", "DCM2NII", "Conversion failed");

    store.markSubjectCancelled("BAR");

    expect(useImportStore.getState().failedSubjects).toEqual(["FOO"]);
  });

  it("does not allow failed subjects to transition to running during the run", () => {
    const store = useImportStore.getState();
    store.markSubjectFailed("BAR", "NII2BIDS", "Bad metadata");
    store.markSubjectFailed("FOO", "DCM2NII", "Conversion failed");
    store.markSubjectRunning("BAR");
    store.setImportPhase("running");

    store.cancelImport();

    // Since BAR remained failed (not running), cancelImport keeps it in failedSubjects.
    expect(useImportStore.getState().failedSubjects).toEqual(["BAR", "FOO"]);
  });

  it("accumulates import log lines", () => {
    const store = useImportStore.getState();

    store.addLogLine("first line");
    store.addLogLine("second line");

    expect(useImportStore.getState().importLog).toEqual(["first line", "second line"]);
  });

  it("filters out duplicate log lines", () => {
    const store = useImportStore.getState();

    store.addLogLine("first line");
    store.addLogLine("first line");
    store.addLogLines(["second line", "first line", "third line", "second line"]);

    expect(useImportStore.getState().importLog).toEqual([
      "first line",
      "second line",
      "third line",
    ]);
  });

  it("resetImportPhase returns execution state to idle", () => {
    const store = useImportStore.getState();
    store.updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "running",
    });
    store.addLogLine("line");
    store.markSubjectFailed("BAR", "DCM2NII", "Conversion failed");
    store.setImportPhase("failed");

    store.resetImportPhase();

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "idle",
      importCompleted: false,
      importLog: [],
      failedSubjects: [],
      importRunning: false,
    });
  });

  it("normalizes persisted preparing imports to failed on hydration", () => {
    const store = useImportStore.getState();

    store.loadPersistedState({
      importPhase: "preparing",
      importCompleted: true,
    });

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "failed",
      importCompleted: false,
      importRunning: false,
    });
  });

  it("normalizes persisted running imports to failed on hydration", () => {
    const store = useImportStore.getState();

    store.loadPersistedState({
      importPhase: "running",
      importCompleted: true,
    });

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "failed",
      importCompleted: false,
      importRunning: false,
    });
  });

  it("restores step 5 during hydration when project prerequisites are valid", () => {
    const store = useImportStore.getState();

    store.loadPersistedState({
      activeStep: 5,
      rawPaths: SAMPLE_PATHS,
      pathPatterns: SAMPLE_PATTERNS,
      ingestionComplete: true,
      tokenizerConfigs: {
        "VARYING/VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
      modalityAliases: [{ captured: "sernum-0001_ser-AAHead_Scout", mapped: "ASL4D" }],
      metadataGroups: [VALID_METADATA_GROUP],
      subjectRows: [{ id: "SUB/01", subject: "SUB", session: "01", groupId: "global-defaults" }],
    });

    expect(useImportStore.getState().activeStep).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
describe("importStore reset", () => {
  it("resetImport clears all state", () => {
    const store = useImportStore.getState();

    // Set various state
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(SAMPLE_PATHS, SAMPLE_PATTERNS);
    store.setTokenAssignment("sig", 0, null, "Subject");
    store.setModalityAliases([{ captured: "t1", mapped: "T1w" }]);
    store.setImportRunning(true);

    // Reset
    store.resetImport();

    const state = useImportStore.getState();
    expect(state.activeStep).toBe(0);
    expect(state.sourceDataPath).toBe("");
    expect(state.rawPaths).toEqual([]);
    expect(state.pathPatterns).toEqual([]);
    expect(state.ingestionComplete).toBe(false);
    expect(state.tokenizerConfigs).toEqual({});
    expect(state.modalityAliases).toEqual([]);
    expect(state.importRunning).toBe(false);
    expect(state.importSummary).toBeNull();
    expect(state.importPhase).toBe("idle");
    expect(state.importCompleted).toBe(false);
    expect(state.importLog).toEqual([]);
    expect(state.failedSubjects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step Navigation
// ---------------------------------------------------------------------------
describe("importStore step navigation", () => {
  it("setActiveStep updates step", () => {
    const { setActiveStep } = useImportStore.getState();
    setActiveStep(2);
    expect(useImportStore.getState().activeStep).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// mostRecentConfig (ImportSnapshot)
// ---------------------------------------------------------------------------
describe("importStore mostRecentConfig", () => {
  it("starts as null", () => {
    expect(useImportStore.getState().mostRecentConfig).toBeNull();
  });

  it("setMostRecentConfig updates the snapshot", () => {
    const snapshot: import("../schemas/importSchemas").ImportSnapshot = {
      sourceDataPath: "/data",
      pathPatterns: SAMPLE_PATTERNS,
      tokenizerConfigs: {},
      bMatchDirectories: true,
      modalityAliases: [],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [],
      subjectRows: [],
    };
    useImportStore.getState().setMostRecentConfig(snapshot);
    expect(useImportStore.getState().mostRecentConfig).toEqual(snapshot);
  });

  it("startImport captures current config as mostRecentConfig", () => {
    const store = useImportStore.getState();
    store.setSourceDataPath("/scan/data");
    store.setIngestionResults(SAMPLE_PATHS, SAMPLE_PATTERNS);
    store.setTokenAssignment("VARYING/VARYING/VARYING", 0, null, "Subject");
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);

    store.startImport();

    const { mostRecentConfig } = useImportStore.getState();
    expect(mostRecentConfig).not.toBeNull();
    expect(mostRecentConfig!.sourceDataPath).toBe("/scan/data");
    expect(mostRecentConfig!.pathPatterns).toEqual(SAMPLE_PATTERNS);
    expect(mostRecentConfig!.tokenizerConfigs).toEqual({
      "VARYING/VARYING/VARYING": [{ blockIndex: 0, subBlockIndex: null, tag: "Subject" }],
    });
    expect(mostRecentConfig!.subjectRows).toEqual([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);
  });

  it("mostRecentConfig is persisted via loadPersistedState round-trip", () => {
    const snapshot: import("../schemas/importSchemas").ImportSnapshot = {
      sourceDataPath: "/persisted",
      pathPatterns: [],
      tokenizerConfigs: {},
      bMatchDirectories: true,
      modalityAliases: [],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [
        { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
      ],
      subjectRows: [{ id: "SUB/01", subject: "SUB", session: "01", groupId: "g1" }],
    };

    useImportStore.getState().loadPersistedState({
      sourceDataPath: "/persisted",
      pathPatterns: [],
      tokenizerConfigs: {},
      bMatchDirectories: true,
      metadataGroups: snapshot.metadataGroups,
      subjectRows: snapshot.subjectRows,
      mostRecentConfig: snapshot,
    });

    expect(useImportStore.getState().mostRecentConfig).toEqual(snapshot);
  });

  it("loadPersistedState falls back to null for missing mostRecentConfig", () => {
    useImportStore.getState().loadPersistedState({});
    expect(useImportStore.getState().mostRecentConfig).toBeNull();
  });

  it("loadPersistedState recovers gracefully using catch fallbacks for wrong-typed fields", () => {
    const store = useImportStore.getState();
    store.loadPersistedState({
      sourceDataPath: 12345,
      rawPaths: "not-an-array",
      pathPatterns: [{ signature: 123 }],
      bMatchDirectories: "yes",
      tokenizerConfigs: null,
      runAliases: ["corrupted"],
      activeStep: -1,
      importPhase: "not-a-phase",
      importCompleted: 42,
    });

    const state = useImportStore.getState();
    expect(state.sourceDataPath).toBe("");
    expect(state.rawPaths).toEqual([]);
    expect(state.pathPatterns).toEqual([]);
    expect(state.bMatchDirectories).toBe(true);
    expect(state.tokenizerConfigs).toEqual({});
    expect(state.runAliases).toEqual([]);
    expect(state.activeStep).toBe(0);
    expect(state.importPhase).toBe("idle");
    expect(state.importCompleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyStaleness
// ---------------------------------------------------------------------------
describe("importStore applyStaleness", () => {
  it("applies stale flag to matching subjects in importProgress", () => {
    const store = useImportStore.getState();
    store.updateImportProgress("BAR", { subject: "BAR", session: "01", status: "completed" });
    store.updateImportProgress("FOO", { subject: "FOO", session: "01", status: "completed" });

    store.applyStaleness({ BAR: true, FOO: false });

    expect(useImportStore.getState().importProgress.BAR.stale).toBe(true);
    expect(useImportStore.getState().importProgress.FOO.stale).toBe(false);
  });

  it("ignores subjects not present in importProgress", () => {
    const store = useImportStore.getState();
    store.updateImportProgress("BAR", { subject: "BAR", session: "01", status: "completed" });

    store.applyStaleness({ BAR: true, MISSING: true });

    expect(useImportStore.getState().importProgress.BAR.stale).toBe(true);
    expect(useImportStore.getState().importProgress.MISSING).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reconstructProgressFromLockFiles
// ---------------------------------------------------------------------------
describe("importStore reconstructProgressFromLockFiles", () => {
  it("maps lock file completed/failed statuses to importProgress", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ]);

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
      { subject: "FOO", status: "failed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR", "FOO"], {});

    const { importProgress } = useImportStore.getState();
    expect(importProgress.BAR.status).toBe("completed");
    expect(importProgress.FOO.status).toBe("failed");
  });

  it("marks subjects not in lock files as pending", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ]);

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR", "FOO"], {});

    const { importProgress } = useImportStore.getState();
    expect(importProgress.BAR.status).toBe("completed");
    expect(importProgress.FOO.status).toBe("pending");
  });

  it("applies staleness per subject", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ]);

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
      { subject: "FOO", status: "completed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR", "FOO"], { BAR: true, FOO: false });

    const { importProgress } = useImportStore.getState();
    expect(importProgress.BAR.stale).toBe(true);
    expect(importProgress.FOO.stale).toBe(false);
  });

  it("is a no-op when importPhase is running", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);
    store.updateImportProgress("BAR", { subject: "BAR", session: "01", status: "running" });
    store.setImportPhase("running");

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR"], {});

    expect(useImportStore.getState().importProgress.BAR.status).toBe("running");
  });

  it("is a no-op when importPhase is preparing", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);
    store.updateImportProgress("BAR", { subject: "BAR", session: "01", status: "pending" });
    store.setImportPhase("preparing");

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR"], {});

    expect(useImportStore.getState().importProgress.BAR.status).toBe("pending");
  });

  it("first import (no snapshot) → complete → re-visit → change metadata → re-run", () => {
    const store = useImportStore.getState();

    // Set up initial state
    store.setSourceDataPath("/data/project/sourcedata");
    store.setIngestionResults(SAMPLE_PATHS, SAMPLE_PATTERNS);
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ]);
    store.addMetadataGroup(VALID_METADATA_GROUP);

    // startImport captures snapshot, sets phase to preparing
    store.startImport();
    expect(useImportStore.getState().importPhase).toBe("preparing");
    expect(useImportStore.getState().mostRecentConfig).not.toBeNull();

    const snapshot = useImportStore.getState().mostRecentConfig!;
    expect(snapshot.sourceDataPath).toBe("/data/project/sourcedata");

    // Mark subjects running, then completed
    store.markSubjectRunning("BAR");
    store.markSubjectRunning("FOO");
    store.markSubjectCompleted("BAR", 42);
    store.markSubjectCompleted("FOO", 55);
    store.completeImport();

    expect(useImportStore.getState().importCompleted).toBe(true);
    expect(useImportStore.getState().importPhase).toBe("completed");

    // Re-visit: reconstructProgressFromLockFiles with completed statuses
    store.reconstructProgressFromLockFiles(
      [
        { subject: "BAR", status: "completed" },
        { subject: "FOO", status: "completed" },
      ],
      ["BAR", "FOO"],
      {},
    );

    expect(useImportStore.getState().importProgress.BAR.status).toBe("completed");
    expect(useImportStore.getState().importProgress.FOO.status).toBe("completed");
    expect(useImportStore.getState().importProgress.BAR.stale).toBe(false);

    // Change metadata group — computeStaleness should detect it
    store.updateMetadataGroup("global-defaults", {
      label: "Changed Label",
      bidsParams: {
        ...VALID_METADATA_GROUP.bidsParams,
        ArterialSpinLabelingType: "PASL" as const,
      },
    });

    const staleness = computeStaleness(useImportStore.getState(), snapshot);
    expect(staleness.BAR).toBe(true);
    expect(staleness.FOO).toBe(true);

    // applyStaleness sets stale flags
    store.applyStaleness(staleness);
    expect(useImportStore.getState().importProgress.BAR.stale).toBe(true);
    expect(useImportStore.getState().importProgress.FOO.stale).toBe(true);
  });

  it("structural change → all stale → re-run → snapshot updated", () => {
    const store = useImportStore.getState();

    // Initial config
    store.setSourceDataPath("/data/project/sourcedata");
    store.setIngestionResults(SAMPLE_PATHS, SAMPLE_PATTERNS);
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ]);

    store.startImport();
    const oldSnapshot = useImportStore.getState().mostRecentConfig;
    expect(oldSnapshot!.sourceDataPath).toBe("/data/project/sourcedata");

    // Mark completed, then re-visit
    store.markSubjectRunning("BAR");
    store.markSubjectCompleted("BAR", 42);
    store.markSubjectRunning("FOO");
    store.markSubjectCompleted("FOO", 55);
    store.completeImport();

    // Change sourceDataPath (structural change)
    store.setSourceDataPath("/data/new-project/sourcedata");

    const staleness = computeStaleness(useImportStore.getState(), oldSnapshot);

    // All subjects stale due to structural change
    expect(staleness.BAR).toBe(true);
    expect(staleness.FOO).toBe(true);

    // re-run: startImport captures new snapshot
    store.startImport();
    const newSnapshot = useImportStore.getState().mostRecentConfig;

    expect(newSnapshot).not.toBeNull();
    expect(newSnapshot!.sourceDataPath).toBe("/data/new-project/sourcedata");
    expect(newSnapshot!.sourceDataPath).not.toBe(oldSnapshot!.sourceDataPath);
  });

  it("namespace restructure — nested format persists correctly", () => {
    const store = useImportStore.getState();

    const nestedSnapshot: ImportSnapshot = {
      sourceDataPath: "/persisted/scan",
      pathPatterns: SAMPLE_PATTERNS,
      tokenizerConfigs: {
        "VARYING/VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
      bMatchDirectories: true,
      modalityAliases: [{ captured: "sernum-0001_ser-AAHead_Scout", mapped: "ASL4D" }],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [VALID_METADATA_GROUP],
      subjectRows: [{ id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" }],
    };

    store.loadPersistedState({
      sourceDataPath: "/persisted/scan",
      rawPaths: SAMPLE_PATHS,
      pathPatterns: SAMPLE_PATTERNS,
      ingestionComplete: true,
      tokenizerConfigs: {
        "VARYING/VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
      bMatchDirectories: true,
      modalityAliases: [{ captured: "sernum-0001_ser-AAHead_Scout", mapped: "ASL4D" }],
      metadataGroups: [VALID_METADATA_GROUP],
      subjectRows: [{ id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" }],
      mostRecentConfig: nestedSnapshot,
      activeStep: 5,
      importPhase: "completed" as const,
    });

    const state = useImportStore.getState();
    expect(state.mostRecentConfig).toEqual(nestedSnapshot);
    expect(state.mostRecentConfig!.sourceDataPath).toBe("/persisted/scan");
    expect(state.activeStep).toBe(5);
    expect(state.importPhase).toBe("completed");

    // Verify nested keys are preserved (not flattened)
    expect(state.metadataGroups).toHaveLength(1);
    expect(state.metadataGroups[0].id).toBe("global-defaults");
    expect(state.subjectRows).toHaveLength(1);
    expect(state.subjectRows[0].groupId).toBe("global-defaults");
  });

  it("preserves existing session when reconstructing", () => {
    const store = useImportStore.getState();
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);
    store.updateImportProgress("BAR", { subject: "BAR", session: "01", status: "running" });
    store.setImportPhase("idle");

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR"], {});

    expect(useImportStore.getState().importProgress.BAR.session).toBe("01");
  });
});

// ---------------------------------------------------------------------------
// BIDS Review Slice
// ---------------------------------------------------------------------------
describe("importStore BIDS review slice", () => {
  const SAMPLE_DERIVED_GROUP: import("../schemas/importSchemas").DerivedMetadataGroup = {
    id: "group-1",
    label: "Siemens_3T_PCASL_3D_Included",
    vendor: "Siemens",
    sequence: "3D_PCASL",
    labelingType: "PCASL",
    bidsParams: {
      ArterialSpinLabelingType: "PCASL",
      PostLabelingDelay: [1.8],
      MRAcquisitionType: "3D",
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      ASLContext: "m0scan,control,label",
      M0Type: "Included",
      LabelingDuration: 1.8,
      BackgroundSuppression: false,
    },
    subjects: [
      { subjectLabel: "sub-01", sessionLabels: ["1"] },
      { subjectLabel: "sub-02", sessionLabels: ["1"] },
    ],
  };

  it("starts with initial BIDS review state", () => {
    const state = useImportStore.getState();
    expect(state.bidsReview).toEqual({
      scanComplete: false,
      scanError: null,
      detectedGroups: [],
      skippedSubjects: [],
    });
  });

  it("startBidsScan populates detectedGroups and skippedSubjects on success", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [SAMPLE_DERIVED_GROUP],
      skipped: ["sub-UNK_1"],
    });

    await useImportStore.getState().startBidsScan("/tmp/bids-root");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanComplete).toBe(true);
    expect(state.bidsReview.scanError).toBeNull();
    expect(state.bidsReview.detectedGroups).toHaveLength(1);
    expect(state.bidsReview.detectedGroups[0].id).toBe("group-1");
    expect(state.bidsReview.skippedSubjects).toEqual(["sub-UNK_1"]);
  });

  it("startBidsScan sets scanError and clears detectedGroups on failure", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("permission denied"));

    await useImportStore.getState().startBidsScan("/tmp/bads-root");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanComplete).toBe(false);
    expect(state.bidsReview.scanError).toBe("permission denied");
    expect(state.bidsReview.detectedGroups).toEqual([]);
    expect(state.bidsReview.skippedSubjects).toEqual([]);
  });

  it("retryBidsScan clears scanError and re-invokes scan_bids_sidecars", async () => {
    const { invoke } = await import("@tauri-apps/api/core");

    // First call fails
    vi.mocked(invoke).mockRejectedValueOnce(new Error("timeout"));
    await useImportStore.getState().startBidsScan("/tmp/retry-root");
    expect(useImportStore.getState().bidsReview.scanError).toBe("timeout");

    // Retry succeeds
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [SAMPLE_DERIVED_GROUP],
      skipped: [],
    });
    await useImportStore.getState().retryBidsScan("/tmp/retry-root");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanError).toBeNull();
    expect(state.bidsReview.scanComplete).toBe(true);
    expect(state.bidsReview.detectedGroups).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("scan_bids_sidecars", {
      rootPath: "/tmp/retry-root",
    });
  });

  it("rescanConfirmedBidsProject failure only updates session scan error state", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [SAMPLE_DERIVED_GROUP],
        skippedSubjects: ["sub-old_1"],
      },
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("permission denied"));

    await useImportStore.getState().rescanConfirmedBidsProject("/tmp/confirmed-root");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanComplete).toBe(false);
    expect(state.bidsReview.scanError).toBe("permission denied");
    expect(state.bidsReview.detectedGroups).toEqual([]);
    expect(state.bidsReview.skippedSubjects).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("scan_bids_sidecars", {
      rootPath: "/tmp/confirmed-root",
    });
  });

  it("setDetectedGroups syncs the result of a scan", () => {
    useImportStore.getState().setDetectedGroups([SAMPLE_DERIVED_GROUP]);
    expect(useImportStore.getState().bidsReview.detectedGroups).toHaveLength(1);
    expect(useImportStore.getState().bidsReview.detectedGroups[0].label).toBe(
      "Siemens_3T_PCASL_3D_Included",
    );
  });

  it("resetBidsReview clears the slice to initial values", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [SAMPLE_DERIVED_GROUP],
      skipped: ["sub-UNK_1"],
    });

    await useImportStore.getState().startBidsScan("/tmp/reset-root");
    expect(useImportStore.getState().bidsReview.detectedGroups).toHaveLength(1);

    useImportStore.getState().resetBidsReview();
    expect(useImportStore.getState().bidsReview).toEqual({
      scanComplete: false,
      scanError: null,
      detectedGroups: [],
      skippedSubjects: [],
    });
  });

  it("backToLanding resets BIDS review state", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [SAMPLE_DERIVED_GROUP],
      skipped: [],
    });

    await useImportStore.getState().startBidsScan("/tmp/landing-root");
    expect(useImportStore.getState().bidsReview.scanComplete).toBe(true);

    useImportStore.getState().backToLanding();
    expect(useImportStore.getState().bidsReview).toEqual({
      scanComplete: false,
      scanError: null,
      detectedGroups: [],
      skippedSubjects: [],
    });
  });

  it("startBidsScan rejects malformed skipped entries (non-string) and surfaces scanError", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [],
      skipped: ["sub-01_1", 42],
    } as any);

    await useImportStore.getState().startBidsScan("/tmp/bad-skipped");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanComplete).toBe(false);
    expect(state.bidsReview.scanError).toMatch(/string/i);
    expect(state.bidsReview.detectedGroups).toEqual([]);
  });

  it("startBidsScan with 0 groups sets scanComplete true (empty result is valid)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [],
      skipped: [],
    });

    await useImportStore.getState().startBidsScan("/tmp/empty-bids");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanComplete).toBe(true);
    expect(state.bidsReview.scanError).toBeNull();
    expect(state.bidsReview.detectedGroups).toEqual([]);
    expect(state.bidsReview.skippedSubjects).toEqual([]);
  });
});

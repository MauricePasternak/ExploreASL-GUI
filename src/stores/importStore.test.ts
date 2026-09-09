import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MetadataGroup,
  PathPattern,
  ImportSnapshot,
  ImportRunSnapshot,
  ImportProgress,
} from "../schemas/importSchemas";
import type { ExecutionProfile } from "../schemas/executionProfile";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { computeStaleness } from "../lib/importStaleness";
import {
  activateProjectLease,
  closeProjectWorkAdmission,
  resetProjectLifecycleForTests,
} from "../lib/projectLifecycle";
import { useGlobalStore } from "./globalStore";
import { useImportStore } from "./importStore";

const MATLAB_PROFILE: ExecutionProfile = {
  id: "profile-1",
  type: "matlab",
  label: "MATLAB R2023b",
  matlabPath: "/usr/local/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
};

const nativeSnapshot = (
  lifecycle: ImportRunSnapshot["lifecycle"],
  runId = "import-run-1",
): ImportRunSnapshot => ({
  runId,
  lifecycle,
  ownershipGeneration: 4,
  profileId: "profile-1",
  selectedSubjects: ["BAR", "FOO"],
  createdAtMs: 1,
  updatedAtMs: 2,
  subjectOutcomes: [],
  ...(["completed", "failed", "cancelled", "interrupted"].includes(lifecycle)
    ? { terminalResult: lifecycle as "completed" | "failed" | "cancelled" | "interrupted" }
    : {}),
});

function updateImportProgress(subject: string, progress: ImportProgress) {
  useImportStore.setState((state) => ({
    importProgress: { ...state.importProgress, [subject]: progress },
  }));
}

function setImportPhase(importPhase: ReturnType<typeof useImportStore.getState>["importPhase"]) {
  useImportStore.setState({
    importPhase,
    importRunning: importPhase === "running" || importPhase === "cancelling",
  });
}

// A valid, selected profile is the default precondition for import runs. Tests
// that exercise the missing/invalid-profile blocking paths override this.
beforeEach(() => {
  useGlobalStore.setState({
    settings: { ...DEFAULT_SETTINGS, executionProfiles: [MATLAB_PROFILE] },
    profileValidationState: { "profile-1": { valid: true, errors: [] } },
  });
  useImportStore.setState({ selectedProfileId: "profile-1" });
});

// Reset store state between tests
afterEach(() => {
  useImportStore.getState().resetImport();
  resetProjectLifecycleForTests();
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
    useImportStore.setState({
      importLog: ["stale line"],
      importProgress: {
        OLD: {
          subject: "OLD",
          session: "01",
          status: "failed",
          errorStep: "DCM2NII",
          error: "stale failure",
        },
      },
    });

    store.startImport();

    const state = useImportStore.getState();
    expect(state.importPhase).toBe("preparing");
    expect(state.importCompleted).toBe(false);
    expect(state.importLog).toEqual([]);
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
    updateImportProgress("STALE", {
      subject: "STALE",
      session: "01",
      status: "failed",
      error: "previous run",
    });

    store.startImport();

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "preparing",
      importLog: [],
    });
    expect(useImportStore.getState().importProgress).toEqual({});
  });

  it("tracks idle to completed import transitions", () => {
    const store = useImportStore.getState();

    expect(store.importPhase).toBe("idle");
    store.bindImportRunSnapshot(nativeSnapshot("preparing"));
    expect(useImportStore.getState().importPhase).toBe("preparing");
    store.reconcileImportRunSnapshot(nativeSnapshot("running"));
    expect(useImportStore.getState().importPhase).toBe("running");
    store.reconcileImportRunSnapshot(nativeSnapshot("completed"));

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "completed",
      importCompleted: true,
      importRunning: false,
    });
  });

  it("rejects delayed nonterminal command responses after a newer terminal snapshot", () => {
    const store = useImportStore.getState();
    store.bindImportRunSnapshot({ ...nativeSnapshot("running"), updatedAtMs: 10 });
    store.reconcileImportRunSnapshot({ ...nativeSnapshot("completed"), updatedAtMs: 12 });
    store.reconcileImportRunSnapshot({ ...nativeSnapshot("running"), updatedAtMs: 12 });

    expect(useImportStore.getState()).toMatchObject({
      activeRunId: null,
      terminalRunId: "import-run-1",
      importPhase: "completed",
      nativeSnapshotUpdatedAtMs: 12,
    });
  });

  it("tracks failed import transitions", () => {
    const store = useImportStore.getState();

    store.bindImportRunSnapshot(nativeSnapshot("running"));
    store.reconcileImportRunSnapshot(nativeSnapshot("failed"));

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "failed",
      importCompleted: false,
      importRunning: false,
    });
  });

  it("cancels running imports and running subjects", () => {
    const store = useImportStore.getState();
    updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "running",
      currentStep: "DCM2NII",
    });
    updateImportProgress("FOO", {
      subject: "FOO",
      session: "01",
      status: "completed",
      duration: 12,
    });
    store.bindImportRunSnapshot(nativeSnapshot("running"));
    store.reconcileImportRunSnapshot({
      ...nativeSnapshot("cancelled"),
      subjectOutcomes: [
        {
          subject: "BAR",
          outcome: "cancelled",
          readyLockVerified: false,
          rawdataVerified: false,
          committed: false,
        },
        {
          subject: "FOO",
          outcome: "committed",
          readyLockVerified: true,
          rawdataVerified: true,
          committed: true,
        },
      ],
    });

    const state = useImportStore.getState();
    expect(state.importPhase).toBe("cancelled");
    expect(state.importRunning).toBe(false);
    expect(state.importProgress.BAR.status).toBe("cancelled");
    expect(state.importProgress.FOO.status).toBe("completed");
  });

  it("updates provisional running and failure diagnostics without terminal authority", () => {
    const store = useImportStore.getState();
    updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "pending",
    });

    store.markSubjectRunning("BAR");
    expect(useImportStore.getState().importProgress.BAR).toMatchObject({
      status: "running",
    });

    store.markSubjectDiagnosticFailure("BAR", "Bad metadata");
    expect(useImportStore.getState().importProgress.BAR).toMatchObject({
      status: "running",
      error: "Bad metadata",
    });
  });

  it("normalizes persisted preparing imports to interrupted on hydration", () => {
    const store = useImportStore.getState();

    store.loadPersistedState({
      importPhase: "preparing",
      importCompleted: true,
    });

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "interrupted",
      importCompleted: false,
      importRunning: false,
    });
  });

  it("normalizes persisted running imports to interrupted on hydration", () => {
    const store = useImportStore.getState();

    store.loadPersistedState({
      importPhase: "running",
      importCompleted: true,
    });

    expect(useImportStore.getState()).toMatchObject({
      importPhase: "interrupted",
      importCompleted: false,
      importRunning: false,
    });
  });

  it("restores to Preview because native preflight is session-only", () => {
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

    expect(useImportStore.getState().activeStep).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Execution profile selection (Group 8.1)
// ---------------------------------------------------------------------------
describe("importStore execution profile selection", () => {
  it("setSelectedProfileId updates the selected profile", () => {
    useImportStore.getState().setSelectedProfileId("profile-2");
    expect(useImportStore.getState().selectedProfileId).toBe("profile-2");
  });

  it("autoSelectProfile selects the first valid profile, skipping invalid ones", () => {
    const invalid: ExecutionProfile = {
      id: "profile-0",
      type: "matlab",
      label: "Broken",
      matlabPath: "/bad/matlab",
      exploreAslPath: "/bad/ExploreASL",
    };
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [invalid, MATLAB_PROFILE] },
      profileValidationState: {
        "profile-0": { valid: false, errors: ["MATLAB not found"] },
        "profile-1": { valid: true, errors: [] },
      },
    });
    useImportStore.setState({ selectedProfileId: null });

    useImportStore.getState().autoSelectProfile();

    expect(useImportStore.getState().selectedProfileId).toBe("profile-1");
  });

  it("autoSelectProfile does not override an existing selection", () => {
    useImportStore.setState({ selectedProfileId: "profile-1" });
    useImportStore.getState().autoSelectProfile();
    expect(useImportStore.getState().selectedProfileId).toBe("profile-1");
  });

  it("autoSelectProfile leaves selection null when no valid profile exists", () => {
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [MATLAB_PROFILE] },
      profileValidationState: { "profile-1": { valid: false, errors: ["bad"] } },
    });
    useImportStore.setState({ selectedProfileId: null });

    useImportStore.getState().autoSelectProfile();

    expect(useImportStore.getState().selectedProfileId).toBeNull();
  });

  it("restores selectedProfileId from persisted .easl state", () => {
    useImportStore.setState({ selectedProfileId: null });
    useImportStore.getState().loadPersistedState({ selectedProfileId: "profile-restored" });
    expect(useImportStore.getState().selectedProfileId).toBe("profile-restored");
  });

  it("startImport captures selectedProfileId in the snapshot", () => {
    const store = useImportStore.getState();
    store.setSelectedProfileId("profile-1");
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);

    store.startImport();

    expect(useImportStore.getState().pendingImportConfig?.selectedProfileId).toBe("profile-1");
  });

  it("startImport blocks with an inline error when no profile is selected (no failed transition)", () => {
    useImportStore.setState({ selectedProfileId: null });
    const store = useImportStore.getState();

    store.startImport();

    expect(useImportStore.getState().profileError).toBeTruthy();
    expect(useImportStore.getState().importPhase).not.toBe("failed");
    expect(useImportStore.getState().importPhase).toBe("idle");
  });

  it("startImport blocks with an inline error when the selected profile is invalid", () => {
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [MATLAB_PROFILE] },
      profileValidationState: { "profile-1": { valid: false, errors: ["MATLAB not found"] } },
    });
    useImportStore.setState({ selectedProfileId: "profile-1" });
    const store = useImportStore.getState();

    store.startImport();

    expect(useImportStore.getState().profileError).toBeTruthy();
    expect(useImportStore.getState().importPhase).not.toBe("failed");
    expect(useImportStore.getState().importPhase).toBe("idle");
  });

  it("startImport clears a stale profileError once a valid profile resolves", () => {
    useImportStore.setState({ selectedProfileId: "profile-1", profileError: "stale" });
    const store = useImportStore.getState();

    store.startImport();

    expect(useImportStore.getState().profileError).toBeNull();
    expect(useImportStore.getState().importPhase).toBe("preparing");
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
    useImportStore.setState({ importRunning: true });

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
  it("updates current and snapshot identity for a compatible source relink", () => {
    const snapshot = {
      sourceDataPath: "/old/source",
      pathPatterns: [],
      tokenizerConfigs: {},
      bMatchDirectories: true,
      modalityAliases: [],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [],
      subjectRows: [],
    };
    useImportStore.setState({ sourceDataPath: "/old/source", mostRecentConfig: snapshot });

    useImportStore.getState().relinkCompatibleSource("/new/source");

    expect(useImportStore.getState().sourceDataPath).toBe("/new/source");
    expect(useImportStore.getState().mostRecentConfig?.sourceDataPath).toBe("/new/source");
    expect(useImportStore.getState().requiresManualSave).toBe(true);
    expect(useImportStore.getState().sourceAvailability.status).toBe("available");
  });

  it("selectively resets source-dependent setup for a confirmed incompatible relink", () => {
    useImportStore.setState({
      activeStep: 5,
      sourceDataPath: "/old/source",
      rawPaths: ["old/scan"],
      pathPatterns: SAMPLE_PATTERNS,
      tokenizerConfigs: { saved: [] },
      modalityAliases: [{ captured: "asl", mapped: "ASL4D" }],
      metadataGroups: [VALID_METADATA_GROUP],
      subjectRows: [{ id: "OLD/01", subject: "OLD", session: "01", groupId: "global-defaults" }],
      importPhase: "completed",
      importCompleted: true,
      importLog: ["old log"],
      importRunning: false,
      importProgress: {
        OLD: { subject: "OLD", session: "01", status: "completed" },
      },
      mostRecentConfig: {
        sourceDataPath: "/old/source",
        pathPatterns: SAMPLE_PATTERNS,
        tokenizerConfigs: { saved: [] },
        bMatchDirectories: true,
        modalityAliases: [],
        sessionAliases: [],
        runAliases: [],
        subjectRenames: [],
        metadataGroups: [],
        subjectRows: [],
      },
      selectedProfileId: "profile-1",
    });

    useImportStore
      .getState()
      .relinkIncompatibleSource("/new/source", ["new/scan"], SAMPLE_PATTERNS);

    expect(useImportStore.getState()).toMatchObject({
      activeStep: 0,
      sourceDataPath: "/new/source",
      rawPaths: ["new/scan"],
      tokenizerConfigs: {},
      modalityAliases: [],
      metadataGroups: [],
      subjectRows: [],
      importPhase: "idle",
      importCompleted: false,
      importLog: [],
      importProgress: {},
      mostRecentConfig: null,
      selectedProfileId: "profile-1",
      requiresManualSave: true,
    });
  });
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

  it("startImport captures current config as a pending attempt", () => {
    const store = useImportStore.getState();
    store.setSourceDataPath("/scan/data");
    store.setIngestionResults(SAMPLE_PATHS, SAMPLE_PATTERNS);
    store.setTokenAssignment("VARYING/VARYING/VARYING", 0, null, "Subject");
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);

    store.startImport();

    const { pendingImportConfig } = useImportStore.getState();
    expect(pendingImportConfig).not.toBeNull();
    expect(pendingImportConfig!.sourceDataPath).toBe("/scan/data");
    expect(pendingImportConfig!.pathPatterns).toEqual(SAMPLE_PATTERNS);
    expect(pendingImportConfig!.tokenizerConfigs).toEqual({
      "VARYING/VARYING/VARYING": [{ blockIndex: 0, subBlockIndex: null, tag: "Subject" }],
    });
    expect(pendingImportConfig!.subjectRows).toEqual([
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
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "completed" });
    updateImportProgress("FOO", { subject: "FOO", session: "01", status: "completed" });

    store.applyStaleness({ BAR: true, FOO: false });

    expect(useImportStore.getState().importProgress.BAR.stale).toBe(true);
    expect(useImportStore.getState().importProgress.FOO.stale).toBe(false);
  });

  it("ignores subjects not present in importProgress", () => {
    const store = useImportStore.getState();
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "completed" });

    store.applyStaleness({ BAR: true, MISSING: true });

    expect(useImportStore.getState().importProgress.BAR.stale).toBe(true);
    expect(useImportStore.getState().importProgress.MISSING).toBeUndefined();
  });
});

describe("importStore staging preflight", () => {
  it("accepts only latest matching request under its captured project lease", () => {
    const lease = activateProjectLease("project", "/project");
    const store = useImportStore.getState();
    const first = store.beginStagingPreflight("first", lease);
    const second = store.beginStagingPreflight("second", lease);
    store.resolveStagingPreflight(first, "first", lease, { valid: true, issues: [] });
    expect(useImportStore.getState().stagingPreflight.status).toBe("pending");
    store.resolveStagingPreflight(second, "second", lease, {
      valid: false,
      issues: [{ code: "PORTABLE_COLLISION", field: "subject", message: "collision" }],
    });
    expect(useImportStore.getState().stagingPreflight).toMatchObject({
      status: "invalid",
      fingerprint: "second",
      requestId: second,
    });
  });

  it("does not admit responses after transition work closes", () => {
    const lease = activateProjectLease("project", "/project");
    const store = useImportStore.getState();
    const requestId = store.beginStagingPreflight("current", lease);
    closeProjectWorkAdmission();
    store.resolveStagingPreflight(requestId, "current", lease, { valid: true, issues: [] });
    expect(useImportStore.getState().stagingPreflight.status).toBe("pending");
  });

  it("records operational preflight failures for the latest current request", () => {
    const lease = activateProjectLease("project", "/project");
    const store = useImportStore.getState();
    const requestId = store.beginStagingPreflight("current", lease);
    store.failStagingPreflight(requestId, "current", lease, "IPC unavailable");
    expect(useImportStore.getState().stagingPreflight).toMatchObject({
      status: "failed",
      error: "IPC unavailable",
    });
  });
});

describe("legacy staging identifiers", () => {
  it("hydrates unsafe aliases and rename values unchanged without runtime preflight persistence", () => {
    const persisted = {
      subjectRenames: [
        { original: "002.12", target: "002.12" },
        { original: "FOO+BAR", target: "../escape" },
      ],
      sessionAliases: [{ captured: "one", alias: "CON", index: 1 }],
      runAliases: [
        { captured: "one", alias: "ASL/1", index: 1 },
        { captured: "two", alias: "asl/1", index: 2 },
        { captured: "three", alias: "é", index: 3 },
        { captured: "four", alias: "é", index: 4 },
      ],
    };
    useImportStore.getState().loadPersistedState(persisted);
    const state = useImportStore.getState();
    expect(state.subjectRenames).toEqual(persisted.subjectRenames);
    expect(state.sessionAliases).toEqual(persisted.sessionAliases);
    expect(state.runAliases).toEqual(persisted.runAliases);
    expect(state.stagingPreflight).toMatchObject({ status: "idle", issues: [] });
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
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "running" });
    setImportPhase("running");

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
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "pending" });
    setImportPhase("preparing");

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
    expect(useImportStore.getState().pendingImportConfig).not.toBeNull();

    const snapshot = useImportStore.getState().pendingImportConfig!;
    expect(snapshot.sourceDataPath).toBe("/data/project/sourcedata");

    // Mark subjects running, then completed
    store.markSubjectRunning("BAR");
    store.markSubjectRunning("FOO");
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("completed"));

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
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("completed"));
    const oldSnapshot = useImportStore.getState().mostRecentConfig;
    expect(oldSnapshot!.sourceDataPath).toBe("/data/project/sourcedata");

    // Mark completed, then re-visit
    store.markSubjectRunning("BAR");
    store.markSubjectRunning("FOO");

    // Change sourceDataPath (structural change)
    store.setSourceDataPath("/data/new-project/sourcedata");

    const staleness = computeStaleness(useImportStore.getState(), oldSnapshot);

    // All subjects stale due to structural change
    expect(staleness.BAR).toBe(true);
    expect(staleness.FOO).toBe(true);

    // re-run: startImport captures new snapshot
    store.startImport();
    const newSnapshot = useImportStore.getState().pendingImportConfig;

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
    expect(state.activeStep).toBe(4);
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
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "running" });
    setImportPhase("idle");

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

describe("authoritative import snapshot reconciliation", () => {
  beforeEach(() => {
    useImportStore.getState().resetImport();
    resetProjectLifecycleForTests();
    activateProjectLease("project-1", "/project");
  });

  it("binds runtime-only identity and populates selected subjects before output", () => {
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("preparing"));
    expect(useImportStore.getState()).toMatchObject({
      activeRunId: "import-run-1",
      ownershipGeneration: 4,
      importPhase: "preparing",
      importCompleted: false,
      importProgress: {
        BAR: { subject: "BAR", status: "pending" },
        FOO: { subject: "FOO", status: "pending" },
      },
    });
  });

  it("native running snapshots erase parser-only completion authority", () => {
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "completed",
      duration: 9,
    });
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("running"));
    expect(useImportStore.getState().importProgress.BAR.status).toBe("pending");
    expect(useImportStore.getState().importPhase).toBe("running");
  });

  it("terminal outcomes replace provisional progress while preserving partial commits", () => {
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    useImportStore.getState().markSubjectRunning("BAR");
    useImportStore.getState().reconcileImportRunSnapshot({
      ...nativeSnapshot("failed"),
      subjectOutcomes: [
        {
          subject: "BAR",
          outcome: "committed",
          readyLockVerified: true,
          rawdataVerified: true,
          committed: true,
        },
        {
          subject: "FOO",
          outcome: "failed",
          readyLockVerified: false,
          rawdataVerified: false,
          committed: false,
          error: { code: "readyLockMissing", message: "missing", subject: "FOO" },
        },
      ],
    });
    expect(useImportStore.getState()).toMatchObject({
      activeRunId: null,
      terminalRunId: "import-run-1",
      importPhase: "failed",
      importCompleted: false,
      importProgress: {
        BAR: { status: "completed" },
        FOO: { status: "failed", error: "missing" },
      },
      importSummary: { succeeded: 1, failed: 1 },
    });
  });

  it("retains structured launch preflight issues from an authoritative failed snapshot", () => {
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("preparing"));
    useImportStore.getState().reconcileImportRunSnapshot({
      ...nativeSnapshot("failed"),
      error: {
        code: "preflight",
        message: "Import staging preflight failed",
        stagingIssues: [
          {
            code: "PORTABLE_COLLISION",
            field: "destination",
            entryIndex: 0,
            conflictingEntryIndex: 1,
            message: "Two entries collide",
          },
        ],
      },
    });

    expect(useImportStore.getState().stagingPreflight).toMatchObject({
      status: "invalid",
      issues: [{ code: "PORTABLE_COLLISION", field: "destination" }],
    });
  });

  it("keeps invalid, parser-only, and interrupted evidence retryable while staleness overlays committed work", () => {
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    useImportStore.getState().markSubjectRunning("BAR");
    // Parser optimism cannot deselect BAR from retry.
    updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "completed",
    });
    useImportStore.getState().reconcileImportRunSnapshot({
      ...nativeSnapshot("failed"),
      subjectOutcomes: [
        {
          subject: "BAR",
          outcome: "failed",
          readyLockVerified: false,
          rawdataVerified: false,
          committed: false,
          error: { code: "readyLockMissing", message: "missing", subject: "BAR" },
        },
        {
          subject: "FOO",
          outcome: "committed",
          readyLockVerified: true,
          rawdataVerified: true,
          committed: true,
        },
      ],
    });
    useImportStore.getState().applyStaleness({ BAR: false, FOO: true });
    const progress = useImportStore.getState().importProgress;
    expect(progress.BAR).toMatchObject({ status: "failed", stale: false });
    expect(progress.FOO).toMatchObject({ status: "completed", stale: true });
    useImportStore
      .getState()
      .bindImportRunSnapshot(nativeSnapshot("interrupted", "interrupted-run"));
    expect(useImportStore.getState().importProgress.BAR.status).toBe("interrupted");
  });

  it("rejects stale run, generation, lease, and closed-admission snapshots", () => {
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    const lease = activateProjectLease("project-1", "/project");
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("finalizing", "other"));
    useImportStore.getState().reconcileImportRunSnapshot({
      ...nativeSnapshot("finalizing"),
      ownershipGeneration: 5,
    });
    activateProjectLease("project-2", "/other");
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("finalizing"), lease);
    expect(useImportStore.getState().importPhase).toBe("running");
    closeProjectWorkAdmission();
  });

  it.each(["cancelled", "interrupted"] as const)(
    "maps missing %s subject outcomes to retryable rows",
    (lifecycle) => {
      useImportStore.getState().bindImportRunSnapshot(nativeSnapshot(lifecycle));
      expect(useImportStore.getState().importProgress.BAR.status).toBe(lifecycle);
    },
  );

  it("commits attempted configuration only for authoritative completion", () => {
    const oldConfig = {
      sourceDataPath: "/old",
      pathPatterns: [],
      tokenizerConfigs: {},
      bMatchDirectories: true,
      modalityAliases: [],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [],
      subjectRows: [],
    };
    useImportStore.setState({
      sourceDataPath: "/new",
      subjectRows: [{ id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" }],
      mostRecentConfig: oldConfig,
    });
    useImportStore.getState().startImport(["BAR"]);
    expect(useImportStore.getState().mostRecentConfig).toBe(oldConfig);
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("failed"));
    expect(useImportStore.getState().mostRecentConfig).toBe(oldConfig);

    useImportStore.getState().resetImport();
    useImportStore.setState({
      selectedProfileId: "profile-1",
      sourceDataPath: "/new",
      subjectRows: [{ id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" }],
      mostRecentConfig: oldConfig,
    });
    useImportStore.getState().startImport(["BAR"]);
    useImportStore.getState().bindImportRunSnapshot(nativeSnapshot("running"));
    useImportStore.getState().reconcileImportRunSnapshot(nativeSnapshot("completed"));
    expect(useImportStore.getState().mostRecentConfig?.sourceDataPath).toBe("/new");
  });
});

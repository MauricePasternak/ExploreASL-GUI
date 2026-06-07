import { afterEach, describe, expect, it } from "vitest";

import type {
  MetadataGroup,
  PathPattern,
} from "../schemas/importSchemas";
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
    expect(useImportStore.getState().sourceDataPath).toBe(
      "/data/project/sourcedata",
    );
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
    const { setTokenAssignment, removeTokenAssignment } =
      useImportStore.getState();
    setTokenAssignment("sig", 0, null, "Subject");
    setTokenAssignment("sig", 2, null, "Modality");
    removeTokenAssignment("sig", 0, null);

    const configs = useImportStore.getState().tokenizerConfigs;
    expect(configs["sig"]).toHaveLength(1);
    expect(configs["sig"][0].blockIndex).toBe(2);
  });

  it("setTokenizerConfig replaces all assignments for a pattern", () => {
    const { setTokenAssignment, setTokenizerConfig } =
      useImportStore.getState();
    setTokenAssignment("sig", 0, null, "Subject");

    setTokenizerConfig("sig", [
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
    ]);

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
    const { setModalityAliases, updateModalityAlias } =
      useImportStore.getState();
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
    const { setSubjectRenames, updateSubjectRename } =
      useImportStore.getState();
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
    subjectRegExp: "",
    sessionRegExp: "",
    runRegExp: "",
  };

  it("addMetadataGroup appends a group", () => {
    const { addMetadataGroup } = useImportStore.getState();
    addMetadataGroup(defaultGroup);

    expect(useImportStore.getState().metadataGroups).toHaveLength(1);
    expect(useImportStore.getState().metadataGroups[0].id).toBe("global");
  });

  it("removeMetadataGroup removes by id", () => {
    const { addMetadataGroup, removeMetadataGroup } =
      useImportStore.getState();
    addMetadataGroup(defaultGroup);
    addMetadataGroup({ ...defaultGroup, id: "override-1", label: "Override" });
    removeMetadataGroup("global");

    const groups = useImportStore.getState().metadataGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("override-1");
  });

  it("updateMetadataGroup partially updates a group", () => {
    const { addMetadataGroup, updateMetadataGroup } =
      useImportStore.getState();
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
        id: "BAR/01/01",
        subject: "BAR",
        session: "01",
        run: "01",
        groupId: "global",
      },
    ];
    setSubjectRows(rows);
    expect(useImportStore.getState().subjectRows).toEqual(rows);
  });

  it("updateSubjectRowGroup changes group for selected rows", () => {
    const { setSubjectRows, updateSubjectRowGroup } =
      useImportStore.getState();
    setSubjectRows([
      {
        id: "BAR/01/01",
        subject: "BAR",
        session: "01",
        run: "01",
        groupId: "global",
      },
      {
        id: "FOO/01/01",
        subject: "FOO",
        session: "01",
        run: "01",
        groupId: "global",
      },
    ]);

    updateSubjectRowGroup(["BAR/01/01"], "override-1");

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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportRunSnapshot, ImportProgress } from "../schemas/importSchemas";
import type { ExecutionProfile } from "../schemas/executionProfile";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import {
  activateProjectLease,
  closeProjectWorkAdmission,
  resetProjectLifecycleForTests,
} from "../lib/projectLifecycle";
import { useGlobalStore } from "./globalStore";
import { acceptedImportSettings, useImportStore } from "./importStore";
import { useProjectStore } from "./projectStore";
import { projectFixture } from "../test/projectFixtures";
import { invoke } from "@tauri-apps/api/core";
import type { SidecarGroup_Serialize } from "../generated/bindings";

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
  confirmationRequired: false,
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
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  const snapshot = projectFixture();
  snapshot.document.uiState.import = {
    mostRecentConfig: null,
    selectedProfileId: "profile-1",
    currentPhase: "running",
  };
  useProjectStore.getState().acceptSnapshot(snapshot);
  activateProjectLease("project-1", "/project");
  vi.mocked(invoke).mockReset();
});

// Reset store state between tests
afterEach(() => {
  useImportStore.getState().resetImport();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------
describe("importStore initial state", () => {
  it("starts with import not running", () => {
    const state = useImportStore.getState();
    expect(state.importRunning).toBe(false);
    expect(state.importSummary).toBeNull();
    expect(state.importPhase).toBe("idle");
    expect(state.importCompleted).toBe(false);
    expect(state.importLog).toEqual([]);
  });
});

describe("accepted import edits", () => {
  it("targets token positions and preserves unrelated groups and rows", async () => {
    const before = projectFixture();
    before.document.mappingState = {
      tokenizerConfigs: {
        sig: [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
      metadataGroups: [
        { id: "global-defaults", label: "Global", bidsParams: {} },
        { id: "override", label: "Override", bidsParams: {} },
      ],
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "override" },
        { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
      ],
    };
    useProjectStore.getState().acceptSnapshot(before);
    const renamed = structuredClone(before);
    renamed.acceptedRevision = 1;
    renamed.document.mappingState.tokenizerConfigs!.sig = [
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
      { blockIndex: 0, subBlockIndex: null, tag: "Session" },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(renamed);
    useImportStore.getState().setTokenAssignment("sig", 0, null, "Session");
    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      edit: { kind: "import", mapping: renamed.document.mappingState },
    });
    const removed = structuredClone(renamed);
    removed.acceptedRevision = 2;
    removed.document.mappingState.tokenizerConfigs!.sig.splice(1, 1);
    vi.mocked(invoke).mockResolvedValueOnce(removed);
    useImportStore.getState().removeTokenAssignment("sig", 0, null);
    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
      edit: { mapping: removed.document.mappingState },
    });
    const regrouped = structuredClone(removed);
    regrouped.acceptedRevision = 3;
    regrouped.document.mappingState.metadataGroups!.splice(1, 1);
    regrouped.document.mappingState.subjectRows![0].groupId = "global-defaults";
    vi.mocked(invoke).mockResolvedValueOnce(regrouped);
    useImportStore.getState().removeMetadataGroup("override");
    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[2][1]).toMatchObject({
      edit: { mapping: regrouped.document.mappingState },
    });
    expect(acceptedImportSettings()).toMatchObject(regrouped.document.mappingState);
  });
});

// ---------------------------------------------------------------------------
// Step 5: Import Execution
// ---------------------------------------------------------------------------
describe("importStore import execution actions", () => {
  it("startImport prepares progress rows from subject rows", () => {
    const store = useImportStore.getState();
    useProjectStore.getState().project!.mappingState.subjectRows = [
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
    ];
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
});

// ---------------------------------------------------------------------------
// Execution profile selection (Group 8.1)
// ---------------------------------------------------------------------------
describe("importStore execution profile selection", () => {
  it("autoSelectProfile selects the first valid profile, skipping invalid ones", async () => {
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
    useProjectStore.getState().project!.uiState.import!.selectedProfileId = undefined;

    const accepted = { ...projectFixture(), acceptedRevision: 1 };
    accepted.document.uiState.import = { mostRecentConfig: null, selectedProfileId: "profile-1" };
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useImportStore.getState().autoSelectProfile();
    await useProjectStore.getState().flushEdits();
    expect(invoke).toHaveBeenCalledWith(
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ preferences: { selectedProfileId: "profile-1" } }),
      }),
    );

    expect(useProjectStore.getState().project?.uiState.import?.selectedProfileId).toBe("profile-1");
  });

  it("autoSelectProfile does not override an existing selection", () => {
    useImportStore.getState().autoSelectProfile();
    expect(useProjectStore.getState().project?.uiState.import?.selectedProfileId).toBe("profile-1");
  });

  it("autoSelectProfile leaves selection null when no valid profile exists", () => {
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [MATLAB_PROFILE] },
      profileValidationState: { "profile-1": { valid: false, errors: ["bad"] } },
    });
    useProjectStore.getState().project!.uiState.import!.selectedProfileId = undefined;

    useImportStore.getState().autoSelectProfile();

    expect(useProjectStore.getState().project?.uiState.import?.selectedProfileId).toBeUndefined();
  });

  it("startImport blocks with an inline error when no profile is selected (no failed transition)", () => {
    useProjectStore.getState().project!.uiState.import!.selectedProfileId = undefined;
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
    const store = useImportStore.getState();

    store.startImport();

    expect(useImportStore.getState().profileError).toBeTruthy();
    expect(useImportStore.getState().importPhase).not.toBe("failed");
    expect(useImportStore.getState().importPhase).toBe("idle");
  });

  it("startImport clears a stale profileError once a valid profile resolves", () => {
    useImportStore.setState({ profileError: "stale" });
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

    store.bindImportRunSnapshot(nativeSnapshot("running"));
    store.addLogLines(["old log"]);
    // Reset
    store.resetImport();

    const state = useImportStore.getState();
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

// ---------------------------------------------------------------------------
// mostRecentConfig (ImportSnapshot)
// ---------------------------------------------------------------------------
// Staleness during reconstruction
// ---------------------------------------------------------------------------
describe("importStore reconstruction staleness", () => {
  it("applies stale flag to matching subjects in importProgress", () => {
    const store = useImportStore.getState();
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "completed" });
    updateImportProgress("FOO", { subject: "FOO", session: "01", status: "completed" });

    store.reconstructProgressFromLockFiles(
      [
        { subject: "BAR", status: "completed" },
        { subject: "FOO", status: "completed" },
      ],
      ["BAR", "FOO"],
      { BAR: true, FOO: false },
    );

    expect(useImportStore.getState().importProgress.BAR.stale).toBe(true);
    expect(useImportStore.getState().importProgress.FOO.stale).toBe(false);
  });

  it("ignores subjects not present in importProgress", () => {
    const store = useImportStore.getState();
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "completed" });

    store.reconstructProgressFromLockFiles([{ subject: "BAR", status: "completed" }], ["BAR"], {
      BAR: true,
      MISSING: true,
    });

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

describe("current staging identifiers", () => {
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
    const snapshot = projectFixture();
    snapshot.document.mappingState = persisted;
    useProjectStore.getState().acceptSnapshot(snapshot);
    const state = acceptedImportSettings();
    expect(state.subjectRenames).toEqual(persisted.subjectRenames);
    expect(state.sessionAliases).toEqual(persisted.sessionAliases);
    expect(state.runAliases).toEqual(persisted.runAliases);
    expect(useImportStore.getState().stagingPreflight).toMatchObject({
      status: "idle",
      issues: [],
    });
  });
});

// ---------------------------------------------------------------------------
// reconstructProgressFromLockFiles
// ---------------------------------------------------------------------------
describe("importStore reconstructProgressFromLockFiles", () => {
  it("maps lock file completed/failed statuses to importProgress", () => {
    const store = useImportStore.getState();
    useProjectStore.getState().project!.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ];

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
    useProjectStore.getState().project!.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ];

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
    useProjectStore.getState().project!.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global-defaults" },
    ];

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
    useProjectStore.getState().project!.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ];
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
    useProjectStore.getState().project!.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ];
    updateImportProgress("BAR", { subject: "BAR", session: "01", status: "pending" });
    setImportPhase("preparing");

    const statuses: import("../lib/importStatus").ImportSubjectStatus[] = [
      { subject: "BAR", status: "completed" },
    ];

    store.reconstructProgressFromLockFiles(statuses, ["BAR"], {});

    expect(useImportStore.getState().importProgress.BAR.status).toBe("pending");
  });

  it("preserves existing session when reconstructing", () => {
    const store = useImportStore.getState();
    useProjectStore.getState().project!.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ];
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
  const SAMPLE_DERIVED_GROUP = {
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
  } satisfies import("../schemas/importSchemas").DerivedMetadataGroup;
  const { id: fingerprintHash, ...group } = SAMPLE_DERIVED_GROUP;
  const SAMPLE_SIDECAR_GROUP = { ...group, fingerprintHash } satisfies SidecarGroup_Serialize;

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
      groups: [SAMPLE_SIDECAR_GROUP],
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
      groups: [SAMPLE_SIDECAR_GROUP],
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
      groups: [SAMPLE_SIDECAR_GROUP],
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
      groups: [SAMPLE_SIDECAR_GROUP],
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

  it("startBidsScan rejects unsupported scientific metadata from a native-shaped response", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      groups: [
        {
          ...SAMPLE_SIDECAR_GROUP,
          bidsParams: { ...SAMPLE_SIDECAR_GROUP.bidsParams, ASLContext: "unexpected" },
        },
      ],
      skipped: [],
    });

    await useImportStore.getState().startBidsScan("/tmp/bad-metadata");

    const state = useImportStore.getState();
    expect(state.bidsReview.scanComplete).toBe(false);
    expect(state.bidsReview.scanError).toContain('Field "ASLContext"');
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
    useImportStore.getState().reconstructProgressFromLockFiles(
      [
        { subject: "BAR", status: "failed" },
        { subject: "FOO", status: "completed" },
      ],
      ["BAR", "FOO"],
      { BAR: false, FOO: true },
    );
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
});

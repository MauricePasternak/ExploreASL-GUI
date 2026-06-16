import { describe, expect, it } from "vitest";

import type { ImportSnapshot } from "../schemas/importSchemas";
import type { ImportState } from "../stores/importStore";
import { computeStaleness } from "./importStaleness";

const BASE_SNAPSHOT: ImportSnapshot = {
  sourceDataPath: "/data",
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

function makeState(overrides: Partial<ImportState> = {}): ImportState {
  return {
    ...useImportStoreInitialState(),
    ...overrides,
  } as ImportState;
}

function useImportStoreInitialState() {
  return {
    activeStep: 0,
    sourceDataPath: "",
    rawPaths: [],
    pathPatterns: [],
    bMatchDirectories: true,
    ingestionComplete: false,
    tokenizerConfigs: {},
    modalityAliases: [],
    sessionAliases: [],
    runAliases: [],
    subjectRenames: [],
    metadataGroups: [],
    subjectRows: [],
    importPhase: "idle" as const,
    importCompleted: false,
    importLog: [],
    failedSubjects: [],
    importProgress: {},
    importRunning: false,
    importSummary: null,
    mostRecentConfig: null,
    setActiveStep: () => {},
    setSourceDataPath: () => {},
    setIngestionResults: () => {},
    setBMatchDirectories: () => {},
    setTokenAssignment: () => {},
    removeTokenAssignment: () => {},
    setTokenizerConfig: () => {},
    setModalityAliases: () => {},
    updateModalityAlias: () => {},
    setSessionAliases: () => {},
    setRunAliases: () => {},
    setSubjectRenames: () => {},
    updateSubjectRename: () => {},
    addMetadataGroup: () => {},
    removeMetadataGroup: () => {},
    updateMetadataGroup: () => {},
    setSubjectRows: () => {},
    updateSubjectRowGroup: () => {},
    startImport: () => {},
    setImportPhase: () => {},
    addLogLine: () => {},
    addLogLines: () => {},
    markSubjectRunning: () => {},
    markSubjectCompleted: () => {},
    markSubjectFailed: () => {},
    markSubjectCancelled: () => {},
    completeImport: () => {},
    failImport: () => {},
    cancelImport: () => {},
    resetImportPhase: () => {},
    setImportRunning: () => {},
    updateImportProgress: () => {},
    setImportSummary: () => {},
    setMostRecentConfig: () => {},
    applyStaleness: () => {},
    reconstructProgressFromLockFiles: () => {},
    loadPersistedState: () => {},
    resetImport: () => {},
  };
}

describe("computeStaleness", () => {
  it("returns empty when snapshot is null", () => {
    const state = makeState();
    expect(computeStaleness(state, null)).toEqual({});
  });

  it("returns all subjects as not stale when no changes", () => {
    const rows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
    ];
    const state = makeState({
      sourceDataPath: "/data",
      subjectRows: rows,
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      subjectRows: rows,
    };
    expect(computeStaleness(state, snapshot)).toEqual({ BAR: false });
  });

  it("marks all subjects stale on structural change (sourceDataPath)", () => {
    const state = makeState({
      sourceDataPath: "/new-data",
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
        { id: "FOO/01", subject: "FOO", session: "01", groupId: "g1" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      sourceDataPath: "/data",
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true, FOO: true });
  });

  it("marks all subjects stale on tokenizer change", () => {
    const state = makeState({
      tokenizerConfigs: { sig: [{ blockIndex: 0, subBlockIndex: null, tag: "Subject" }] },
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      tokenizerConfigs: {},
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true });
  });

  it("marks all subjects stale on bMatchDirectories change", () => {
    const state = makeState({
      bMatchDirectories: false,
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      bMatchDirectories: true,
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true });
  });

  it("marks only affected group subjects stale on metadata change", () => {
    const metadataGroups = [
      { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "PCASL" as const } },
      { id: "g2", label: "G2", bidsParams: { ArterialSpinLabelingType: "PCASL" as const } },
    ];
    const rows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "g2" },
    ];
    const state = makeState({
      sourceDataPath: "/data",
      metadataGroups,
      subjectRows: rows,
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      metadataGroups: [
        { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "CASL" as const } },
        { id: "g2", label: "G2", bidsParams: { ArterialSpinLabelingType: "PCASL" as const } },
      ],
      subjectRows: rows,
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true, FOO: false });
  });

  it("marks subject stale when moved between groups", () => {
    const state = makeState({
      sourceDataPath: "/data",
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g2" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
      ],
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true });
  });

  it("marks all subjects stale on modalityAliases change", () => {
    const state = makeState({
      sourceDataPath: "/data",
      modalityAliases: [{ captured: "asl", mapped: "ASL4D" }],
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      modalityAliases: [],
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true });
  });

  it("marks subjects stale when their metadata group is deleted", () => {
    const state = makeState({
      sourceDataPath: "/data",
      metadataGroups: [
        { id: "g2", label: "G2", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
      ],
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
        { id: "FOO/01", subject: "FOO", session: "01", groupId: "g2" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      metadataGroups: [
        { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "CASL" } },
        { id: "g2", label: "G2", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
      ],
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
        { id: "FOO/01", subject: "FOO", session: "01", groupId: "g2" },
      ],
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true, FOO: false });
  });

  it("marks subjects stale when assigned to a new metadata group not in snapshot", () => {
    const state = makeState({
      sourceDataPath: "/data",
      metadataGroups: [
        { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
        { id: "g3", label: "G3", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
      ],
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g3" },
      ],
    });
    const snapshot: ImportSnapshot = {
      ...BASE_SNAPSHOT,
      metadataGroups: [
        { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
      ],
      subjectRows: [
        { id: "BAR/01", subject: "BAR", session: "01", groupId: "g1" },
      ],
    };
    const result = computeStaleness(state, snapshot);
    expect(result).toEqual({ BAR: true });
  });
});
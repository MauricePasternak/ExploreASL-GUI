import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { useDataParStore } from "./dataParStore";
import { useImportStore } from "./importStore";
import { useManifestStore } from "./manifestStore";
import { useProcessingStore } from "./processingStore";
import { useProjectStore } from "./projectStore";
import { resetProjectStores } from "./projectStoreHydration";
import { useVisualizationStore, acceptedVisualizationSettings } from "./visualizationStore";

describe("project store replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useImportStore.getState().resetImport();
    useDataParStore.getState().resetDataPar();
    useManifestStore.getState().resetManifest();
    useVisualizationStore.getState().reset();
    useProcessingStore.setState({
      processingPhase: "idle",
      availableSubjects: [],
      subjectStatuses: [],
      bidsCompatibilityError: null,
      profileError: null,
      preparingMessage: null,
    });
  });

  it("replaces populated project A with sparse project B defaults", () => {
    const projectA = projectView(projectFixture("a", "A", "/a"));
    projectA.mappingState = { sourceDataPath: "/a/source", rawPaths: ["a/scan"] };
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: true });
    useImportStore.setState({
      importLog: ["A log"],
      importPhase: "running",
      activeRunId: "old-run",
      importProgress: { a: { subject: "a", session: "01", status: "running" } },
      bidsReview: {
        scanComplete: true,
        scanError: "A error",
        detectedGroups: [],
        skippedSubjects: ["a"],
      },
    });
    useDataParStore.setState({
      drafts: { Sequence: "3D_GRASE" },
    });
    useProcessingStore.setState({
      processingPhase: "running",
      availableSubjects: [
        {
          subjectSession: "sub-a_01",
          subject: "sub-a",
          session: "01",
          hasStructural: true,
          hasASL: false,
          aslRuns: [],
        },
      ],
      subjectStatuses: [
        {
          subjectSession: "sub-a_01",
          module: "structural",
          status: "pending",
          completedSteps: [],
          locked: false,
        },
      ],
    });
    useManifestStore.setState({ qcLoaded: true, qcData: {}, filter: "fail", dataPar: { A: 1 } });
    useVisualizationStore.setState({
      availableFiles: [{ fileName: "a.tsv", relativePath: "a.tsv", size: 1, modified: "now" }],
      selectedPointId: "a",
    });
    projectA.uiState.dataVis = {
      ...projectFixture("a", "A", "/a", {
        uiState: { dataVis: { stage: "visualize", columnTypes: { a: "continuous" } } },
      }).document.uiState.dataVis!,
    };

    const snapshotB = projectFixture("b", "B", "/b");
    resetProjectStores();
    useProjectStore.getState().acceptSnapshot(snapshotB);
    const projectB = projectView(snapshotB);

    expect(useProjectStore.getState()).toMatchObject({
      project: projectB,
      loaded: true,
      isDirty: false,
    });
    expect(useImportStore.getState()).toMatchObject({
      importLog: [],
      importProgress: {},
      importPhase: "idle",
      activeRunId: null,
      terminalRunId: null,
      bidsReview: { scanComplete: false, scanError: null, skippedSubjects: [] },
    });
    expect(useDataParStore.getState()).toMatchObject({
      drafts: {},
    });
    expect(useProjectStore.getState().project?.mappingState).toEqual({});
    expect(useProjectStore.getState().project?.dataPar).toEqual({});
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "idle",
      availableSubjects: [],
      subjectStatuses: [],
    });
    expect(useManifestStore.getState()).toMatchObject({
      filter: "all",
      qcData: null,
      qcLoaded: false,
      dataPar: null,
    });
    expect(useVisualizationStore.getState()).toMatchObject({
      availableFiles: [],
      selectedPointId: null,
    });
    expect(acceptedVisualizationSettings()).toMatchObject({ stage: "selectData", columnTypes: {} });
  });

  it("hydrates project B persisted slices over current defaults", () => {
    const snapshotB = projectFixture("b", "B", "/b", {
      uiState: { dataVis: { stage: "columnTypes", pointSize: 14 } },
    });
    snapshotB.document = {
      ...snapshotB.document,
      mappingState: { sourceDataPath: "./source", bMatchDirectories: false },
      dataPar: { Sequence: "2D_EPI" },
      uiState: {
        ...snapshotB.document.uiState,
        import: {
          mostRecentConfig: null,
          activeStep: 1,
          completed: true,
          bidsReviewConfirmed: false,
          skippedSubjects: [],
        },
        processing: { currentPhase: "completed" },
        datapar: {
          advancedVisibility: {
            showAdvancedSections: true,
            showAdvancedM0Params: false,
            showAdvancedQuantification: false,
            showAdvancedGeneralSettings: false,
            showAdvancedASLProcessing: false,
            showAdvancedAtlases: false,
          },
        },
        dataVis: snapshotB.document.uiState.dataVis,
      },
    };

    snapshotB.acceptedRevision = 1;
    resetProjectStores();
    useProjectStore.getState().acceptSnapshot(snapshotB);

    expect(useProjectStore.getState().project).toMatchObject({
      mappingState: { sourceDataPath: "./source", bMatchDirectories: false },
      dataPar: { Sequence: "2D_EPI" },
      uiState: {
        import: { completed: true },
        processing: { currentPhase: "completed" },
        datapar: { advancedVisibility: { showAdvancedSections: true } },
        dataVis: { stage: "columnTypes", pointSize: 14 },
      },
    });
    expect(useProcessingStore.getState()).toMatchObject({ processingPhase: "idle" });
    expect(useVisualizationStore.getState()).toMatchObject({
      chartData: [],
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
  });
});

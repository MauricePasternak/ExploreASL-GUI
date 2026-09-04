import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROJECT_FILE, type ProjectFile } from "../schemas/project";
import { useDataParStore } from "./dataParStore";
import { useImportStore } from "./importStore";
import { useManifestStore } from "./manifestStore";
import { useProcessingStore } from "./processingStore";
import { useProjectStore } from "./projectStore";
import { hydrateProjectStores } from "./projectStoreHydration";
import { useVisualizationStore } from "./visualizationStore";

describe("project store replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useImportStore.getState().resetImport();
    useDataParStore.getState().resetDataPar();
    useManifestStore.getState().resetManifest();
    useVisualizationStore.getState().reset();
    useProcessingStore.setState({
      processingPhase: "idle",
      config: null,
      availableSubjects: [],
      subjectStatuses: [],
      workerPids: [],
      pendingRawdataWarning: null,
      profileError: null,
      preparingMessage: null,
    });
  });

  it("replaces populated project A with sparse project B defaults", () => {
    const projectA = DEFAULT_PROJECT_FILE("a", "A", "/a");
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: true });
    useImportStore.setState({
      sourceDataPath: "/a/source",
      rawPaths: ["a/scan"],
      importLog: ["A log"],
      importProgress: { a: { subject: "a", session: "01", status: "running" } },
      bidsReview: {
        scanComplete: true,
        scanError: "A error",
        detectedGroups: [],
        skippedSubjects: ["a"],
      },
    });
    useDataParStore.setState({
      dataPar: { Sequence: "3D_GRASE" },
      advancedVisibility: {
        showAdvancedSections: true,
        showAdvancedM0Params: true,
        showAdvancedQuantification: true,
        showAdvancedGeneralSettings: true,
        showAdvancedASLProcessing: true,
        showAdvancedAtlases: true,
      },
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
      workerPids: [42],
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
      stage: "visualize",
      availableFiles: [{ fileName: "a.tsv", relativePath: "a.tsv", size: 1, modified: "now" }],
      selectedPointId: "a",
      columnTypes: { a: "continuous" },
    });

    const projectB: ProjectFile = {
      ...DEFAULT_PROJECT_FILE("b", "B", "/b"),
      uiState: {},
      mappingState: {},
      dataPar: {},
    };
    hydrateProjectStores(projectB, false);

    expect(useProjectStore.getState()).toMatchObject({
      project: projectB,
      loaded: true,
      isDirty: false,
    });
    expect(useImportStore.getState()).toMatchObject({
      sourceDataPath: "",
      rawPaths: [],
      importLog: [],
      importProgress: {},
      importPhase: "idle",
      bidsReview: { scanComplete: false, scanError: null, skippedSubjects: [] },
    });
    expect(useDataParStore.getState()).toMatchObject({
      dataPar: { Atlases: ["Total", "DeepWM"] },
      advancedVisibility: { showAdvancedSections: false },
    });
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "idle",
      config: null,
      availableSubjects: [],
      subjectStatuses: [],
      workerPids: [],
    });
    expect(useManifestStore.getState()).toMatchObject({
      filter: "all",
      qcData: null,
      qcLoaded: false,
      dataPar: null,
    });
    expect(useVisualizationStore.getState()).toMatchObject({
      stage: "selectData",
      columnTypes: {},
      availableFiles: [],
      selectedPointId: null,
    });
  });

  it("hydrates project B persisted slices over current defaults", () => {
    const projectB: ProjectFile = {
      ...DEFAULT_PROJECT_FILE("b", "B", "/b"),
      mappingState: { sourceDataPath: "./source", bMatchDirectories: false },
      dataPar: { Sequence: "2D_EPI" },
      uiState: {
        import: { activeStep: 1, completed: true, bidsReviewConfirmed: false, skippedSubjects: [] },
        processing: { currentPhase: "completed" },
        datapar: { advancedVisibility: { showAdvancedSections: true } as never },
        dataVis: { stage: "columnTypes", pointSize: 14 },
      },
    };

    hydrateProjectStores(projectB, true);

    expect(useImportStore.getState()).toMatchObject({
      sourceDataPath: "./source",
      bMatchDirectories: false,
      importCompleted: true,
    });
    expect(useDataParStore.getState()).toMatchObject({
      dataPar: { Sequence: "2D_EPI", Atlases: ["Total", "DeepWM"] },
      advancedVisibility: { showAdvancedSections: true, showAdvancedAtlases: false },
    });
    expect(useProcessingStore.getState()).toMatchObject({ processingPhase: "completed" });
    expect(useVisualizationStore.getState()).toMatchObject({
      stage: "columnTypes",
      pointSize: 14,
      chartData: [],
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
  });
});

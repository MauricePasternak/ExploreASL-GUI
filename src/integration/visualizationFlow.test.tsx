import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithMantine } from "../test/render";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock nivo (canvas not available in jsdom)
vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlotCanvas: () => <div data-testid="scatter-canvas" />,
}));
vi.mock("@nivo/swarmplot", () => ({
  ResponsiveSwarmPlotCanvas: () => <div data-testid="swarm-canvas" />,
}));

// Mock NiiVue
vi.mock("@niivue/niivue", () => ({
  Niivue: vi.fn().mockImplementation(() => ({
    attachToCanvas: vi.fn(),
    setRadiologicalConvention: vi.fn(),
    setSliceType: vi.fn(),
    setMultiplanarLayout: vi.fn(),
    setColormap: vi.fn(),
    addVolume: vi.fn(),
    broadcastTo: vi.fn(),
    updateGLVolume: vi.fn(),
    removeVolumeByIndex: vi.fn(),
    drawScene: vi.fn(),
    volumes: [],
    opts: { multiplanarShowRender: 2 },
    sliceTypeMultiplanar: 4,
    cleanup: vi.fn(),
  })),
  MULTIPLANAR_TYPE: { GRID: 2 },
  SHOW_RENDER: { ALWAYS: 1 },
  NVImage: { loadFromUrl: vi.fn().mockResolvedValue({ id: "image" }) },
}));

import { invoke } from "@tauri-apps/api/core";
import { useVisualizationStore, acceptedVisualizationSettings } from "../stores/visualizationStore";
import { useProjectStore } from "../stores/projectStore";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import VisualizationPage from "../pages/VisualizationPage";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "../lib/projectLifecycle";

const mockInvoke = vi.mocked(invoke);
let acceptedReply = projectFixture("test-id", "Test Project", "/tmp/test", {
  uiState: { dataVis: {} },
});

const mockFiles = [
  {
    fileName: "mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv",
    relativePath: "mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv",
    size: 1024,
    modified: "123456",
  },
];

const mockInspection = {
  columns: [
    {
      name: "participant_id",
      originalName: "participant_id",
      source: "qcbf" as const,
      units: "",
      inferredType: "nominal",
      levels: ["sub-X_01"],
      isIdentifier: true,
    },
    {
      name: "subject",
      originalName: "subject",
      source: "qcbf" as const,
      units: "",
      inferredType: "nominal",
      levels: ["sub-X"],
      isIdentifier: true,
    },
    {
      name: "session",
      originalName: "session",
      source: "qcbf" as const,
      units: "",
      inferredType: "nominal",
      levels: ["01"],
      isIdentifier: true,
    },
    {
      name: "run",
      originalName: "run",
      source: "qcbf" as const,
      units: "",
      inferredType: "nominal",
      levels: ["ASL_1"],
      isIdentifier: true,
    },
    {
      name: "GM_vol",
      originalName: "GM_vol",
      source: "qcbf" as const,
      units: "Liter",
      inferredType: "continuous",
      levels: [],
      isIdentifier: false,
    },
    {
      name: "Site",
      originalName: "Site",
      source: "qcbf" as const,
      units: "",
      inferredType: "nominal",
      levels: ["1", "2"],
      isIdentifier: false,
    },
  ],
  rowCount: 10,
  qcbfRowCount: 10,
  qcbfHash: "abc123",
  externalHash: null,
};

const mockRows = [
  {
    participant_id: "sub-X_01",
    subject: "sub-X",
    session: "01",
    run: "ASL_1",
    GM_vol: "0.64",
    Site: "1",
  },
];

const mockExtInspection = {
  columns: [
    { name: "SubjectID", inferredType: "nominal", levels: ["sub-X_01"], isIdentifier: true },
    { name: "Diagnosis", inferredType: "nominal", levels: ["Ctrl", "AD"], isIdentifier: false },
  ],
  rowCount: 10,
  fileHash: "ext123",
  sheetName: null,
};

describe("Visualization setup flow integration", () => {
  beforeEach(() => {
    resetProjectLifecycleForTests();
    // Reset stores
    useVisualizationStore.getState().reset();
    acceptedReply = {
      ...projectFixture("test-id", "Test Project", "/tmp/test", { uiState: { dataVis: {} } }),
      acceptedRevision: 1,
    };

    useProjectStore.setState({
      project: projectView(
        projectFixture("test-id", "Test Project", "/tmp/test", { uiState: { dataVis: {} } }),
      ),
      isDirty: false,
      loaded: true,
    });
    activateProjectLease("test-id", "/tmp/test");

    // Default mock: list_stats_files returns files
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_stats_files") return Promise.resolve(mockFiles);
      if (cmd === "load_qcbf_data") return Promise.resolve(mockInspection);
      if (cmd === "read_data_columns") return Promise.resolve(mockRows);
      if (cmd === "set_active_project") return Promise.resolve(undefined);
      if (cmd === "inspect_external_data") return Promise.resolve(mockExtInspection);
      if (cmd === "accept_project_edit") return Promise.resolve(acceptedReply);
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
  });

  it("discards a late stats scan after same-ID project replacement", async () => {
    let resolveFiles!: (files: typeof mockFiles) => void;
    mockInvoke.mockImplementation((command: string) => {
      if (command === "list_stats_files") {
        return new Promise((resolve) => {
          resolveFiles = resolve;
        });
      }
      return Promise.resolve([]);
    });
    activateProjectLease("same-id", "/tmp/test");
    renderWithMantine(<VisualizationPage />);
    await vi.waitFor(() => expect(resolveFiles).toBeTypeOf("function"));

    invalidateProjectLease();
    activateProjectLease("same-id", "/tmp/replacement");
    useVisualizationStore.getState().reset();
    useVisualizationStore.setState({
      availableFiles: [
        { fileName: "replacement.tsv", relativePath: "replacement.tsv", size: 1, modified: "1" },
      ],
    });
    resolveFiles(mockFiles);
    await Promise.resolve();

    expect(useVisualizationStore.getState().availableFiles).toEqual([
      { fileName: "replacement.tsv", relativePath: "replacement.tsv", size: 1, modified: "1" },
    ]);
  });

  it("discards late contract validation after project replacement", async () => {
    let resolveInspection!: (inspection: typeof mockInspection) => void;
    mockInvoke.mockImplementation((command: string) => {
      if (command === "list_stats_files") return Promise.resolve(mockFiles);
      if (command === "load_qcbf_data") {
        return new Promise((resolve) => {
          resolveInspection = resolve;
        });
      }
      return Promise.resolve([]);
    });
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "old.tsv", fileHash: "abc123" },
      stage: "visualize",
    });
    activateProjectLease("same-id", "/tmp/test");
    renderWithMantine(<VisualizationPage />);
    await vi.waitFor(() => expect(resolveInspection).toBeTypeOf("function"));

    invalidateProjectLease();
    activateProjectLease("same-id", "/tmp/replacement");
    useVisualizationStore.getState().reset();
    useProjectStore.getState().project!.uiState.dataVis = undefined;
    resolveInspection(mockInspection);
    await Promise.resolve();

    expect(useVisualizationStore.getState().inspection).toBeNull();
    expect(acceptedVisualizationSettings()).toMatchObject({
      qcbfSource: null,
      stage: "selectData",
    });
  });

  it("discards a late external-file focus check after replacement", async () => {
    let resolveStat!: (stats: { mtime: string; size: number }) => void;
    let deferStat = false;
    mockInvoke.mockImplementation((command: string) => {
      if (command === "list_stats_files") return Promise.resolve(mockFiles);
      if (command === "stat_file") {
        if (!deferStat) return Promise.resolve({ mtime: "1000", size: 1 });
        return new Promise((resolve) => {
          resolveStat = resolve;
        });
      }
      if (command === "execute_join") {
        return Promise.resolve({ ...mockInspection, externalHash: "ext123" });
      }
      if (command === "inspect_external_data") return Promise.resolve(mockExtInspection);
      return Promise.resolve([]);
    });
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "old.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/external/old.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: [""],
        delimiter: ",",
      },
    });
    useVisualizationStore.getState()._setLastExtMtime("1000");
    activateProjectLease("same-id", "/tmp/test");
    renderWithMantine(<VisualizationPage />);
    await vi.waitFor(() => expect(useVisualizationStore.getState().inspection).not.toBeNull());
    deferStat = true;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(resolveStat).toBeTypeOf("function"));

    invalidateProjectLease();
    activateProjectLease("same-id", "/tmp/replacement");
    useVisualizationStore.getState().reset();
    useProjectStore.getState().project!.uiState.dataVis = undefined;
    resolveStat({ mtime: "2000", size: 2 });
    await Promise.resolve();

    expect(useVisualizationStore.getState()._lastExtMtime).toBeNull();
    expect(acceptedVisualizationSettings().joinConfig).toBeNull();
  });

  it("renders the visualization page with stepper", async () => {
    renderWithMantine(<VisualizationPage />);
    expect(await screen.findByTestId("visualization-page")).toBeInTheDocument();
    expect(await screen.findByTestId("visualization-stepper")).toBeInTheDocument();
  });

  it("shows file dropdown in step 1", async () => {
    renderWithMantine(<VisualizationPage />);
    const dropdown = await screen.findByTestId("qcbf-file-dropdown");
    expect(dropdown).toBeInTheDocument();
  });

  it("shows invalidation banner on hash mismatch", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_stats_files") return Promise.resolve(mockFiles);
      if (cmd === "load_qcbf_data")
        return Promise.resolve({ ...mockInspection, qcbfHash: "different_hash" });
      if (cmd === "accept_project_edit") return Promise.resolve(acceptedReply);
      return Promise.resolve([]);
    });

    // Set a contract with a hash that won't match
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      stage: "visualize",
    });

    renderWithMantine(<VisualizationPage />);
    const banner = await screen.findByTestId("invalidation-banner");
    expect(banner).toBeInTheDocument();
  });

  it("re-populates inspection and enables next button when loaded with valid contract", async () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      stage: "selectData",
    });

    renderWithMantine(<VisualizationPage />);

    // Wait for validateContract to run and check that Next button is enabled
    const nextBtn = await screen.findByTestId("stepper-next-btn");
    expect(nextBtn).not.toBeDisabled();

    // Check that inspection is populated in store
    expect(useVisualizationStore.getState().inspection).toEqual(mockInspection);
  });

  it("keeps the selected point loaded when opening the settings drawer", async () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      stage: "visualize",
      axisAssignment: { x: "Site", y: "GM_vol", colorBy: null },
      columnTypes: { Site: "nominal", GM_vol: "continuous" },
    });
    useVisualizationStore.setState({
      inspection: mockInspection,
      chartData: [
        {
          id: "sub-X_01",
          x: "1",
          y: 0.64,
          participantId: "sub-X",
          subject: "sub-X",
          session: "01",
          run: "ASL_1",
        },
      ],
      selectedPointId: "sub-X_01",
    });
    acceptedReply = {
      ...projectFixture("test-id", "Test Project", "/tmp/test", {
        uiState: {
          dataVis: {
            ...useProjectStore.getState().project!.uiState.dataVis,
            filtersExpanded: true,
          },
        },
      }),
      acceptedRevision: 1,
    };

    renderWithMantine(<VisualizationPage />);

    // Select point AFTER mount/render
    expect(screen.getByTestId("visualization-page")).toHaveStyle({ overflowY: "visible" });
    expect(screen.getByTestId("visualization-page").style.height).toBe("");
    expect(screen.getByTestId("visualization-stepper")).toHaveStyle({ minHeight: "auto" });
    useVisualizationStore.getState().selectPoint("sub-X_01");

    // Check that the point is successfully selected
    expect(useVisualizationStore.getState().selectedPointId).toBe("sub-X_01");

    // Open settings drawer
    useVisualizationStore.getState().setFiltersExpanded(true);
    await useProjectStore.getState().flushEdits();

    // Verify selected point is still selected
    expect(useVisualizationStore.getState().selectedPointId).toBe("sub-X_01");
  });

  it("calls execute_join when Next is clicked with join configured", async () => {
    const mockJoinedInspection = {
      ...mockInspection,
      columns: [
        ...mockInspection.columns,
        {
          name: "Diagnosis",
          originalName: "Diagnosis",
          source: "external" as const,
          units: "",
          inferredType: "nominal",
          levels: ["HC", "FTD"],
          isIdentifier: false,
        },
      ],
      qcbfHash: "abc123",
      externalHash: "ext123",
    };

    mockInvoke.mockImplementation((cmd: string, args: any) => {
      if (cmd === "list_stats_files") return Promise.resolve(mockFiles);
      if (cmd === "load_qcbf_data") return Promise.resolve(mockInspection);
      if (cmd === "execute_join") {
        expect(args.qcbfRelativePath).toBe("test.tsv");
        expect(args.externalAbsolutePath).toBe("/tmp/external.csv");
        return Promise.resolve(mockJoinedInspection);
      }
      if (cmd === "inspect_external_data") return Promise.resolve(mockExtInspection);
      if (cmd === "accept_project_edit") return Promise.resolve(acceptedReply);
      return Promise.resolve([]);
    });

    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
      stage: "selectData",
    });
    useVisualizationStore.getState().setInspection(mockInspection);
    acceptedReply = {
      ...projectFixture("test-id", "Test Project", "/tmp/test", {
        uiState: {
          dataVis: { ...useProjectStore.getState().project!.uiState.dataVis, stage: "columnTypes" },
        },
      }),
      acceptedRevision: 1,
    };

    renderWithMantine(<VisualizationPage />);

    // Click next button
    const nextBtn = await screen.findByTestId("stepper-next-btn");
    expect(nextBtn).not.toBeDisabled();
    nextBtn.click();

    // Wait for state transition
    await vi.waitFor(() => {
      expect(acceptedVisualizationSettings().stage).toBe("columnTypes");
    });

    expect(useVisualizationStore.getState().inspection).toEqual(mockJoinedInspection);
  });

  it("keeps missing external setup while exposing qCBF-only data and Relink", async () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: {
          absolutePath: "/missing/external.csv",
          fileHash: "ext123",
          sheetName: null,
        },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: [""],
        delimiter: ",",
      },
      columnTypes: { Diagnosis: "nominal" },
      levelOrderings: { Diagnosis: ["HC", "FTD"] },
      axisAssignment: { x: "Diagnosis", y: "GM_vol", colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: 10, yMax: 90 },
      stage: "selectData",
    });
    useVisualizationStore.setState({
      externalSourceAvailability: {
        status: "missing",
        savedPath: "/missing/external.csv",
        message: "The saved external visualization file is missing. Relink it.",
      },
    });
    mockInvoke.mockImplementation((command: string) => {
      if (command === "list_stats_files") return Promise.resolve(mockFiles);
      if (command === "execute_join" || command === "inspect_external_data") {
        return Promise.reject(new Error("File not found"));
      }
      if (command === "load_qcbf_data") return Promise.resolve(mockInspection);
      return Promise.resolve([]);
    });

    renderWithMantine(<VisualizationPage />);

    expect(await screen.findByTestId("visualization-missing-source-warning")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("external-source-warning")).toBeInTheDocument();
    expect(screen.getByTestId("external-source-path")).toHaveTextContent("/missing/external.csv");
    expect(screen.getByTestId("external-source-relink-btn")).toBeInTheDocument();
    expect(screen.getByTestId("stepper-next-btn")).toBeDisabled();
    await vi.waitFor(() =>
      expect(useVisualizationStore.getState().inspection).toEqual(mockInspection),
    );
    expect(acceptedVisualizationSettings()).toMatchObject({
      joinConfig: {
        externalSource: { absolutePath: "/missing/external.csv", fileHash: "ext123" },
        keys: [{ left: "participant_id", right: "SubjectID" }],
      },
      columnTypes: { Diagnosis: "nominal" },
      levelOrderings: { Diagnosis: ["HC", "FTD"] },
      axisAssignment: { x: "Diagnosis", y: "GM_vol", colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: 10, yMax: 90 },
    });
  });

  it("re-validates external file on window focus", async () => {
    // Setup state
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
      stage: "selectData",
    });
    useVisualizationStore.setState({ inspection: mockInspection, _lastExtMtime: "1000" });

    const mockJoinedInspection = {
      ...mockInspection,
      columns: [
        ...mockInspection.columns,
        {
          name: "Diagnosis",
          originalName: "Diagnosis",
          source: "external" as const,
          units: "",
          inferredType: "nominal",
          levels: ["HC", "FTD"],
          isIdentifier: false,
        },
      ],
      qcbfHash: "abc123",
      externalHash: "ext123", // unchanged content
    };

    let statMtime = "1000";
    let statShouldFail = false;
    let executeJoinHash = "ext123";

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_stats_files") return Promise.resolve(mockFiles);
      if (cmd === "stat_file") {
        if (statShouldFail) return Promise.reject("File not found");
        return Promise.resolve({ mtime: statMtime, size: 123 });
      }
      if (cmd === "execute_join") {
        return Promise.resolve({
          ...mockJoinedInspection,
          externalHash: executeJoinHash,
        });
      }
      if (cmd === "load_qcbf_data") {
        return Promise.resolve(mockInspection);
      }
      if (cmd === "inspect_external_data") {
        return Promise.resolve(mockExtInspection);
      }
      return Promise.resolve([]);
    });

    renderWithMantine(<VisualizationPage />);

    // Scenario 1: Focus event when mtime is unchanged (mtime = "1000")
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(acceptedVisualizationSettings().joinConfig).not.toBeNull();
    expect(screen.queryByTestId("invalidation-banner")).toBeNull();

    // Scenario 2: Focus event when mtime is changed (mtime = "2000"), but hash is identical ("ext123")
    statMtime = "2000";
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState()._lastExtMtime).toBe("2000");
    });
    expect(acceptedVisualizationSettings().joinConfig).not.toBeNull();
    expect(screen.queryByTestId("invalidation-banner")).toBeNull();

    // Scenario 3: Focus event when mtime is changed (mtime = "3000"), and hash changes to "ext456"
    statMtime = "3000";
    executeJoinHash = "ext456";
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState().externalSourceAvailability.status).toBe("changed");
    });
    expect(acceptedVisualizationSettings().joinConfig).not.toBeNull();
    expect(useVisualizationStore.getState().inspection).toEqual(mockInspection);
    expect(await screen.findByTestId("visualization-missing-source-warning")).toHaveTextContent(
      "External data content changed",
    );

    // Scenario 4: Focus event when stat_file fails (file deleted)
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
      stage: "selectData",
    });
    useVisualizationStore.setState({ inspection: mockInspection, _lastExtMtime: "3000" });
    statShouldFail = true;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState().externalSourceAvailability.status).toBe("missing");
    });
    expect(acceptedVisualizationSettings().joinConfig).not.toBeNull();
    expect(useVisualizationStore.getState().inspection).toEqual(mockInspection);
    const errorBanner = await screen.findByTestId("visualization-missing-source-warning");
    expect(errorBanner).toHaveTextContent("missing");
    expect(screen.getByTestId("visualization-missing-source-path")).toHaveTextContent(
      "/tmp/external.csv",
    );
  });
});

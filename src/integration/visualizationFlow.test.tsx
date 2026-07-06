import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

afterEach(cleanup);

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

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
    loadVolumes: vi.fn().mockResolvedValue(undefined),
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
}));

import { invoke } from "@tauri-apps/api/core";
import { useVisualizationStore } from "../stores/visualizationStore";
import { useProjectStore } from "../stores/projectStore";
import VisualizationPage from "../pages/VisualizationPage";

const mockInvoke = vi.mocked(invoke);

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
    // Reset stores
    useVisualizationStore.setState({
      qcbfSource: null,
      joinConfig: null,
      columnTypes: {},
      identifiers: null,
      levelOrderings: {},
      axisAssignment: { x: null, y: null, colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
      stage: "selectData",
      splitRatio: 0.6,
      filtersExpanded: false,
      availableFiles: [],
      inspection: null,
      chartData: [],
      selectedPointId: null,
      viewerState: { status: "idle" },
      viewerError: null,
      webglAvailable: false,
      exclusionCount: { plotted: 0, excluded: 0 },
    });

    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "test-id",
          name: "Test Project",
          rootPath: "/tmp/test",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
          dataSource: "dicom" as const,
        },
        uiState: { processing: { population: { completed: true } } },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    // Default mock: list_stats_files returns files
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_stats_files") return Promise.resolve(mockFiles);
      if (cmd === "load_qcbf_data") return Promise.resolve(mockInspection);
      if (cmd === "read_data_columns") return Promise.resolve(mockRows);
      if (cmd === "set_active_project") return Promise.resolve(undefined);
      if (cmd === "inspect_external_data") return Promise.resolve(mockExtInspection);
      return Promise.resolve([]);
    });
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
      return Promise.resolve([]);
    });

    // Set a contract with a hash that won't match
    useVisualizationStore.setState({
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      stage: "visualize",
    });

    renderWithMantine(<VisualizationPage />);
    const banner = await screen.findByTestId("invalidation-banner");
    expect(banner).toBeInTheDocument();
  });

  it("re-populates inspection and enables next button when loaded with valid contract", async () => {
    useVisualizationStore.setState({
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
    useVisualizationStore.setState({
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      stage: "visualize",
      axisAssignment: { x: "Site", y: "GM_vol", colorBy: null },
      columnTypes: { Site: "nominal", GM_vol: "continuous" },
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

    renderWithMantine(<VisualizationPage />);

    // Select point AFTER mount/render
    useVisualizationStore.getState().selectPoint("sub-X_01");

    // Check that the point is successfully selected
    expect(useVisualizationStore.getState().selectedPointId).toBe("sub-X_01");

    // Open settings drawer
    useVisualizationStore.getState().setFiltersExpanded(true);

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
      return Promise.resolve([]);
    });

    useVisualizationStore.setState({
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
      stage: "selectData",
      inspection: mockInspection,
    });

    renderWithMantine(<VisualizationPage />);

    // Click next button
    const nextBtn = await screen.findByTestId("stepper-next-btn");
    expect(nextBtn).not.toBeDisabled();
    nextBtn.click();

    // Wait for state transition
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState().stage).toBe("columnTypes");
    });

    expect(useVisualizationStore.getState().inspection).toEqual(mockJoinedInspection);
  });

  it("re-validates external file on window focus", async () => {
    // Setup state
    useVisualizationStore.setState({
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
      stage: "selectData",
      inspection: mockInspection,
      _lastExtMtime: "1000",
    });

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

    expect(useVisualizationStore.getState().joinConfig).not.toBeNull();
    expect(screen.queryByTestId("invalidation-banner")).toBeNull();

    // Scenario 2: Focus event when mtime is changed (mtime = "2000"), but hash is identical ("ext123")
    statMtime = "2000";
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState()._lastExtMtime).toBe("2000");
    });
    expect(useVisualizationStore.getState().joinConfig).not.toBeNull();
    expect(screen.queryByTestId("invalidation-banner")).toBeNull();

    // Scenario 3: Focus event when mtime is changed (mtime = "3000"), and hash changes to "ext456"
    statMtime = "3000";
    executeJoinHash = "ext456";
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState().joinConfig).toBeNull();
    });
    const banner = await screen.findByTestId("invalidation-banner");
    expect(banner.textContent).toContain(
      "External data file has changed. Join configuration has been reset.",
    );

    // Scenario 4: Focus event when stat_file fails (file deleted)
    useVisualizationStore.setState({
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
      stage: "selectData",
      inspection: mockInspection,
      _lastExtMtime: "3000",
    });
    statShouldFail = true;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => {
      expect(useVisualizationStore.getState().joinConfig).toBeNull();
    });
    const errorBanner = await screen.findByTestId("invalidation-banner");
    expect(errorBanner.textContent).toContain("External file 'external.csv' no longer exists.");
  });
});

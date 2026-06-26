import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import JoinConfig from "./JoinConfig";
import { invoke } from "@tauri-apps/api/core";

// Mock NiiVue since child components (like JoinDiagram / SanityChecks) are loaded
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

const mockInvoke = vi.mocked(invoke);

afterEach(() => {
  cleanup();
});

function renderComponent() {
  return render(
    <MantineProvider>
      <JoinConfig />
    </MantineProvider>,
  );
}

describe("JoinConfig", () => {
  beforeEach(() => {
    // Reset stores
    useVisualizationStore.setState({
      joinConfig: null,
      qcbfSource: null,
      inspection: null,
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
        },
        uiState: { population: { completed: true } },
        mappingState: {},
        exploreAslConfig: { sourcestructure: {}, studyPar: {}, dataPar: {} },
      },
    });
    mockInvoke.mockReset();
  });

  it("renders upload button when joinConfig is null", () => {
    renderComponent();
    expect(screen.getByTestId("browse-external-btn")).toBeInTheDocument();
  });

  it("auto-inspects external data on mount when joinConfig is present", async () => {
    const mockExtInspection = {
      columns: [
        { name: "Diagnosis", inferredType: "nominal", levels: ["Ctrl", "AD"], isIdentifier: false },
        { name: "Age", inferredType: "continuous", levels: [], isIdentifier: false },
      ],
      rowCount: 10,
      fileHash: "ext123",
      sheetName: null,
    };

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "inspect_external_data") {
        return Promise.resolve(mockExtInspection);
      }
      return Promise.resolve([]);
    });

    useVisualizationStore.setState({
      joinConfig: {
        externalSource: { absolutePath: "/tmp/external.csv", fileHash: "ext123", sheetName: null },
        keys: [{ left: "participant_id", right: "" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
    });

    renderComponent();

    // Verify it automatically invoked inspect_external_data
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("inspect_external_data", {
        absolutePath: "/tmp/external.csv",
        delimiter: ",",
      });
    });

    // Verify the columns from external data are available in the dropdown
    const select = screen.getByPlaceholderText("column from external data");
    expect(select).toBeInTheDocument();
  });

  it("resets Join Keys to an empty list when changing the external data file", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue("/tmp/new_external.csv");

    const mockExtInspection = {
      columns: [
        { name: "Diagnosis", inferredType: "nominal", levels: ["Ctrl", "AD"], isIdentifier: false },
        { name: "Age", inferredType: "continuous", levels: [], isIdentifier: false },
      ],
      rowCount: 10,
      fileHash: "ext456",
      sheetName: null,
    };

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "inspect_external_data") {
        return Promise.resolve(mockExtInspection);
      }
      return Promise.resolve([]);
    });

    // Set initial state with some existing keys
    useVisualizationStore.setState({
      joinConfig: {
        externalSource: {
          absolutePath: "/tmp/old_external.csv",
          fileHash: "ext123",
          sheetName: null,
        },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
    });

    renderComponent();

    // Verify change file button exists and click it
    const changeBtn = screen.getByTestId("change-external-btn");
    expect(changeBtn).toBeInTheDocument();
    changeBtn.click();

    // Wait for the state to be updated and check if joinConfig keys are reset to []
    await waitFor(() => {
      expect(useVisualizationStore.getState().joinConfig?.keys).toEqual([]);
    });
  });

  it("uses the project root as defaultPath when selecting external file for the first time", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue("/tmp/external.csv");

    // Initial state: joinConfig is null
    useVisualizationStore.setState({
      joinConfig: null,
    });

    renderComponent();

    const browseBtn = screen.getByTestId("browse-external-btn");
    expect(browseBtn).toBeInTheDocument();
    browseBtn.click();

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: "/tmp/test",
        }),
      );
    });
  });

  it("uses the current external file's directory as defaultPath when changing the external file", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue("/tmp/new_external.csv");

    const mockExtInspection = {
      columns: [],
      rowCount: 10,
      fileHash: "ext456",
      sheetName: null,
    };

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "inspect_external_data") {
        return Promise.resolve(mockExtInspection);
      }
      return Promise.resolve([]);
    });

    // Initial state: joinConfig points to /tmp/old_external.csv
    useVisualizationStore.setState({
      joinConfig: {
        externalSource: {
          absolutePath: "/tmp/some_dir/old_external.csv",
          fileHash: "ext123",
          sheetName: null,
        },
        keys: [],
        dropRightOn: true,
        naTokens: ["", "NaN"],
        delimiter: ",",
      },
    });

    renderComponent();

    const changeBtn = screen.getByTestId("change-external-btn");
    expect(changeBtn).toBeInTheDocument();
    changeBtn.click();

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: "/tmp/some_dir",
        }),
      );
    });
  });
});

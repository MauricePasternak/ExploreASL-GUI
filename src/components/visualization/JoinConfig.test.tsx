import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

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
    <MantineProvider env="test">
      <JoinConfig />
    </MantineProvider>,
  );
}

describe("JoinConfig", () => {
  beforeEach(() => {
    // Reset stores
    useVisualizationStore.getState().reset();
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
          dataSource: "dicom" as const,
        },
        uiState: { processing: { population: { completed: true } } },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
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

  it("warns without mutation when replacement hash differs", async () => {
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

    expect(await screen.findByTestId("external-relink-mismatch-dialog")).toBeInTheDocument();
    expect(useVisualizationStore.getState().joinConfig).toMatchObject({
      externalSource: { absolutePath: "/tmp/old_external.csv", fileHash: "ext123" },
      keys: [{ left: "participant_id", right: "SubjectID" }],
    });
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("updates only the path when a replacement hash matches", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("/tmp/new_external.csv");
    const inspection = {
      columns: [{ name: "Diagnosis", inferredType: "nominal", levels: ["A"], isIdentifier: false }],
      rowCount: 10,
      fileHash: "ext123",
      sheetName: null,
    };
    mockInvoke.mockImplementation((command) =>
      command === "inspect_external_data" ? Promise.resolve(inspection) : Promise.resolve([]),
    );
    useVisualizationStore.setState({
      joinConfig: {
        externalSource: {
          absolutePath: "/tmp/old_external.csv",
          fileHash: "ext123",
          sheetName: null,
        },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: [""],
        delimiter: ",",
      },
      columnTypes: { Diagnosis: "nominal" },
      levelOrderings: { Diagnosis: ["A"] },
      axisAssignment: { x: "Diagnosis", y: "qCBF", colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: 1, yMax: 2 },
      stage: "visualize",
    });

    renderComponent();
    await userEvent.click(screen.getByTestId("change-external-btn"));
    await waitFor(() =>
      expect(useVisualizationStore.getState().joinConfig?.externalSource.absolutePath).toBe(
        "/tmp/new_external.csv",
      ),
    );

    expect(useVisualizationStore.getState()).toMatchObject({
      joinConfig: { keys: [{ left: "participant_id", right: "SubjectID" }] },
      columnTypes: { Diagnosis: "nominal" },
      levelOrderings: { Diagnosis: ["A"] },
      axisAssignment: { x: "Diagnosis", y: "qCBF", colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: 1, yMax: 2 },
      stage: "visualize",
      requiresManualSave: true,
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(mockInvoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
  });

  it("preserves setup when a changed replacement is declined", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("/tmp/new_external.csv");
    mockInvoke.mockImplementation((command, args) => {
      if (command === "inspect_external_data") {
        return Promise.resolve({
          columns: [],
          rowCount: 10,
          fileHash:
            (args as { absolutePath: string }).absolutePath === "/tmp/new_external.csv"
              ? "changed"
              : "saved",
          sheetName: null,
        });
      }
      return Promise.resolve([]);
    });
    const saved = {
      externalSource: { absolutePath: "/tmp/old_external.csv", fileHash: "saved", sheetName: null },
      keys: [{ left: "participant_id", right: "SubjectID" }],
      dropRightOn: true,
      naTokens: [""],
      delimiter: ",",
    };
    useVisualizationStore.setState({ joinConfig: saved, columnTypes: { Diagnosis: "nominal" } });

    renderComponent();
    await userEvent.click(screen.getByTestId("change-external-btn"));
    await userEvent.click(await screen.findByTestId("external-relink-cancel-btn"));

    expect(useVisualizationStore.getState().joinConfig).toEqual(saved);
    expect(useVisualizationStore.getState().columnTypes).toEqual({ Diagnosis: "nominal" });
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("adopts a changed replacement and resets dependent setup only after confirmation", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("/tmp/new_external.csv");
    mockInvoke.mockImplementation((command, args) => {
      if (command === "inspect_external_data") {
        return Promise.resolve({
          columns: [],
          rowCount: 10,
          fileHash:
            (args as { absolutePath: string }).absolutePath === "/tmp/new_external.csv"
              ? "changed"
              : "saved",
          sheetName: null,
        });
      }
      return Promise.resolve([]);
    });
    useVisualizationStore.setState({
      joinConfig: {
        externalSource: {
          absolutePath: "/tmp/old_external.csv",
          fileHash: "saved",
          sheetName: null,
        },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: [""],
        delimiter: ",",
      },
      columnTypes: { Diagnosis: "nominal" },
      identifiers: { subject: "subject", session: "session", run: "run" },
      levelOrderings: { Diagnosis: ["A"] },
      axisAssignment: { x: "Diagnosis", y: "qCBF", colorBy: null },
      domainFilters: { xMin: 1, xMax: 2, yMin: 3, yMax: 4 },
      stage: "visualize",
    });

    renderComponent();
    await userEvent.click(screen.getByTestId("change-external-btn"));
    expect(useVisualizationStore.getState().joinConfig?.externalSource.absolutePath).toBe(
      "/tmp/old_external.csv",
    );
    await userEvent.click(await screen.findByTestId("external-relink-confirm-btn"));

    expect(useVisualizationStore.getState()).toMatchObject({
      joinConfig: {
        externalSource: { absolutePath: "/tmp/new_external.csv", fileHash: "changed" },
        keys: [],
      },
      columnTypes: {},
      identifiers: null,
      levelOrderings: {},
      axisAssignment: { x: null, y: null, colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
      stage: "selectData",
      requiresManualSave: true,
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
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

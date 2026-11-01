import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import {
  useVisualizationStore,
  acceptedVisualizationSettings,
} from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectView } from "../../schemas/project";
import { projectFixture } from "../../test/projectFixtures";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import JoinConfig from "./JoinConfig";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  vi.useRealTimers();
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
    resetProjectLifecycleForTests();
    useProjectStore.setState({
      project: projectView(
        projectFixture("test-id", "Test Project", "/tmp/test", { uiState: { dataVis: {} } }),
      ),
      isDirty: false,
      loaded: true,
    });
    activateProjectLease("test-id", "/tmp/test");
    mockInvoke.mockReset();
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

    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
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
        sheetName: null,
        delimiter: ",",
      });
    });

    // Verify the columns from external data are available in the dropdown
    const select = screen.getByPlaceholderText("column from external data");
    expect(select).toBeInTheDocument();
  });

  it("manual external path uses native inspection without opening a chooser", async () => {
    vi.mocked(open).mockClear();
    mockInvoke.mockRejectedValue(new Error("Unreadable external file"));
    renderComponent();
    fireEvent.click(screen.getByTestId("external-data-path"));
    fireEvent.change(screen.getByTestId("external-data-path-input"), {
      target: { value: "/study/covariates.xlsx" },
    });
    fireEvent.click(screen.getByTestId("external-data-path-confirm"));
    expect(
      await screen.findByText(/Failed to inspect external file: Unreadable external file/),
    ).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("inspect_external_data", {
      absolutePath: "/study/covariates.xlsx",
      sheetName: null,
      delimiter: "auto",
    });
    expect(open).not.toHaveBeenCalled();
    expect(acceptedVisualizationSettings().joinConfig).toBeNull();
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
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
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
    expect(acceptedVisualizationSettings().joinConfig).toMatchObject({
      externalSource: { absolutePath: "/tmp/old_external.csv", fileHash: "ext123" },
      keys: [{ left: "participant_id", right: "SubjectID" }],
    });
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("updates only the path when a replacement hash matches", async () => {
    vi.useFakeTimers();
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("/tmp/new_external.csv");
    const inspection = {
      columns: [{ name: "Diagnosis", inferredType: "nominal", levels: ["A"], isIdentifier: false }],
      rowCount: 10,
      fileHash: "ext123",
      sheetName: null,
    };
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
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
    const saved = useProjectStore.getState().project!.uiState.dataVis!;
    const accepted = {
      ...projectFixture("test-id", "Test Project", "/tmp/test", {
        uiState: {
          dataVis: {
            ...saved,
            joinConfig: {
              ...saved.joinConfig!,
              externalSource: {
                absolutePath: "/tmp/new_external.csv",
                fileHash: "ext123",
                sheetName: null,
              },
            },
          },
        },
      }),
      acceptedRevision: 1,
    };
    let acceptRelink!: () => void;
    const acceptance = new Promise<void>((resolve) => {
      acceptRelink = resolve;
    });
    mockInvoke.mockImplementation(async (command, args) => {
      if (
        command === "inspect_external_data" &&
        (args as { absolutePath: string }).absolutePath === "/tmp/old_external.csv"
      )
        return Promise.reject(new Error("Source unreadable"));
      if (command === "accept_project_edit") await acceptance;
      return Promise.resolve(
        command === "inspect_external_data"
          ? inspection
          : command === "save_project"
            ? { ...accepted, persistedRevision: 1 }
            : accepted,
      );
    });

    renderComponent();
    await vi.waitFor(() =>
      expect(screen.getByTestId("external-source-warning")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("change-external-btn"));
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("accept_project_edit", expect.anything()),
    );
    expect(useVisualizationStore.getState().externalSourceAvailability.status).toBe("unreadable");
    expect(acceptedVisualizationSettings().joinConfig?.externalSource.absolutePath).toBe(
      "/tmp/old_external.csv",
    );
    acceptRelink();
    await vi.waitFor(() =>
      expect(acceptedVisualizationSettings().joinConfig?.externalSource.absolutePath).toBe(
        "/tmp/new_external.csv",
      ),
    );
    expect(useVisualizationStore.getState().externalSourceAvailability).toEqual({
      status: "available",
      savedPath: "/tmp/new_external.csv",
      message: null,
    });
    expect(screen.queryByTestId("external-source-warning")).not.toBeInTheDocument();

    expect(acceptedVisualizationSettings()).toMatchObject({
      joinConfig: { keys: [{ left: "participant_id", right: "SubjectID" }] },
      columnTypes: { Diagnosis: "nominal" },
      levelOrderings: { Diagnosis: ["A"] },
      axisAssignment: { x: "Diagnosis", y: "qCBF", colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: 1, yMax: 2 },
      stage: "visualize",
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockInvoke).toHaveBeenCalledWith("save_project", { generation: 1 });
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("preserves queued delimiter and drop-column edits until both are accepted", async () => {
    const join = {
      externalSource: { absolutePath: "/tmp/external.csv", fileHash: "saved", sheetName: null },
      keys: [],
      dropRightOn: true,
      naTokens: [""],
      delimiter: ",",
    };
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, { joinConfig: join });
    let acceptFirst!: () => void;
    const firstAcceptance = new Promise<void>((resolve) => {
      acceptFirst = resolve;
    });
    const submitted: (typeof join)[] = [];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "inspect_external_data")
        return { columns: [], rowCount: 10, fileHash: "saved", sheetName: null };
      const config = (args as { edit: { config: { joinConfig: typeof join } } }).edit.config;
      submitted.push(config.joinConfig);
      if (submitted.length === 1) await firstAcceptance;
      return {
        ...projectFixture("test-id", "Test Project", "/tmp/test", { uiState: { dataVis: config } }),
        acceptedRevision: submitted.length,
      };
    });
    renderComponent();
    await userEvent.click(screen.getByTestId("delimiter-select"));
    await userEvent.click(screen.getByRole("option", { name: "Semicolon (;)" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    await userEvent.click(screen.getByTestId("drop-right-on-toggle"));
    expect(submitted).toHaveLength(1);
    expect(acceptedVisualizationSettings().joinConfig).toEqual(join);
    acceptFirst();
    await useProjectStore.getState().flushEdits();
    expect(submitted[1]).toEqual({ ...join, delimiter: ";", dropRightOn: false });
    expect(acceptedVisualizationSettings().joinConfig).toEqual(submitted[1]);
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
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      joinConfig: saved,
      columnTypes: { Diagnosis: "nominal" },
    });

    renderComponent();
    await userEvent.click(screen.getByTestId("change-external-btn"));
    await userEvent.click(await screen.findByTestId("external-relink-cancel-btn"));

    expect(acceptedVisualizationSettings().joinConfig).toEqual(saved);
    expect(acceptedVisualizationSettings().columnTypes).toEqual({ Diagnosis: "nominal" });
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
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
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
    const saved = useProjectStore.getState().project!.uiState.dataVis!;
    const accepted = {
      ...projectFixture("test-id", "Test Project", "/tmp/test", {
        uiState: {
          dataVis: {
            ...saved,
            joinConfig: {
              ...saved.joinConfig!,
              externalSource: {
                absolutePath: "/tmp/new_external.csv",
                fileHash: "changed",
                sheetName: null,
              },
              keys: [],
            },
            columnTypes: {},
            identifiers: null,
            levelOrderings: {},
            axisAssignment: { x: null, y: null, colorBy: null },
            domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
            stage: "selectData",
          },
        },
      }),
      acceptedRevision: 1,
    };
    useVisualizationStore.getState().selectPoint("old");

    renderComponent();
    await userEvent.click(screen.getByTestId("change-external-btn"));
    expect(acceptedVisualizationSettings().joinConfig?.externalSource.absolutePath).toBe(
      "/tmp/old_external.csv",
    );
    mockInvoke.mockResolvedValueOnce(accepted);
    await userEvent.click(await screen.findByTestId("external-relink-confirm-btn"));

    await useProjectStore.getState().flushEdits();
    expect(acceptedVisualizationSettings()).toMatchObject({
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
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(useVisualizationStore.getState().selectedPointId).toBeNull();
  });

  it("uses the project root as defaultPath when selecting external file for the first time", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue("/tmp/external.csv");

    // Initial state: joinConfig is null
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
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
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
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

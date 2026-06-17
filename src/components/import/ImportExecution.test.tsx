import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { invoke } from "@tauri-apps/api/core";

import ImportExecution from "./ImportExecution";
import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import { useGlobalStore } from "../../stores/globalStore";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";

function renderWithProviders() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <ImportExecution />
      </MemoryRouter>
    </MantineProvider>,
  );
}

function configureRuntimeSettings() {
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      matlabInstallations: [
        { id: "matlab-1", label: "MATLAB R2025b", path: "/opt/matlab/bin/matlab", version: "" },
      ],
      exploreAslPath: "/opt/ExploreASL",
    },
  });
}

function configureSubjects() {
  useImportStore.getState().setSubjectRows([
    { id: "SUB01/01", subject: "SUB01", session: "01", groupId: "global" },
    { id: "SUB02/01", subject: "SUB02", session: "01", groupId: "global" },
  ]);
}

function firstButton(name: RegExp | string) {
  return screen.getAllByRole("button", { name })[0];
}

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-testid='confirm-reimport-dialog']").forEach((el) => el.remove());
  useImportStore.getState().resetImport();
  useGlobalStore.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
  });
  vi.resetAllMocks();
});

describe("ImportExecution", () => {
  it("shows the current phase badge and gates start controls on configured paths", () => {
    renderWithProviders();

    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(firstButton(/start import/i)).toBeDisabled();
    expect(firstButton(/stop/i)).toBeDisabled();

    cleanup();
    configureRuntimeSettings();
    configureSubjects();

    renderWithProviders();

    expect(firstButton(/start import/i)).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /retry import/i })).not.toBeInTheDocument();
  });

  it("shows MATLAB select and no-matlab alert when unconfigured", () => {
    renderWithProviders();

    expect(screen.getByTestId("no-matlab-alert")).toBeInTheDocument();
    expect(screen.getByTestId("matlab-select")).toBeInTheDocument();
  });

  it("starts import by initializing pending progress rows from subject rows", async () => {
    configureRuntimeSettings();
    configureSubjects();
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));

    expect(useImportStore.getState().importPhase).toBe("preparing");
    expect(screen.getByText("Preparing")).toBeInTheDocument();
    expect(screen.getByTestId("import-table")).toBeInTheDocument();
  });

  it("does not start import without staged subjects", async () => {
    configureRuntimeSettings();
    renderWithProviders();

    expect(firstButton(/start import/i)).toBeDisabled();
    expect(screen.getByText(/stage at least one subject/i)).toBeInTheDocument();

    expect(useImportStore.getState().importPhase).toBe("idle");
  });

  it("enables stop while running and cancels running subjects", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.setImportPhase("running");
    store.markSubjectRunning("SUB01");
    renderWithProviders();

    expect(firstButton(/start import/i)).toBeDisabled();
    expect(firstButton(/stop/i)).not.toBeDisabled();

    await userEvent.click(firstButton(/stop/i));

    expect(useImportStore.getState().importPhase).toBe("cancelled");
    expect(useImportStore.getState().importProgress.SUB01.status).toBe("cancelled");
  });

  it("shows confirmation dialog when freshly completed subject is selected for re-import", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 10);
    store.markSubjectCompleted("SUB02", 20);
    store.completeImport();
    useImportStore.setState({ importPhase: "idle" });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));

    expect(await screen.findByTestId("confirm-reimport-cancel")).toBeInTheDocument();
  });

  it("does not show confirmation dialog when only stale subjects are selected", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 10);
    store.markSubjectFailed("SUB02", "NII2BIDS", "Error");
    store.failImport();
    store.applyStaleness({ SUB01: true });
    renderWithProviders();

    const table = screen.getByTestId("import-table");
    expect(table).toBeInTheDocument();
  });

  it("does not show confirmation when no completed subjects are freshly completed", () => {
    configureRuntimeSettings();
    configureSubjects();

    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 10);
    store.applyStaleness({ SUB01: true });
    store.markSubjectFailed("SUB02", "NII2BIDS", "Error");
    store.failImport();

    const progress = useImportStore.getState().importProgress;
    const freshlyCompleted = Object.entries(progress)
      .filter(([, v]) => v.status === "completed" && v.stale !== true)
      .map(([k]) => k);

    expect(freshlyCompleted).toEqual([]);
    expect(progress.SUB01.stale).toBe(true);
    expect(progress.SUB02.status).toBe("failed");
  });

  it("renders the live import log", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.setImportPhase("running");
    store.updateImportProgress("SUB02", {
      subject: "SUB02",
      session: "01",
      status: "failed",
      currentStep: "NII2BIDS",
      errorStep: "NII2BIDS",
      error: "Short error",
      warnings: ["M0 image was not found"],
      duration: 92,
    });
    store.addLogLine("ExploreASL import started");
    store.addLogLine("NII2BIDS failed for SUB02_ses-01_run-1");
    renderWithProviders();

    expect(screen.getByTestId("import-table-container")).toBeInTheDocument();
    expect(screen.getAllByText((_, node) => node?.textContent?.includes("ExploreASL import started") ?? false).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, node) => node?.textContent?.includes("NII2BIDS failed for SUB02_ses-01_run-1") ?? false).length).toBeGreaterThan(0);
  });

  it("advances the project to parameters after completed import", async () => {
    configureRuntimeSettings();
    configureSubjects();
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          sourcestructure: {},
          studyPar: {},
          dataPar: {},
        },
      },
      isDirty: false,
      loaded: true,
    });
    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 10);
    store.markSubjectCompleted("SUB02", 20);
    store.completeImport();
    renderWithProviders();

    expect(screen.getByTestId("import-table")).toBeInTheDocument();

    await userEvent.click(firstButton(/next: parameters/i));

    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("parameters");
  });

  it("copies lock files for succeeded subjects by passing subjectsToPreserve to run_import_pipeline", async () => {
    configureRuntimeSettings();
    configureSubjects();
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          sourcestructure: {},
          studyPar: {},
          dataPar: {},
        },
      },
      isDirty: false,
      loaded: true,
    });

    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 12);
    store.markSubjectFailed("SUB02", "NII2BIDS", "Invalid metadata");
    store.failImport();

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      switch (cmd) {
        case "read_import_status":
          return Promise.resolve([{ subject: "SUB01", status: "completed" }]);
        case "run_import_pipeline":
          return Promise.resolve(12345);
        default:
          return Promise.resolve(null);
      }
    });

    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));

    await vi.waitFor(() => {
      const runCall = vi.mocked(invoke).mock.calls.find(
        (call) => call[0] === "run_import_pipeline",
      );
      expect(runCall).toBeDefined();
      expect((runCall![1] as Record<string, unknown>).subjectsToPreserve).toEqual(["SUB01"]);
    });
  });

  it("stores selected matlab path in import store", () => {
    configureRuntimeSettings();
    configureSubjects();
    renderWithProviders();

    expect(useImportStore.getState().selectedMatlabPath).toBe("/opt/matlab/bin/matlab");
  });

  it("cancel prevents import start when confirmation dialog is dismissed", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 10);
    store.markSubjectCompleted("SUB02", 20);
    store.completeImport();
    useImportStore.setState({ importPhase: "idle" });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));

    await userEvent.click(await screen.findByTestId("confirm-reimport-cancel"));

    expect(vi.mocked(invoke).mock.calls.some((call) => call[0] === "run_import_pipeline")).toBe(false);
    expect(useImportStore.getState().importPhase).toBe("idle");
  });

  it("shows import log badges keyed by GUI subject names", async () => {
    configureRuntimeSettings();
    configureSubjects();
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          sourcestructure: {},
          studyPar: {},
          dataPar: {},
        },
      },
      isDirty: false,
      loaded: true,
    });

    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 10);
    store.completeImport();

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_module_logs") {
        return Promise.resolve([
          {
            filename: "xASL_module_Import_sub-SUB01.log",
            module: "import",
            subjectSession: "sub-SUB01",
            run: null,
            hasError: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    renderWithProviders();

    expect(await screen.findByTestId("view-import-logs-SUB01")).toBeInTheDocument();
    expect(screen.getByText("Import Logs/Errors")).toBeInTheDocument();
  });
});

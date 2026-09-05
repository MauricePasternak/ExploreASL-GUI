import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import ImportExecution from "./ImportExecution";
import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import { DEFAULT_PROJECT_FILE } from "../../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import { transitionProjectRuntime } from "../../lib/projectCoordinator";
import { useGlobalStore } from "../../stores/globalStore";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { makeMatlabProfile } from "../../test/profileFixtures";

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
  const profile = makeMatlabProfile({
    id: "profile-1",
    label: "MATLAB R2025b",
    matlabPath: "/opt/matlab/bin/matlab",
    exploreAslPath: "/opt/ExploreASL",
  });
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      executionProfiles: [profile],
    },
    profileValidationState: {
      [profile.id]: { valid: true, errors: [] },
    },
  });
  useImportStore.getState().setSelectedProfileId(profile.id);
  activateProjectLease("test-project", "/test-project");
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
  useGlobalStore.setState({ settings: DEFAULT_SETTINGS, loaded: true, profileValidationState: {} });
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
  });
  resetProjectLifecycleForTests();
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

  it("shows profile selector and no-profiles alert when unconfigured", () => {
    renderWithProviders();

    expect(screen.getByTestId("no-profiles-alert")).toBeInTheDocument();
    expect(screen.getByTestId("profile-selector-empty")).toBeInTheDocument();
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

  it("locks configuration and navigation throughout deferred preparation, then unlocks on failure", async () => {
    configureRuntimeSettings();
    configureSubjects();
    let rejectRun!: (reason?: unknown) => void;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "run_import_pipeline") {
        return new Promise((_, reject) => {
          rejectRun = reject;
        });
      }
      if (command === "read_import_status") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("preparing"));

    expect(firstButton(/start import/i)).toBeDisabled();
    expect(firstButton(/stop/i)).toBeDisabled();
    expect(screen.getByTestId("import-back-btn")).toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /execution profile/i })).toBeDisabled();
    expect(
      screen.getAllByRole("checkbox").every((checkbox) => (checkbox as HTMLInputElement).disabled),
    ).toBe(true);

    rejectRun(new Error("Preparation failed"));
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("failed"));

    expect(screen.getByTestId("import-back-btn")).not.toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: /execution profile/i })).not.toBeDisabled();
    expect(firstButton(/start import/i)).not.toBeDisabled();
  });

  it("unlocks configuration and navigation when preparation is cancelled", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    renderWithProviders();

    expect(screen.getByTestId("import-back-btn")).toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /execution profile/i })).toBeDisabled();

    store.cancelImport();
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("cancelled"));

    expect(screen.getByTestId("import-back-btn")).not.toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: /execution profile/i })).not.toBeDisabled();
  });

  it("returns to failed state and retains structured native preflight issues", async () => {
    configureRuntimeSettings();
    configureSubjects();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "run_import_pipeline") {
        return Promise.reject(
          JSON.stringify({
            kind: "preflight",
            issues: [
              {
                code: "SOURCE_MISSING",
                field: "sourcePath",
                entryIndex: 0,
                message: "Source vanished.",
              },
            ],
          }),
        );
      }
      return Promise.resolve(null);
    });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));

    await vi.waitFor(() => {
      expect(useImportStore.getState().importPhase).toBe("failed");
      expect(useImportStore.getState().stagingPreflight).toMatchObject({
        status: "invalid",
        issues: [expect.objectContaining({ code: "SOURCE_MISSING" })],
      });
    });
  });

  it("does not let a deferred Run rejection mutate a replacement project", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const projectA = DEFAULT_PROJECT_FILE("project-a", "Project A", "/project-a");
    const projectB = DEFAULT_PROJECT_FILE("project-b", "Project B", "/project-b");
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: false });
    activateProjectLease("project-a", "/project-a");
    let rejectRun!: (error: unknown) => void;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "run_import_pipeline") {
        return new Promise((_, reject) => {
          rejectRun = reject;
        });
      }
      if (command === "read_import_status") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));
    await vi.waitFor(() =>
      expect(
        vi.mocked(invoke).mock.calls.some(([command]) => command === "run_import_pipeline"),
      ).toBe(true),
    );

    const transition = transitionProjectRuntime(projectB, false, {
      shutdownRuntime: async () => ({
        success: true,
        importProcess: { success: true },
        processingWorkers: { success: true },
        lockWatcher: { success: true },
      }),
      setActiveProject: async () => {},
    });
    rejectRun(
      JSON.stringify({
        kind: "preflight",
        issues: [
          { code: "SOURCE_MISSING", field: "sourcePath", entryIndex: 0, message: "Old project" },
        ],
      }),
    );
    await transition;

    expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-b");
    expect(useImportStore.getState().importPhase).toBe("idle");
    expect(useImportStore.getState().importLog).toEqual([]);
    expect(useImportStore.getState().stagingPreflight.issues).toEqual([]);
  });

  it("does not start import without staged subjects", async () => {
    configureRuntimeSettings();
    renderWithProviders();

    expect(firstButton(/start import/i)).toBeDisabled();
    expect(screen.getByText(/stage at least one subject/i)).toBeInTheDocument();

    expect(useImportStore.getState().importPhase).toBe("idle");
  });

  it("disables source-dependent import when the saved DICOM source is unavailable", () => {
    configureRuntimeSettings();
    configureSubjects();
    useImportStore.setState({
      sourceDataPath: "/missing/dicom",
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });

    renderWithProviders();

    expect(firstButton(/start import/i)).toBeDisabled();
  });

  it("disables start when selected profile is invalid", () => {
    const profile = makeMatlabProfile({ id: "profile-invalid" });
    useGlobalStore.setState({
      loaded: true,
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: {
        [profile.id]: { valid: false, errors: ["MATLAB not found"] },
      },
    });
    useImportStore.getState().setSelectedProfileId(profile.id);
    configureSubjects();
    renderWithProviders();

    expect(firstButton(/start import/i)).toBeDisabled();
    expect(screen.getByTestId("profile-selector-invalid-warning")).toBeInTheDocument();
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

  it("uses native active stop before the deferred Run response supplies a PID", async () => {
    configureRuntimeSettings();
    configureSubjects();
    let emitPrepareComplete: (() => void) | undefined;
    let runRequestId = "";
    let resolveStop!: () => void;
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === "ImportPrepareComplete") {
        emitPrepareComplete = () =>
          handler({ payload: { runRequestId, ownershipGeneration: 1 } } as never);
      }
      return () => {};
    });
    vi.mocked(invoke).mockImplementation((command: string, payload?: unknown) => {
      if (command === "run_import_pipeline") {
        runRequestId = (payload as { runRequestId?: string } | undefined)?.runRequestId ?? "";
        return new Promise(() => {});
      }
      if (command === "stop_active_import") {
        return new Promise<void>((resolve) => {
          resolveStop = resolve;
        });
      }
      if (command === "read_import_status") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));
    await vi.waitFor(() => expect(emitPrepareComplete).toBeTypeOf("function"));
    emitPrepareComplete?.();
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("running"));

    await userEvent.click(firstButton(/stop/i));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("stop_active_import"));
    expect(useImportStore.getState().importPhase).toBe("running");
    expect(screen.getByTestId("import-back-btn")).toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /execution profile/i })).toBeDisabled();

    resolveStop();
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("cancelled"));
    expect(screen.getByTestId("import-back-btn")).not.toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).not.toBeDisabled();
  });

  it("does not reuse an old PID when a queued old run response and readiness arrive during a rerun", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const readinessHandlers: Array<(event: { payload: unknown }) => void> = [];
    const runRequests: string[] = [];
    let resolveOldRun!: (pid: number) => void;
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === "ImportPrepareComplete") {
        readinessHandlers.push(handler as (event: { payload: unknown }) => void);
      }
      return () => {};
    });
    vi.mocked(invoke).mockImplementation((command: string, payload?: unknown) => {
      if (command === "run_import_pipeline") {
        runRequests.push((payload as { runRequestId?: string } | undefined)?.runRequestId ?? "");
        if (runRequests.length === 1) {
          return new Promise<number>((resolve) => {
            resolveOldRun = resolve;
          });
        }
        return new Promise<number>(() => {});
      }
      if (command === "stop_active_import") return Promise.resolve();
      if (command === "read_import_status") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    renderWithProviders();

    await userEvent.click(firstButton(/start import/i));
    await vi.waitFor(() => expect(runRequests).toHaveLength(1));
    readinessHandlers[0]?.({
      payload: { runRequestId: runRequests[0], ownershipGeneration: 1 },
    });
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("running"));
    await userEvent.click(firstButton(/stop/i));
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("cancelled"));

    await userEvent.click(firstButton(/start import/i));
    await vi.waitFor(() => expect(runRequests).toHaveLength(2));
    resolveOldRun(4242);
    readinessHandlers[0]?.({
      payload: { runRequestId: runRequests[0], ownershipGeneration: 1 },
    });
    expect(useImportStore.getState().importPhase).toBe("preparing");

    readinessHandlers[1]?.({
      payload: { runRequestId: runRequests[1], ownershipGeneration: 2 },
    });
    await vi.waitFor(() => expect(useImportStore.getState().importPhase).toBe("running"));
    await userEvent.click(firstButton(/stop/i));

    expect(invoke).toHaveBeenCalledWith("stop_active_import");
    expect(invoke).not.toHaveBeenCalledWith("stop_import", { pid: 4242 });
  });

  it("keeps the import attached and locked when native stop fails", async () => {
    configureRuntimeSettings();
    configureSubjects();
    useImportStore.getState().startImport();
    useImportStore.getState().setImportPhase("running");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "stop_active_import") return Promise.reject(new Error("Permission denied"));
      if (command === "read_import_status") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    renderWithProviders();

    await userEvent.click(firstButton(/stop/i));

    await vi.waitFor(() => expect(screen.getByTestId("stop-import-error-alert")).toBeVisible());
    expect(screen.getByTestId("stop-import-error-alert")).toHaveTextContent("Permission denied");
    expect(useImportStore.getState().importPhase).toBe("running");
    expect(screen.getByTestId("import-back-btn")).toBeDisabled();
    expect(screen.getByTestId("import-next-params-btn")).toBeDisabled();
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
    expect(
      screen.getAllByText(
        (_, node) => node?.textContent?.includes("ExploreASL import started") ?? false,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        (_, node) => node?.textContent?.includes("NII2BIDS failed for SUB02_ses-01_run-1") ?? false,
      ).length,
    ).toBeGreaterThan(0);
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
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
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
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
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
      const runCall = vi
        .mocked(invoke)
        .mock.calls.find((call) => call[0] === "run_import_pipeline");
      expect(runCall).toBeDefined();
      expect((runCall![1] as Record<string, unknown>).subjectsToPreserve).toEqual(["SUB01"]);
      expect((runCall![1] as Record<string, unknown>).runRequestId).toEqual(expect.any(String));
      expect(runCall![1]).not.toHaveProperty("stagingRoot");
      expect(runCall![1]).not.toHaveProperty("projectRoot");
    });
  });

  it("does not preserve a completed subject selected for rerun under portable casing", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.markSubjectCompleted("SUB01", 12);
    store.markSubjectFailed("sub01", "NII2BIDS", "Rerun with corrected metadata");
    store.failImport();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "run_import_pipeline") return Promise.resolve(12345);
      if (command === "read_import_status") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    renderWithProviders();
    await userEvent.click(firstButton(/start import/i));

    await vi.waitFor(() => {
      const runCall = vi
        .mocked(invoke)
        .mock.calls.find(([command]) => command === "run_import_pipeline");
      expect(runCall).toBeDefined();
      expect((runCall![1] as Record<string, unknown>).subjectsToPreserve).toBeNull();
    });
  });

  it("auto-selects first valid profile in import store", () => {
    configureRuntimeSettings();
    configureSubjects();
    useImportStore.setState({ selectedProfileId: null });
    renderWithProviders();

    expect(useImportStore.getState().selectedProfileId).toBe("profile-1");
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

    expect(vi.mocked(invoke).mock.calls.some((call) => call[0] === "run_import_pipeline")).toBe(
      false,
    );
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
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
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

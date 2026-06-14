import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  useImportStore.getState().resetImport();
  useGlobalStore.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
  });
});

describe("ImportExecution", () => {
  it("shows the current phase badge and gates run controls on configured paths", () => {
    renderWithProviders();

    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(firstButton(/run import/i)).toBeDisabled();
    expect(firstButton(/stop/i)).toBeDisabled();

    cleanup();
    configureRuntimeSettings();
    configureSubjects();

    renderWithProviders();

    expect(firstButton(/run import/i)).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /retry import/i })).not.toBeInTheDocument();
  });

  it("starts import by initializing pending progress rows from subject rows", async () => {
    configureRuntimeSettings();
    configureSubjects();
    renderWithProviders();

    await userEvent.click(firstButton(/run import/i));

    expect(useImportStore.getState().importPhase).toBe("preparing");
    expect(screen.getByText("Preparing")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /subject/i })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "SUB01" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "SUB02" })).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(2);
  });

  it("does not start import without staged subjects", async () => {
    configureRuntimeSettings();
    renderWithProviders();

    expect(firstButton(/run import/i)).toBeDisabled();
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

    expect(firstButton(/run import/i)).toBeDisabled();
    expect(firstButton(/stop/i)).not.toBeDisabled();

    await userEvent.click(firstButton(/stop/i));

    expect(useImportStore.getState().importPhase).toBe("cancelled");
    expect(useImportStore.getState().importProgress.SUB01.status).toBe("cancelled");
  });

  it("shows retry on failed imports and resets execution before starting again", async () => {
    configureRuntimeSettings();
    configureSubjects();
    const store = useImportStore.getState();
    store.startImport();
    store.addLogLine("old import line");
    store.markSubjectFailed("SUB02", "NII2BIDS", "Invalid LabelingDuration");
    store.failImport();
    renderWithProviders();

    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(firstButton(/retry import/i)).not.toBeDisabled();

    await userEvent.click(firstButton(/retry import/i));

    expect(useImportStore.getState().importPhase).toBe("preparing");
    expect(useImportStore.getState().importLog).toEqual([]);
    expect(useImportStore.getState().importProgress.SUB02.status).toBe("pending");
  });

  it("renders progress details, warnings, and the live import log", async () => {
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

    const row = screen.getByRole("row", { name: /SUB02/i });
    expect(within(row).getByText("Failed")).toBeInTheDocument();
    expect(within(row).getByText("NII2BIDS")).toBeInTheDocument();
    expect(within(row).getByText("1m 32s")).toBeInTheDocument();
    expect(screen.getAllByText((_, node) => node?.textContent?.includes("ExploreASL import started") ?? false).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, node) => node?.textContent?.includes("NII2BIDS failed for SUB02_ses-01_run-1") ?? false).length).toBeGreaterThan(0);

    await userEvent.click(firstButton(/show details for SUB02/i));

    expect(screen.getByText("Full error detail")).toBeInTheDocument();
    expect(firstButton(/hide details for SUB02/i)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("Short error").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("M0 image was not found")).toBeInTheDocument();
  });

  it("summarizes completed imports and advances the project to parameters", async () => {
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

    expect(screen.getByText(/Succeeded: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Failed: 0/)).toBeInTheDocument();

    await userEvent.click(firstButton(/next: parameters/i));

    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("parameters");
  });

  it("copies lock files for succeeded subjects before retrying import", async () => {
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
    renderWithProviders();

    await userEvent.click(firstButton(/retry import/i));

    await vi.waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("copy_lock_files", {
        projectRoot: "/tmp/brain-study",
        stagingRoot: "/tmp/brain-study/.easl_staging",
        subjects: ["SUB01"],
      });
    });
  });
});

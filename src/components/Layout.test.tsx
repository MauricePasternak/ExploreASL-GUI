import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes } from "react-router";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { ProjectStorageError } from "../lib/projectPersistence";
import { useProcessingStore } from "../stores/processingStore";
import { useImportStore } from "../stores/importStore";
import { useVisualizationStore } from "../stores/visualizationStore";
import ProjectPage from "../pages/ProjectPage";
import Layout from "./Layout";

const realCloseProject = useProjectStore.getState().closeProject;

function renderLayout(initialPath = "/") {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<Layout onOpenSettings={() => undefined} />}>
            <Route path="/" element={<div>Landing content</div>} />
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

function getLastButton(name: RegExp) {
  const buttons = screen.getAllByRole("button", { name });
  return buttons[buttons.length - 1];
}

describe("Layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useGlobalStore.setState({
      loaded: true,
      settings: DEFAULT_SETTINGS,
    });
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
      closeProject: realCloseProject,
    });
    useProcessingStore.setState({
      processingPhase: "idle",
      workerPids: [],
    });
    useImportStore.setState({
      importPhase: "idle",
      importRunning: false,
      sourceAvailability: { status: "unconfigured", savedPath: null, message: null },
    });
    useVisualizationStore.setState({
      externalSourceAvailability: { status: "unconfigured", savedPath: null, message: null },
    });
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the global shell without a project navbar", () => {
    renderLayout();

    expect(screen.getByAltText("ExploreASL GUI")).toBeInTheDocument();
    expect(screen.getByText("Landing content")).toBeInTheDocument();
    expect(screen.getByTestId("page-fade-container")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /import/i })).not.toBeInTheDocument();
  });

  it("shows project name and phase navigation when a project is loaded", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/import");

    expect(screen.getAllByText("Brain Study").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /import/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /parameters/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /processing/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /visualization/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /manifest/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /return to home/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/subjects: 0/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("processing-status-bar")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /parameters/i })[0]).not.toHaveAttribute(
      "data-disabled",
      "true",
    );
    expect(screen.getAllByRole("button", { name: /processing/i })[0]).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("summarizes unavailable sources without blocking unaffected phase navigation", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "parameters",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: { sourceDataPath: "/missing/dicom" },
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });
    useImportStore.setState({
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });

    renderLayout("/project/project-1/parameters");

    expect(screen.getByTestId("layout-missing-source-summary")).toBeInTheDocument();
    expect(screen.getByTestId("layout-nav-parameters")).not.toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("returns to the landing page immediately when leaving a clean project", async () => {
    const projectJson = {
      version: "0.1.0" as const,
      projectMeta: {
        id: "project-1",
        name: "Brain Study",
        rootPath: "/tmp/brain-study",
        createdAt: "2026-05-03T00:00:00.000Z",
        lastOpened: "2026-05-03T00:00:00.000Z",
        currentPhase: "import" as const,
        dataSource: "dicom" as const,
      },
      uiState: { navbarCollapsed: false },
      mappingState: {},
      dataPar: {},
    };

    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        recentProjects: [{ path: "/tmp/brain-study/project.easl", projectId: "project-1" }],
      },
    });
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(projectJson));

    useProjectStore.setState({
      project: projectJson,
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/import");

    expect(screen.getAllByTestId("layout-nav-import").length).toBeGreaterThan(0);

    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(useProjectStore.getState().project).toBeNull();
      expect(screen.getAllByText("Landing content").length).toBeGreaterThan(0);
      expect(screen.queryAllByTestId("layout-nav-import")).toHaveLength(0);
      expect(screen.queryAllByTestId("layout-nav-home")).toHaveLength(0);
      expect(document.querySelectorAll(".mantine-AppShell-navbar")).toHaveLength(0);
      expect(screen.queryByTestId("layout-footer")).not.toBeInTheDocument();
    });
  });

  it("asks whether to save before leaving a dirty project", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const closeProject = vi.fn(async () => {
      useProjectStore.setState({
        project: null,
        isDirty: false,
        loaded: false,
      });
    });

    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
      closeProject,
    });

    renderLayout("/project/project-1/import");

    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /save and leave/i }).length).toBeGreaterThan(0);
    });

    fireEvent.click(getLastButton(/save and leave/i));

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalled();
      expect(closeProject).toHaveBeenCalled();
      expect(screen.getAllByText("Landing content").length).toBeGreaterThan(0);
    });
  });

  it("can leave a dirty project without saving", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const closeProject = vi.fn(async () => {
      useProjectStore.setState({
        project: null,
        isDirty: false,
        loaded: false,
      });
    });

    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
      closeProject,
    });

    renderLayout("/project/project-1/import");

    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /leave without saving/i }).length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(getLastButton(/leave without saving/i));

    await waitFor(() => {
      expect(saveProject).not.toHaveBeenCalled();
      expect(closeProject).toHaveBeenCalled();
      expect(screen.getAllByText("Landing content").length).toBeGreaterThan(0);
    });
  });

  it("shows an error and stays in the project when save-and-leave fails", async () => {
    const saveProject = vi
      .fn()
      .mockRejectedValue(new ProjectStorageError("insufficient_space", "temporary write failed"));
    const closeProject = vi.fn().mockResolvedValue(undefined);

    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
      closeProject,
    });

    renderLayout("/project/project-1/import");

    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /save and leave/i }).length).toBeGreaterThan(0);
    });

    fireEvent.click(getLastButton(/save and leave/i));

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalled();
      expect(closeProject).not.toHaveBeenCalled();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/failed to save project/i),
          message: expect.stringMatching(/free space/i),
        }),
      );
      expect(screen.getAllByTestId("layout-nav-import").length).toBeGreaterThan(0);
    });
  });

  it("defaults to collapsed navbar for new projects", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
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

    renderLayout("/project/project-1/import");

    expect(screen.getAllByTestId("layout-navbar-toggle").length).toBeGreaterThan(0);
    expect(screen.queryByText("Import")).toBeNull();
    expect(screen.queryByText("Return to home")).toBeNull();
  });

  it("expands navbar when toggle is clicked", async () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: true },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/import");

    expect(screen.queryByText("Import")).toBeNull();

    fireEvent.click(screen.getAllByTestId("layout-navbar-toggle")[0]);

    await waitFor(() => {
      expect(screen.getAllByText("Import").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Parameters").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Processing").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Visualization").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Manifest").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Return to home").length).toBeGreaterThan(0);
    });
  });

  it("collapses navbar when toggle is clicked while expanded", async () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/import");

    expect(screen.getAllByText("Import").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByTestId("layout-navbar-toggle")[0]);

    await waitFor(() => {
      expect(screen.queryByText("Import")).toBeNull();
      expect(screen.queryByText("Return to home")).toBeNull();
    });
  });

  it("persists navbar collapsed state to uiState", async () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: true },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/import");

    fireEvent.click(screen.getAllByTestId("layout-navbar-toggle")[0]);

    await waitFor(() => {
      expect(useProjectStore.getState().project?.uiState.navbarCollapsed).toBe(false);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  it("renders Manifest nav button when population is completed", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false, processing: { population: { completed: true } } },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/import");

    const manifestBtn = screen.getByTestId("layout-nav-manifest");
    expect(manifestBtn).toBeInTheDocument();
    expect(manifestBtn).not.toHaveAttribute("data-disabled", "true");
  });

  it("renders ManifestPage on manifest route", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "manifest",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false, processing: { population: { completed: true } } },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderLayout("/project/project-1/manifest");

    expect(screen.getByTestId("manifest-page")).toBeInTheDocument();
  });

  it("disables visualization and manifest NavLinks when processing is active (running or preparing)", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "processing",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false, processing: { population: { completed: true } } },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    // Check with phase = running
    useProcessingStore.setState({
      processingPhase: "running",
    });
    const { unmount } = renderLayout("/project/project-1/processing");

    expect(screen.getByTestId("layout-nav-visualization")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("layout-nav-manifest")).toHaveAttribute("data-disabled", "true");

    unmount();

    // Check with phase = preparing
    useProcessingStore.setState({
      processingPhase: "preparing",
    });
    const { unmount: unmountPrep } = renderLayout("/project/project-1/processing");

    expect(screen.getByTestId("layout-nav-visualization")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("layout-nav-manifest")).toHaveAttribute("data-disabled", "true");

    unmountPrep();

    // Check with phase = idle (should be enabled since population is completed)
    useProcessingStore.setState({
      processingPhase: "idle",
    });
    renderLayout("/project/project-1/processing");

    expect(screen.getByTestId("layout-nav-visualization")).not.toHaveAttribute(
      "data-disabled",
      "true",
    );
    expect(screen.getByTestId("layout-nav-manifest")).not.toHaveAttribute("data-disabled", "true");
  });

  it("waits for shutdown before closing a clean project", async () => {
    let releaseShutdown!: () => void;
    const closeProject = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseShutdown = resolve;
        }),
    );
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      closeProject,
    });

    renderLayout("/project/project-1/import");

    await waitFor(() => {
      expect((window as any).__mockCloseRequestedListener).toBeDefined();
    });

    const preventDefault = vi.fn();
    const closeRequest = (window as any).__mockCloseRequestedListener({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(screen.queryByText(/Save your changes/i)).not.toBeInTheDocument();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    expect(closeProject).toHaveBeenCalled();
    expect(getCurrentWindow().destroy).not.toHaveBeenCalled();

    releaseShutdown();
    await closeRequest;
    expect(getCurrentWindow().destroy).toHaveBeenCalled();
  });

  it("keeps the project visible when Return to Home shutdown fails", async () => {
    const closeProject = vi.fn().mockRejectedValue(new Error("cannot stop watcher"));
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      closeProject,
    });

    renderLayout("/project/project-1/import");
    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not leave project",
          message: "cannot stop watcher",
        }),
      );
    });
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-1");
    expect(screen.queryByText("Landing content")).not.toBeInTheDocument();
  });

  it("blocks ordinary app close when runtime shutdown fails", async () => {
    const closeProject = vi.fn().mockRejectedValue(new Error("cannot stop worker"));
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      closeProject,
    });
    renderLayout("/project/project-1/import");
    await waitFor(() => expect((window as any).__mockCloseRequestedListener).toBeDefined());

    const preventDefault = vi.fn();
    await (window as any).__mockCloseRequestedListener({ preventDefault });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");

    expect(preventDefault).toHaveBeenCalled();
    expect(getCurrentWindow().destroy).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-1");
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Could not close project",
        message: "cannot stop worker",
      }),
    );
  });

  it("intercepts close request and prompts when project is dirty, can save and exit", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
    });

    renderLayout("/project/project-1/import");

    await waitFor(() => {
      expect((window as any).__mockCloseRequestedListener).toBeDefined();
    });

    const preventDefault = vi.fn();
    await (window as any).__mockCloseRequestedListener({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("Exit application")).toBeInTheDocument();
      expect(
        screen.getByText("Save your changes before exiting the application?"),
      ).toBeInTheDocument();
    });

    const saveAndExitBtn = screen.getByRole("button", { name: /save and exit/i });
    fireEvent.click(saveAndExitBtn);

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalled();
      expect(appWindow.destroy).toHaveBeenCalled();
    });
  });

  it("intercepts close request and prompts when project is dirty, can exit without saving", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
    });

    renderLayout("/project/project-1/import");

    await waitFor(() => {
      expect((window as any).__mockCloseRequestedListener).toBeDefined();
    });

    const preventDefault = vi.fn();
    await (window as any).__mockCloseRequestedListener({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("Exit application")).toBeInTheDocument();
    });

    const exitWithoutSavingBtn = screen.getByRole("button", { name: /exit without saving/i });
    fireEvent.click(exitWithoutSavingBtn);

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    await waitFor(() => {
      expect(saveProject).not.toHaveBeenCalled();
      expect(appWindow.destroy).toHaveBeenCalled();
    });
  });

  it("prompts for abort when close request is sent and processing is running", async () => {
    const closeProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "processing",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      closeProject,
    });
    renderLayout("/project/project-1/processing");

    await waitFor(() => {
      expect((window as any).__mockCloseRequestedListener).toBeDefined();
    });
    useProcessingStore.setState({
      processingPhase: "running",
      activeRunId: "processing-run-1",
    });

    const preventDefault = vi.fn();
    await (window as any).__mockCloseRequestedListener({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getAllByText("Abort and exit").length).toBeGreaterThan(0);
      expect(
        screen.getByText(
          /An active ExploreASL process\/import is running\. Exiting the application will abort the execution\./,
        ),
      ).toBeInTheDocument();
    });

    const abortBtn = screen.getByRole("button", { name: /abort and exit/i });
    fireEvent.click(abortBtn);

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    await waitFor(() => {
      expect(closeProject).toHaveBeenCalled();
      expect(appWindow.destroy).toHaveBeenCalled();
    });
  });

  it("prompts for abort when close request is sent and import is running", async () => {
    const closeProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      closeProject,
    });
    useImportStore.setState({
      importPhase: "running",
    });

    renderLayout("/project/project-1/import");

    await waitFor(() => {
      expect((window as any).__mockCloseRequestedListener).toBeDefined();
    });

    const preventDefault = vi.fn();
    await (window as any).__mockCloseRequestedListener({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getAllByText("Abort and exit").length).toBeGreaterThan(0);
    });

    const abortBtn = screen.getByRole("button", { name: /abort and exit/i });
    fireEvent.click(abortBtn);

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    await waitFor(() => {
      expect(closeProject).toHaveBeenCalled();
      expect(appWindow.destroy).toHaveBeenCalled();
    });
  });

  it("shows clean/fresh status icon and disables manual save when project is not dirty", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      saveProject,
    });

    renderLayout("/project/project-1/import");

    const saveBtn = screen.getByTestId("layout-save-status-btn");
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toHaveAttribute("aria-label", "Project changes in sync");
    expect(saveBtn).toBeDisabled();

    fireEvent.click(saveBtn);
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("shows dirty/staleness status icon and triggers save immediately on click", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
    });

    renderLayout("/project/project-1/import");

    const saveBtn = screen.getByTestId("layout-save-status-btn");
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toHaveAttribute("aria-label", "Save project changes");
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalledTimes(1);
    });
  });

  it("saves the project when Ctrl+S keyboard shortcut is pressed", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0" as const,
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: { navbarCollapsed: false },
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
    });

    renderLayout("/project/project-1/import");

    // Trigger Ctrl+S keydown event
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalledTimes(1);
    });
  });
});

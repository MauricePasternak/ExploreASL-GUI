import { TestMantineProvider as MantineProvider } from "../test/render";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeSessionCheckpoint } from "../lib/sessionCheckpoint";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useDataParStore } from "../stores/dataParStore";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";
import { resetProjectStores } from "../stores/projectStoreHydration";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { seedValidProfileGate } from "../test/landingProfileGate";
import ProjectPage from "./ProjectPage";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn(() => Promise.resolve(false)),
  mkdir: vi.fn(),
}));

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
});

const snapshot = projectFixture("project-1", "Brain Study", "/tmp/brain-study");
const parameters = {
  ...snapshot,
  acceptedRevision: 1,
  document: {
    ...snapshot.document,
    projectMeta: { ...snapshot.document.projectMeta, currentPhase: "parameters" as const },
  },
};

describe("ProjectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    seedValidProfileGate();
    resetProjectLifecycleForTests();
    activateProjectLease("project-1", "/tmp/brain-study");
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return parameters;
      if (command === "save_project" || command === "get_project_snapshot")
        return { ...parameters, persistedRevision: 1 };
      if (
        command === "current_project_snapshot" ||
        command === "get_active_import_run" ||
        command === "get_active_run" ||
        command === "clear_active_project"
      )
        return null;
      if (
        command === "read_import_status" ||
        command === "list_module_logs" ||
        command === "list_subject_reports" ||
        command === "list_subjects" ||
        command === "read_lock_status"
      )
        return [];
      if (command === "inspect_project")
        return {
          candidateId: "candidate",
          projectId: "project-1",
          name: "Brain Study",
          rootPath: snapshot.rootPath,
          recoveredFromBackup: false,
          duplicatePath: null,
          movedFrom: null,
          setupRecovered: 0,
        };
      if (command === "activate_project") return snapshot;
      if (command === "shutdown_project_runtime")
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      throw new Error(`Unexpected command ${command}`);
    });
    useImportStore.getState().resetImport();
    useDataParStore.getState().resetDataPar();
    useProjectStore.setState({
      project: {
        ...projectView(snapshot),
        allowedPhases: ["import", "parameters", "processing"],
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "processing",
          dataSource: "dicom",
        },
        uiState: snapshot.document.uiState,
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });
    useProcessingStore.setState({
      processingPhase: "idle",
    });
  });

  it("syncs the current phase from the route and persists it", async () => {
    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/parameters"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("parameters");
      expect(invoke).toHaveBeenCalledWith("save_project", { generation: 1 });
    });

    expect(screen.getByText("ExploreASL Processing Parameters")).toBeInTheDocument();
  });

  it("renders the visualization page when navigation is allowed", async () => {
    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            allowedPhases: ["import", "parameters", "processing", "visualization", "manifest"],
            projectMeta: { ...state.project.projectMeta, currentPhase: "visualization" },
            uiState: {
              ...state.project.uiState,
              processing: {
                ...state.project.uiState?.processing,
                population: { completed: true },
              },
            },
          }
        : null,
    }));

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/visualization"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("visualization-page")).toBeInTheDocument();
    });
  });

  it("redirects from visualization and manifest pages to fallback phase when processing is active", async () => {
    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            allowedPhases: ["import", "parameters", "processing", "visualization", "manifest"],
            projectMeta: { ...state.project.projectMeta, currentPhase: "processing" },
            uiState: {
              ...state.project.uiState,
              processing: {
                ...state.project.uiState?.processing,
                population: { completed: true },
              },
            },
          }
        : null,
    }));

    useProcessingStore.setState({
      processingPhase: "running",
    });

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/visualization"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("processing");
    });
  });

  it("redirects from manifest to processing when currentPhase is manifest and processing starts", async () => {
    const processing = {
      ...snapshot,
      acceptedRevision: 1,
      allowedPhases: ["import", "parameters", "processing", "visualization", "manifest"] as const,
      document: {
        ...snapshot.document,
        projectMeta: { ...snapshot.document.projectMeta, currentPhase: "processing" as const },
      },
    };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit" || command === "save_project") return processing;
      if (command === "get_active_run") return null;
      if (
        command === "list_subjects" ||
        command === "read_lock_status" ||
        command === "list_module_logs" ||
        command === "list_subject_reports"
      )
        return [];
      throw new Error(`Unexpected command ${command}`);
    });
    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            allowedPhases: ["import", "parameters", "processing", "visualization", "manifest"],
            projectMeta: { ...state.project.projectMeta, currentPhase: "manifest" },
            uiState: {
              ...state.project.uiState,
              processing: {
                ...state.project.uiState?.processing,
                population: { completed: true },
              },
            },
          }
        : null,
    }));

    useProcessingStore.setState({
      processingPhase: "preparing",
    });

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/manifest"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("processing");
    });
  });

  it("restores the project from the session checkpoint after reload", async () => {
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
    writeSessionCheckpoint({
      easlPath: "/tmp/brain-study/project.easl",
      projectId: "project-1",
      phase: "import",
    });

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/import"]}>
          <Routes>
            <Route path="/" element={<div>Landing</div>} />
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-1");
      expect(screen.getByTestId("import-stepper-sidebar")).toBeInTheDocument();
    });
  });

  it("uses import execution state pre-hydrated by project activation", async () => {
    const current = useProjectStore.getState().project!;
    resetProjectStores();
    useProjectStore.getState().acceptSnapshot({
      ...snapshot,
      document: {
        ...snapshot.document,
        projectMeta: { ...snapshot.document.projectMeta, currentPhase: "import" },
        uiState: {
          ...current.uiState,
          import: {
            completed: true,
            mostRecentConfig: null,
            currentPhase: "completed",
            bidsReviewConfirmed: false,
            skippedSubjects: [],
          },
        },
        mappingState: {},
      },
    });
    useImportStore.setState({ importPhase: "completed", importCompleted: true });

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/import"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useImportStore.getState()).toMatchObject({
        importCompleted: true,
        importPhase: "completed",
      });
    });
  });

  it("does not restore the project after it is closed while the route is still mounted", async () => {
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        recentProjects: [{ path: "/tmp/brain-study/project.easl", projectId: "project-1" }],
      },
    });

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/import"]}>
          <Routes>
            <Route path="/" element={<div>Landing</div>} />
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-1");
    });

    vi.mocked(readTextFile).mockClear();
    void useProjectStore.getState().closeProject();

    await waitFor(() => {
      expect(useProjectStore.getState().project).toBeNull();
      expect(screen.getAllByText("Landing").length).toBeGreaterThan(0);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useProjectStore.getState().project).toBeNull();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("redirects to the landing page when restore fails", async () => {
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
    vi.mocked(readTextFile).mockRejectedValue(new Error("missing file"));

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/missing-project/import"]}>
          <Routes>
            <Route path="/" element={<div>Landing</div>} />
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Landing").length).toBeGreaterThan(0);
    });
    expect(useProjectStore.getState().project).toBeNull();
  });
});

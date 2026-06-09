import { render, screen, waitFor } from "@testing-library/react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeSessionCheckpoint } from "../lib/sessionCheckpoint";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import ProjectPage from "./ProjectPage";
import { useProjectStore } from "../stores/projectStore";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn(),
  mkdir: vi.fn(),
}));

const PROJECT_JSON = {
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
};

describe("ProjectPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useGlobalStore.setState({ loaded: true, settings: DEFAULT_SETTINGS });
    useImportStore.getState().resetImport();
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "processing",
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
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
  });

  it("syncs the current phase from the route and persists it", async () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/project/project-1/parameters"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("parameters");
      expect(writeTextFile).toHaveBeenCalled();
    });

    expect(screen.getByText("ExploreASL Processing Parameters")).toBeInTheDocument();
  });

  it("restores the project from the session checkpoint after reload", async () => {
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
    writeSessionCheckpoint({
      easlPath: "/tmp/brain-study/project.easl",
      projectId: "project-1",
      phase: "import",
    });
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(PROJECT_JSON));

    render(
      <MantineProvider>
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
  });

  it("hydrates import execution ui state into the import store when mapping state is empty", async () => {
    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            uiState: {
              importCompleted: true,
              importPhase: "completed",
            },
            mappingState: {},
          }
        : null,
    }));

    render(
      <MantineProvider>
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
        recentProjects: ["/tmp/brain-study/project.easl"],
      },
    });
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(PROJECT_JSON));

    render(
      <MantineProvider>
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
    useProjectStore.getState().closeProject();

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
      <MantineProvider>
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

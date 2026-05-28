import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes } from "react-router";

import { useProjectStore } from "../stores/projectStore";
import Layout from "./Layout";

function renderLayout(initialPath = "/") {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<Layout onOpenSettings={() => undefined} />}>
            <Route path="/" element={<div>Landing content</div>} />
            <Route path="/project/:id/:phase" element={<div>Project content</div>} />
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
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
  });

  it("renders the global shell without a project navbar", () => {
    renderLayout();

    expect(screen.getByText("ExploreASL GUI")).toBeInTheDocument();
    expect(screen.getByText("Landing content")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /import/i })).not.toBeInTheDocument();
  });

  it("shows project name and phase navigation when a project is loaded", () => {
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

    renderLayout("/project/project-1/import");

      expect(screen.getAllByText("Brain Study").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /import/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /parameters/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /processing/i }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: /return to home/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/status: idle/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/subjects: 0/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /parameters/i })[0]).toHaveAttribute("data-disabled", "true");
    expect(screen.getAllByRole("button", { name: /processing/i })[0]).toHaveAttribute("data-disabled", "true");
  });

  it("returns to the landing page immediately when leaving a clean project", async () => {
    const closeProject = vi.fn(() => {
      useProjectStore.setState({
        project: null,
        isDirty: false,
        loaded: false,
      });
    });

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
      closeProject,
    });

    renderLayout("/project/project-1/import");

    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(closeProject).toHaveBeenCalled();
      expect(screen.getAllByText("Landing content").length).toBeGreaterThan(0);
    });
  });

  it("asks whether to save before leaving a dirty project", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const closeProject = vi.fn(() => {
      useProjectStore.setState({
        project: null,
        isDirty: false,
        loaded: false,
      });
    });

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
    const closeProject = vi.fn(() => {
      useProjectStore.setState({
        project: null,
        isDirty: false,
        loaded: false,
      });
    });

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
      isDirty: true,
      loaded: true,
      saveProject,
      closeProject,
    });

    renderLayout("/project/project-1/import");

    fireEvent.click(getLastButton(/return to home/i));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /leave without saving/i }).length).toBeGreaterThan(0);
    });

    fireEvent.click(getLastButton(/leave without saving/i));

    await waitFor(() => {
      expect(saveProject).not.toHaveBeenCalled();
      expect(closeProject).toHaveBeenCalled();
      expect(screen.getAllByText("Landing content").length).toBeGreaterThan(0);
    });
  });

  it("shows an error and stays in the project when save-and-leave fails", async () => {
    const saveProject = vi.fn().mockRejectedValue(new Error("disk full"));
    const closeProject = vi.fn();

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
        }),
      );
      expect(screen.getAllByText("Project content").length).toBeGreaterThan(0);
    });
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProjectPage from "./ProjectPage";
import { useProjectStore } from "../stores/projectStore";

describe("ProjectPage", () => {
  beforeEach(() => {
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

    expect(screen.getByText(/Parameters configuration/)).toBeInTheDocument();
  });
});

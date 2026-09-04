import { cleanup, render, waitFor } from "@testing-library/react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectPage from "./ProjectPage";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";

describe("Import autosave loop", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetProjectLifecycleForTests();
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
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {
          sourceDataPath: "/tmp/brain-study/sourcedata",
          ingestionComplete: true,
        },
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    activateProjectLease("project-1", "/tmp/brain-study");
  });

  afterEach(() => {
    cleanup();
    resetProjectLifecycleForTests();
  });

  it("does not re-hydrate import state on every mapping autosave", async () => {
    const loadSpy = vi.spyOn(useImportStore.getState(), "loadPersistedState");

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/project/project-1/import"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(loadSpy).not.toHaveBeenCalled();

    useImportStore.getState().setSourceDataPath("/tmp/brain-study/sourcedata/updated");

    await waitFor(() => {
      expect(useProjectStore.getState().project?.mappingState.sourceDataPath).toBe(
        "/tmp/brain-study/sourcedata/updated",
      );
    });

    expect(loadSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
  });
});

import { cleanup, render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../test/projectFixtures";
import { TestMantineProvider as MantineProvider } from "../test/render";
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
    const snapshot = projectFixture("project-1", "Brain Study", "/tmp/brain-study");
    snapshot.document.mappingState = { sourceDataPath: "./sourcedata", ingestionComplete: true };
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.getState().acceptSnapshot(snapshot);
    activateProjectLease("project-1", "/tmp/brain-study");
  });

  afterEach(() => {
    cleanup();
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
  });

  it("does not re-hydrate import state on every mapping autosave", async () => {
    useImportStore.setState({
      importLog: ["scan log"],
      importProgress: { BAR: { subject: "BAR", session: "01", status: "pending" } },
    });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "./sourcedata/updated",
      ingestionComplete: true,
    };
    vi.mocked(invoke).mockResolvedValueOnce(accepted);

    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/project/project-1/import"]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await useImportStore.getState().setSourceDataPath("/tmp/brain-study/sourcedata/updated");

    await waitFor(() => {
      expect(useProjectStore.getState().project?.mappingState.sourceDataPath).toBe(
        "./sourcedata/updated",
      );
    });

    expect(useImportStore.getState()).toMatchObject({
      importLog: ["scan log"],
      importProgress: { BAR: { subject: "BAR", session: "01", status: "pending" } },
    });
  });
});

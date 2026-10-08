import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../../test/projectFixtures";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import { useProjectStore } from "../../stores/projectStore";

import SubjectRenameTable from "./SubjectRenameTable";
import { useImportStore } from "../../stores/importStore";

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
});

describe("SubjectRenameTable", () => {
  it("shows invalid and collision feedback for both rows without changing values", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState.subjectRenames = [
      { original: "one", target: "FOO" },
      { original: "two", target: "foo" },
    ];
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.getState().acceptSnapshot(snapshot);
    render(
      <MantineProvider env="test">
        <SubjectRenameTable />
      </MantineProvider>,
    );
    expect(screen.getByTestId("subject-rename-error-one")).toBeInTheDocument();
    expect(screen.getByTestId("subject-rename-error-two")).toBeInTheDocument();
    expect(screen.getByTestId("subject-rename-input-one")).toHaveValue("FOO");
  });

  it("applies a suggestion only after explicit acceptance", async () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState.subjectRenames = [{ original: "one", target: "FOO+BAR" }];
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.getState().acceptSnapshot(snapshot);
    activateProjectLease("project-1", "/project");
    const accepted = { ...projectFixture(), acceptedRevision: 1 };
    accepted.document.mappingState.subjectRenames = [{ original: "one", target: "FOOBAR" }];
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    render(
      <MantineProvider env="test">
        <SubjectRenameTable />
      </MantineProvider>,
    );
    expect(useProjectStore.getState().project?.mappingState.subjectRenames?.[0].target).toBe(
      "FOO+BAR",
    );
    await userEvent.click(screen.getByTestId("subject-rename-suggestion-one"));
    await useProjectStore.getState().flushEdits();
    expect(useProjectStore.getState().project?.mappingState.subjectRenames?.[0].target).toBe(
      "FOOBAR",
    );
    expect(invoke).toHaveBeenCalledWith(
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ kind: "import", mapping: accepted.document.mappingState }),
      }),
    );
  });
});

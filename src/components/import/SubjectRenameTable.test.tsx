import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import SubjectRenameTable from "./SubjectRenameTable";
import { useImportStore } from "../../stores/importStore";

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
});

describe("SubjectRenameTable", () => {
  it("shows invalid and collision feedback for both rows without changing values", () => {
    useImportStore.getState().setSubjectRenames([
      { original: "one", target: "FOO" },
      { original: "two", target: "foo" },
    ]);
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
    useImportStore.getState().setSubjectRenames([{ original: "one", target: "FOO+BAR" }]);
    render(
      <MantineProvider env="test">
        <SubjectRenameTable />
      </MantineProvider>,
    );
    expect(useImportStore.getState().subjectRenames[0].target).toBe("FOO+BAR");
    await userEvent.click(screen.getByTestId("subject-rename-suggestion-one"));
    expect(useImportStore.getState().subjectRenames[0].target).toBe("FOOBAR");
  });
});

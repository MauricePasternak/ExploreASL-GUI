import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ImportPreview from "./ImportPreview";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
});

describe("ImportPreview staging validation", () => {
  it("shows aggregate local validation and locks Run navigation", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState = {
      ingestionComplete: true,
      rawPaths: ["FOO+BAR/ASL"],
      sourceDataPath: "/source",
      pathPatterns: [
        {
          signature: "VARYING/VARYING",
          samplePath: "FOO+BAR/ASL",
          blocks: ["FOO+BAR", "ASL"],
          uniqueNames: { 0: ["FOO+BAR"], 1: ["ASL"] },
          count: 1,
          depth: 2,
        },
      ],
      tokenizerConfigs: {
        "VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
        ],
      },
      subjectRenames: [{ original: "FOO+BAR", target: "FOO+BAR" }],
      modalityAliases: [{ captured: "ASL", mapped: "ASL4D" }],
    };
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.getState().acceptSnapshot(snapshot);
    render(
      <MantineProvider env="test">
        <ImportPreview />
      </MantineProvider>,
    );
    expect(screen.getByTestId("staging-validation-summary")).toBeInTheDocument();
    expect(screen.getByTestId("staging-local-issues")).toBeInTheDocument();
    expect(screen.getByTestId("preview-next-btn")).toBeDisabled();
  });
});

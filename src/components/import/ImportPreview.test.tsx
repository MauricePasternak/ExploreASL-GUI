import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ImportPreview from "./ImportPreview";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
});

describe("ImportPreview staging validation", () => {
  it("shows aggregate local validation and locks Run navigation", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "p",
          name: "P",
          rootPath: "/project",
          createdAt: "",
          lastOpened: "",
          currentPhase: "import",
          dataSource: "dicom",
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      loaded: true,
    });
    useImportStore.setState({
      ingestionComplete: true,
      rawPaths: ["/source/FOO+BAR/ASL"],
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
    });
    render(
      <MantineProvider>
        <ImportPreview />
      </MantineProvider>,
    );
    expect(screen.getByTestId("staging-validation-summary")).toBeInTheDocument();
    expect(screen.getByTestId("staging-local-issues")).toBeInTheDocument();
    expect(screen.getByTestId("preview-next-btn")).toBeDisabled();
  });
});

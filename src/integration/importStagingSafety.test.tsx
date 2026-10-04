import { TestMantineProvider as MantineProvider } from "../test/render";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ImportPreview from "../components/import/ImportPreview";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { makeMatlabProfile } from "../test/profileFixtures";

afterEach(() => {
  cleanup();
  resetProjectLifecycleForTests();
  useImportStore.getState().resetImport();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
  useGlobalStore.setState({ settings: DEFAULT_SETTINGS, profileValidationState: {}, loaded: true });
});

describe("legacy import staging safety", () => {
  it("keeps unsafe legacy values visible, then requires explicit repair and fresh native preflight", async () => {
    const profile = makeMatlabProfile({ id: "profile" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { profile: { valid: true, errors: [] } },
      loaded: true,
    });
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
    activateProjectLease("p", "/project");
    useImportStore.getState().loadPersistedState({
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
      metadataGroups: [
        {
          id: "global",
          label: "Global",
          bidsParams: {
            ArterialSpinLabelingType: "PCASL",
            PostLabelingDelay: 1.8,
            MRAcquisitionType: "3D",
            MagneticFieldStrength: 3,
            Manufacturer: "Siemens",
            ASLContext: "control,label",
            M0Type: "Separate",
            LabelingDuration: 1.8,
            BackgroundSuppression: false,
          },
        },
      ],
      subjectRows: [{ id: "FOO+BAR/01", subject: "FOO+BAR", session: "01", groupId: "global" }],
    });
    render(
      <MantineProvider env="test">
        <ImportPreview />
      </MantineProvider>,
    );
    expect(screen.getByTestId("preview-next-btn")).toBeDisabled();
    expect(useImportStore.getState().subjectRenames[0].target).toBe("FOO+BAR");

    useImportStore.getState().updateSubjectRename("FOO+BAR", "FOOBAR");
    await waitFor(() => expect(screen.getByTestId("preview-next-btn")).not.toBeDisabled());
  });
});

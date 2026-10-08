import { TestMantineProvider as MantineProvider } from "../test/render";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../test/projectFixtures";

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
  useProjectStore.getState().cancelAutosave();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
  useGlobalStore.setState({ settings: DEFAULT_SETTINGS, profileValidationState: {}, loaded: true });
});

describe("current import staging safety", () => {
  it("keeps unsafe values visible, then requires explicit repair and fresh native preflight", async () => {
    const profile = makeMatlabProfile({ id: "profile" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { profile: { valid: true, errors: [] } },
      loaded: true,
    });
    const snapshot = projectFixture("p", "P");
    activateProjectLease("p", "/project");
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
    };
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.getState().acceptSnapshot(snapshot);
    render(
      <MantineProvider env="test">
        <ImportPreview />
      </MantineProvider>,
    );
    expect(screen.getByTestId("preview-next-btn")).toBeDisabled();
    expect(useProjectStore.getState().project?.mappingState.subjectRenames?.[0].target).toBe(
      "FOO+BAR",
    );

    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState.subjectRenames = [{ original: "FOO+BAR", target: "FOOBAR" }];
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useImportStore.getState().updateSubjectRename("FOO+BAR", "FOOBAR");
    await waitFor(() => expect(screen.getByTestId("preview-next-btn")).not.toBeDisabled());
  });
});

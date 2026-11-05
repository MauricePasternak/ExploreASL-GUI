import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../../test/projectFixtures";
import { useProjectStore } from "../../stores/projectStore";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";

import AliasResolution from "./AliasResolution";
import { useImportStore } from "../../stores/importStore";

function renderWithProviders() {
  return render(
    <MantineProvider env="test">
      <AliasResolution />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useImportStore.getState().resetImport();
  useProjectStore.getState().cancelAutosave();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  resetProjectLifecycleForTests();
});

describe("AliasResolution", () => {
  it("derives alias tables from tokenizer output when store aliases are empty", async () => {
    const user = userEvent.setup();
    const snapshot = projectFixture();
    snapshot.document.mappingState = {
      sourceDataPath: "/data",
      rawPaths: ["BAR/05022026_01/sernum-0001_ser-AAHead_Scout"],
      pathPatterns: [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
          blocks: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"],
          uniqueNames: {
            0: ["BAR"],
            1: ["05022026_01"],
            2: ["sernum-0001_ser-AAHead_Scout"],
          },
          count: 1,
          depth: 3,
        },
      ],
      tokenizerConfigs: {
        "VARYING/VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 1, subBlockIndex: 0, tag: "Session" },
          { blockIndex: 1, subBlockIndex: 1, tag: "Run" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
    };
    useProjectStore.getState().acceptSnapshot(snapshot);
    activateProjectLease("project-1", "/project");
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState = {
      ...accepted.document.mappingState,
      modalityAliases: [{ captured: "sernum-0001_ser-AAHead_Scout", mapped: null }],
      sessionAliases: [{ captured: "05022026", alias: "05022026", index: 1 }],
      runAliases: [{ captured: "01", alias: "ASL_1", index: 1 }],
      subjectRenames: [{ original: "BAR", target: "BAR" }],
    };
    vi.mocked(invoke).mockResolvedValue(accepted);

    renderWithProviders();

    await user.click(screen.getByTestId("alias-tab-modality"));
    expect(screen.getByText("sernum-0001_ser-AAHead_Scout")).toBeInTheDocument();

    await user.click(screen.getByTestId("alias-tab-session"));
    expect(screen.getByDisplayValue("05022026")).toBeInTheDocument();

    await user.click(screen.getByTestId("alias-tab-run"));
    expect(screen.getByDisplayValue("ASL_1")).toBeInTheDocument();

    await user.click(screen.getByTestId("alias-tab-subjects"));
    expect(screen.getByDisplayValue("BAR")).toBeInTheDocument();
    await useProjectStore.getState().flushEdits();
    const edits = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "accept_project_edit");
    expect(edits[edits.length - 1]).toEqual([
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ kind: "import", mapping: accepted.document.mappingState }),
      }),
    ]);
  });

  it("renders the title", () => {
    renderWithProviders();
    expect(screen.getAllByText("Alias Resolution")[0]).toBeInTheDocument();
  });

  it("renders all four tab labels", () => {
    renderWithProviders();
    expect(screen.getByText("Subjects")).toBeInTheDocument();
    expect(screen.getByText("Sessions (visits)")).toBeInTheDocument();
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("Modalities")).toBeInTheDocument();
  });

  it("disables session and run tabs when those tags are not assigned", () => {
    renderWithProviders();
    expect(screen.getByTestId("alias-tab-session")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("alias-tab-run")).toHaveAttribute("data-disabled", "true");
  });

  it("shows empty state for modality tab when no aliases", () => {
    renderWithProviders();
    const emptyText = screen.queryAllByText(/No modalities detected/);
    expect(emptyText.length).toBeGreaterThan(0);
  });

  it("shows modality aliases when present", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState.modalityAliases = [
      { captured: "t1_mpr_tra", mapped: "T1w" },
      { captured: "pcasl_3d", mapped: "ASL4D" },
    ];
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    const t1 = screen.queryAllByText("t1_mpr_tra");
    const pcasl = screen.queryAllByText("pcasl_3d");
    expect(t1.length).toBeGreaterThan(0);
    expect(pcasl.length).toBeGreaterThan(0);
  });

  it("shows readable modality options while keeping ExploreASL mapping codes", async () => {
    const user = userEvent.setup();
    const snapshot = projectFixture();
    snapshot.document.mappingState.modalityAliases = [{ captured: "pcasl_3d", mapped: "T1w" }];
    useProjectStore.getState().acceptSnapshot(snapshot);
    const updateAlias = vi
      .spyOn(useImportStore.getState(), "updateModalityAlias")
      .mockImplementation(() => {});
    renderWithProviders();

    await user.click(screen.getByTestId("alias-tab-modality"));
    expect(screen.getByTestId("modality-select-pcasl-3d")).toHaveValue("T1-weighted Acquisition");
    await user.click(screen.getByTestId("modality-select-pcasl-3d"));

    for (const label of [
      "— Ignore —",
      "T1-weighted Acquisition",
      "T2-weighted Acquisition",
      "ASL Acquisition",
      "M0 Calibration",
      "FLAIR Acquisition",
      "White Matter Hyperintensity Segmentation",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "ASL Acquisition" }));
    expect(updateAlias).toHaveBeenCalledWith("pcasl_3d", "ASL4D");
  });

  it("shows subject renames when present and tab is clicked", async () => {
    const user = userEvent.setup();
    const snapshot = projectFixture();
    snapshot.document.mappingState.subjectRenames = [
      { original: "BAR", target: "BAR" },
      { original: "FOO", target: "FOO" },
    ];
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    await user.click(screen.getByTestId("alias-tab-subjects"));

    expect(screen.getByDisplayValue("BAR")).toBeInTheDocument();
    expect(screen.getByDisplayValue("FOO")).toBeInTheDocument();
  });

  it("renders navigation buttons", () => {
    renderWithProviders();
    expect(screen.getByText(/Back: Tokenize Paths/)).toBeInTheDocument();
    expect(screen.getByText(/Next: Metadata/)).toBeInTheDocument();
  });

  it("blocks metadata until ASL4D or T1w is mapped", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState.modalityAliases = [{ captured: "scout", mapped: null }];
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(screen.getByTestId("alias-next-btn")).toBeDisabled();
    expect(screen.getByTestId("alias-modality-required")).toBeInTheDocument();
  });

  it("allows metadata when ASL4D or T1w is mapped", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState.modalityAliases = [{ captured: "t1", mapped: "T1w" }];
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(screen.getByTestId("alias-next-btn")).not.toBeDisabled();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it } from "vitest";

import AliasResolution from "./AliasResolution";
import { useImportStore } from "../../stores/importStore";

function renderWithProviders() {
  return render(
    <MantineProvider>
      <AliasResolution />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
});

describe("AliasResolution", () => {
  it("derives alias tables from tokenizer output when store aliases are empty", async () => {
    const user = userEvent.setup();
    const store = useImportStore.getState();
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/BAR/05022026_01/sernum-0001_ser-AAHead_Scout"],
      [
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
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: 0, tag: "Session" },
      { blockIndex: 1, subBlockIndex: 1, tag: "Run" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);

    renderWithProviders();

    await user.click(screen.getByTestId("alias-tab-modality"));
    expect(screen.getByText("sernum-0001_ser-AAHead_Scout")).toBeInTheDocument();

    await user.click(screen.getByTestId("alias-tab-session"));
    expect(screen.getByDisplayValue("05022026")).toBeInTheDocument();

    await user.click(screen.getByTestId("alias-tab-run"));
    expect(screen.getByDisplayValue("ASL_1")).toBeInTheDocument();

    await user.click(screen.getByTestId("alias-tab-subjects"));
    expect(screen.getByDisplayValue("BAR")).toBeInTheDocument();
  });

  it("renders the title", () => {
    renderWithProviders();
    expect(screen.getAllByText("Alias Resolution")[0]).toBeInTheDocument();
  });

  it("renders all four tab labels", () => {
    renderWithProviders();
    expect(screen.getByText("Subject Rename")).toBeInTheDocument();
    expect(screen.getByText("Session Order")).toBeInTheDocument();
    expect(screen.getByText("Run Order")).toBeInTheDocument();
    expect(screen.getByText("Modality Map")).toBeInTheDocument();
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
    useImportStore.getState().setModalityAliases([
      { captured: "t1_mpr_tra", mapped: "T1w" },
      { captured: "pcasl_3d", mapped: "ASL4D" },
    ]);
    renderWithProviders();

    const t1 = screen.queryAllByText("t1_mpr_tra");
    const pcasl = screen.queryAllByText("pcasl_3d");
    expect(t1.length).toBeGreaterThan(0);
    expect(pcasl.length).toBeGreaterThan(0);
  });

  it("shows subject renames when present and tab is clicked", async () => {
    const user = userEvent.setup();
    useImportStore.getState().setSubjectRenames([
      { original: "BAR", target: "BAR" },
      { original: "FOO", target: "FOO" },
    ]);
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
    useImportStore.getState().setModalityAliases([{ captured: "scout", mapped: null }]);
    renderWithProviders();

    expect(screen.getByTestId("alias-next-btn")).toBeDisabled();
    expect(screen.getByTestId("alias-modality-required")).toBeInTheDocument();
  });

  it("allows metadata when ASL4D or T1w is mapped", () => {
    useImportStore.getState().setModalityAliases([{ captured: "t1", mapped: "T1w" }]);
    renderWithProviders();

    expect(screen.getByTestId("alias-next-btn")).not.toBeDisabled();
  });
});

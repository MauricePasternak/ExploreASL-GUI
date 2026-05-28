import { render, screen } from "@testing-library/react";
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
  useImportStore.getState().resetImport();
});

describe("AliasResolution", () => {
  it("derives alias tables from tokenizer output when store aliases are empty", () => {
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

    expect(screen.getByText("sernum-0001_ser-AAHead_Scout")).toBeInTheDocument();

    const sessionTabs = screen.queryAllByText("Session / Run Order");
    sessionTabs[0].click();
    expect(screen.getByText("05022026")).toBeInTheDocument();

    const subjectTabs = screen.queryAllByText("Subject Rename");
    subjectTabs[0].click();
    expect(screen.getByDisplayValue("BAR")).toBeInTheDocument();
  });

  it("renders the title", () => {
    renderWithProviders();
    expect(screen.getAllByText("Alias Resolution")[0]).toBeInTheDocument();
  });

  it("renders all three tab labels", () => {
    renderWithProviders();
    const modality = screen.queryAllByText("Modality Map");
    const session = screen.queryAllByText("Session / Run Order");
    const subjects = screen.queryAllByText("Subject Rename");
    expect(modality.length).toBeGreaterThan(0);
    expect(session.length).toBeGreaterThan(0);
    expect(subjects.length).toBeGreaterThan(0);
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

  it("shows subject renames when present and tab is clicked", () => {
    useImportStore.getState().setSubjectRenames([
      { original: "BAR", target: "BAR" },
      { original: "FOO", target: "FOO" },
    ]);
    renderWithProviders();

    // Click on Subject Rename tab using role
    const subjectTabs = screen.queryAllByText("Subject Rename");
    // Click the tab button (first occurrence)
    subjectTabs[0].click();

    // Should display input values
    const barInputs = screen.queryAllByDisplayValue("BAR");
    const fooInputs = screen.queryAllByDisplayValue("FOO");
    expect(barInputs.length).toBeGreaterThan(0);
    expect(fooInputs.length).toBeGreaterThan(0);
  });

  it("renders navigation buttons", () => {
    renderWithProviders();
    const backButtons = screen.queryAllByText(/Back: Tokenize Paths/);
    const nextButtons = screen.queryAllByText(/Next: Metadata/);
    expect(backButtons.length).toBeGreaterThan(0);
    expect(nextButtons.length).toBeGreaterThan(0);
  });
});

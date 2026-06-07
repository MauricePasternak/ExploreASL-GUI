import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ImportPage from "./ImportPage";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useImportStore } from "../stores/importStore";
import { useGlobalStore } from "../stores/globalStore";

function renderWithProviders() {
  return render(
    <MantineProvider>
      <ImportPage />
    </MantineProvider>,
  );
}

afterEach(() => {
  useImportStore.getState().resetImport();
  useGlobalStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: true,
  });
});

describe("ImportPage metadata step", () => {
  it("uses configured delimiters in the tokenizer hierarchy preview", () => {
    const store = useImportStore.getState();
    store.setActiveStep(1);
    store.setIngestionResults(
      ["/data/C9ORF059.12/ASL"],
      [
        {
          signature: "VARYING/ASL",
          samplePath: "C9ORF059.12/ASL",
          blocks: ["C9ORF059.12", "ASL"],
          uniqueNames: {
            0: ["C9ORF059.12"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/ASL", [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ]);
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    renderWithProviders();

    const patternCards = screen.getAllByTestId("pattern-card-VARYING/ASL");
    const patternCard = patternCards[patternCards.length - 1];
    expect(patternCard.textContent).toContain("^(.*)\\\\.(.*)$");
    expect(patternCard.textContent).toContain("Subject=0, Session (Visit)=1");
  });

  it("shows hyphen-delimited sub-blocks in the tokenizer when configured globally", () => {
    const store = useImportStore.getState();
    store.setActiveStep(1);
    store.setIngestionResults(
      ["/data/C9ORF059-12-R1/ASL"],
      [
        {
          signature: "VARYING/ASL",
          samplePath: "C9ORF059-12-R1/ASL",
          blocks: ["C9ORF059-12-R1", "ASL"],
          uniqueNames: {
            0: ["C9ORF059-12-R1"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
    );
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "-"],
      },
      loaded: true,
    });

    renderWithProviders();

    const patternCards = screen.getAllByTestId("pattern-card-VARYING/ASL");
    const patternCard = patternCards[patternCards.length - 1];
    expect(within(patternCard).queryByText("C9ORF059-12-R1")).not.toBeInTheDocument();
    expect(within(patternCard).getAllByText("C9ORF059").length).toBeGreaterThan(0);
    expect(within(patternCard).getAllByText("12").length).toBeGreaterThan(0);
    expect(within(patternCard).getAllByText("R1").length).toBeGreaterThan(0);
  });

  it("renders metadata grouping controls instead of the placeholder", () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/BAR/01/01"],
      [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: {
            0: ["BAR"],
            1: ["01"],
            2: ["01"],
          },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.addMetadataGroup({
      id: "global",
      label: "Global Defaults",
      bidsParams: { ArterialSpinLabelingType: "PCASL" },
      subjectRegExp: "",
      sessionRegExp: "",
      runRegExp: "",
    });

    renderWithProviders();

    expect(
      screen.getAllByRole("button", { name: /apply override metadata/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("BAR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Global Defaults").length).toBeGreaterThan(0);
  });

  it("opens the defaults metadata modal on first entry", () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setIngestionResults(
      ["/data/BAR/01/01"],
      [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.setSubjectRows([
      {
        id: "BAR/01/01",
        subject: "BAR",
        session: "01",
        run: "01",
        groupId: "global",
      },
    ]);

    renderWithProviders();

    expect(
      screen.getByRole("heading", {
        name: /configure default bids metadata/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("combobox", {
        name: /arterial spin labeling type/i,
      })[0],
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save metadata group/i }),
    ).toBeInTheDocument();
  });

  it("preserves assigned override groups when derived rows are recomputed", () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/BAR/01/01"],
      [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: {
            0: ["BAR"],
            1: ["01"],
            2: ["01"],
          },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.addMetadataGroup({
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: { ArterialSpinLabelingType: "PCASL" },
      subjectRegExp: "",
      sessionRegExp: "",
      runRegExp: "",
    });
    store.addMetadataGroup({
      id: "override-1",
      label: "Override 1",
      bidsParams: { ArterialSpinLabelingType: "PASL" },
      subjectRegExp: "^BAR$",
      sessionRegExp: "^01$",
      runRegExp: "^01$",
    });
    store.setSubjectRows([
      {
        id: "BAR/01/01",
        subject: "BAR",
        session: "01",
        run: "01",
        groupId: "override-1",
      },
    ]);

    renderWithProviders();

    expect(screen.getAllByText("BAR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Override 1").length).toBeGreaterThan(0);
    expect(useImportStore.getState().subjectRows[0]?.groupId).toBe("override-1");
  });

  it("derives metadata rows from configured delimiters for sub-block assignments", () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/C9ORF059.12.R1/ASL"],
      [
        {
          signature: "VARYING/ASL",
          samplePath: "C9ORF059.12.R1/ASL",
          blocks: ["C9ORF059.12.R1", "ASL"],
          uniqueNames: {
            0: ["C9ORF059.12.R1"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/ASL", [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 0, subBlockIndex: 2, tag: "Run" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ]);
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    renderWithProviders();

    expect(useImportStore.getState().subjectRows).toEqual([
      {
        id: "C9ORF059/12/R1",
        subject: "C9ORF059",
        session: "12",
        run: "R1",
        groupId: "global-defaults",
      },
    ]);
  });

  it("does not apply one pattern's tokenizer assignments to another same-depth pattern", () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/siteA/sub-001/asl", "/data/siteB/visit-02/asl"],
      [
        {
          signature: "siteA/VARYING/asl",
          samplePath: "siteA/sub-001/asl",
          blocks: ["siteA", "sub-001", "asl"],
          uniqueNames: {
            0: ["siteA"],
            1: ["sub-001"],
            2: ["asl"],
          },
          count: 1,
          depth: 3,
        },
        {
          signature: "siteB/VARYING/asl",
          samplePath: "siteB/visit-02/asl",
          blocks: ["siteB", "visit-02", "asl"],
          uniqueNames: {
            0: ["siteB"],
            1: ["visit-02"],
            2: ["asl"],
          },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("siteA/VARYING/asl", [
      { blockIndex: 1, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);

    renderWithProviders();

    expect(useImportStore.getState().subjectRows).toEqual([
      {
        id: "sub-001/01/01",
        subject: "sub-001",
        session: "01",
        run: "01",
        groupId: "global-defaults",
      },
    ]);
  });

  it("clears derived metadata rows when tokenizer changes remove all derived values", async () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/C9ORF059.12.R1/ASL"],
      [
        {
          signature: "VARYING/ASL",
          samplePath: "C9ORF059.12.R1/ASL",
          blocks: ["C9ORF059.12.R1", "ASL"],
          uniqueNames: {
            0: ["C9ORF059.12.R1"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/ASL", [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 0, subBlockIndex: 2, tag: "Run" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ]);
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    renderWithProviders();

    expect(useImportStore.getState().subjectRows).toHaveLength(1);

    store.setTokenizerConfig("VARYING/ASL", []);

    await waitFor(() => {
      expect(useImportStore.getState().subjectRows).toEqual([]);
    });
  });

  it("blocks navigation to step 5 (Run Import) if metadata is invalid", async () => {
    const store = useImportStore.getState();
    store.setActiveStep(3);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/BAR/01/01"],
      [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.addMetadataGroup({
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: {},
      subjectRegExp: "",
      sessionRegExp: "",
      runRegExp: "",
    });

    renderWithProviders();

    const nextButtons = screen.getAllByRole("button", { name: /next: preview import/i });
    const nextButton = nextButtons[nextButtons.length - 1];
    expect(nextButton).toBeInTheDocument();
    fireEvent.click(nextButton);

    expect(useImportStore.getState().activeStep).toBe(3);

    const { notifications } = await import("@mantine/notifications");
    expect(notifications.show).toHaveBeenCalled();
  });
});

describe("ImportPage alias resolution step", () => {
  it("does not mix same-depth patterns when deriving aliases", () => {
    const store = useImportStore.getState();
    store.setActiveStep(2);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/siteA/sub-001/asl", "/data/siteB/visit-02/t1"],
      [
        {
          signature: "siteA/VARYING/VARYING",
          samplePath: "siteA/sub-001/asl",
          blocks: ["siteA", "sub-001", "asl"],
          uniqueNames: {
            0: ["siteA"],
            1: ["sub-001"],
            2: ["asl"],
          },
          count: 1,
          depth: 3,
        },
        {
          signature: "siteB/VARYING/VARYING",
          samplePath: "siteB/visit-02/t1",
          blocks: ["siteB", "visit-02", "t1"],
          uniqueNames: {
            0: ["siteB"],
            1: ["visit-02"],
            2: ["t1"],
          },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("siteA/VARYING/VARYING", [
      { blockIndex: 1, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);

    renderWithProviders();

    expect(useImportStore.getState().subjectRenames).toEqual([
      {
        original: "sub-001",
        target: "sub-001",
      },
    ]);
    expect(useImportStore.getState().modalityAliases).toEqual([
      {
        captured: "asl",
        mapped: null,
      },
    ]);
  });

  it("derives aliases using configured non-default delimiters", () => {
    const store = useImportStore.getState();
    store.setActiveStep(2);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/C9ORF059.12/ASL"],
      [
        {
          signature: "VARYING/ASL",
          samplePath: "C9ORF059.12/ASL",
          blocks: ["C9ORF059.12", "ASL"],
          uniqueNames: {
            0: ["C9ORF059.12"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/ASL", [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ]);
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    renderWithProviders();

    expect(useImportStore.getState().subjectRenames).toEqual([
      {
        original: "C9ORF059",
        target: "C9ORF059",
      },
    ]);
    expect(useImportStore.getState().sessionAliases).toEqual([
      {
        captured: "12",
        alias: "12",
        index: 1,
      },
    ]);
    expect(useImportStore.getState().runAliases).toEqual([]);
    expect(useImportStore.getState().modalityAliases).toEqual([
      {
        captured: "ASL",
        mapped: null,
      },
    ]);
  });

  it("clears derived alias state when tokenizer changes remove all derived values", async () => {
    const store = useImportStore.getState();
    store.setActiveStep(2);
    store.setSourceDataPath("/data");
    store.setIngestionResults(
      ["/data/C9ORF059.12/ASL"],
      [
        {
          signature: "VARYING/ASL",
          samplePath: "C9ORF059.12/ASL",
          blocks: ["C9ORF059.12", "ASL"],
          uniqueNames: {
            0: ["C9ORF059.12"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/ASL", [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ]);
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    renderWithProviders();

    expect(useImportStore.getState().subjectRenames).toHaveLength(1);
    expect(useImportStore.getState().sessionAliases).toHaveLength(1);
    expect(useImportStore.getState().modalityAliases).toHaveLength(1);

    store.setTokenizerConfig("VARYING/ASL", []);

    await waitFor(() => {
      expect(useImportStore.getState().subjectRenames).toEqual([]);
      expect(useImportStore.getState().sessionAliases).toEqual([]);
      expect(useImportStore.getState().runAliases).toEqual([]);
      expect(useImportStore.getState().modalityAliases).toEqual([]);
    });
  });
});

describe("ImportPage import runner step", () => {
  it("renders staging preview and config sections and disables import when settings are missing", () => {
    const store = useImportStore.getState();
    store.setActiveStep(4);
    store.setIngestionResults(
      ["/data/BAR/01/01"],
      [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.setBMatchDirectories(true);
    store.setSessionAliases([{ captured: "01", alias: "ASL_1", index: 1 }]);
    store.setModalityAliases([{ captured: "pcasl", mapped: "ASL4D" }]);
    store.addMetadataGroup({
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: { ArterialSpinLabelingType: "PCASL" },
      subjectRegExp: "",
      sessionRegExp: "",
      runRegExp: "",
    });

    renderWithProviders();

    expect(screen.getAllByText("Preview Import").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ExploreASL Configuration").length).toBeGreaterThan(0);
    const runButtons = screen.getAllByRole("button", { name: /run import/i });
    expect(runButtons[runButtons.length - 1]).toBeDisabled();
  });

  it("shows progress rows and enables import when global settings are configured", () => {
    const store = useImportStore.getState();
    store.setActiveStep(4);
    store.setIngestionResults(
      ["/data/BAR/01/01"],
      [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
    );
    store.setTokenizerConfig("VARYING/VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.setBMatchDirectories(false);
    store.setSessionAliases([{ captured: "visit_1", alias: "ASL_1", index: 1 }]);
    store.setModalityAliases([{ captured: "t1_mpr", mapped: "T1w" }]);
    store.addMetadataGroup({
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: { ArterialSpinLabelingType: "PASL" },
      subjectRegExp: "",
      sessionRegExp: "",
      runRegExp: "",
    });
    store.updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "running",
      currentStep: "DCM2NII",
    });

    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        matlabInstallations: [
          { id: "matlab-r2025a", label: "MATLAB R2025a", path: "/opt/matlab" },
        ],
        exploreAslPath: "/opt/ExploreASL",
      },
      loaded: true,
    });

    renderWithProviders();

    expect(screen.getAllByText("BAR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DCM2NII").length).toBeGreaterThan(0);
    const runButtons = screen.getAllByRole("button", { name: /run import/i });
    expect(runButtons[runButtons.length - 1]).toBeEnabled();
  });
});

describe("ImportPage stepper navigation", () => {
  const pattern = {
    signature: "VARYING/VARYING",
    samplePath: "SUB/ASL",
    blocks: ["SUB", "ASL"],
    uniqueNames: { 0: ["SUB"], 1: ["ASL"] },
    count: 1,
    depth: 2,
  };

  it("keeps the stepper sidebar mounted for layout", () => {
    renderWithProviders();
    expect(screen.getAllByTestId("import-stepper-sidebar").length).toBeGreaterThan(0);
  });

  it("stepper clicks do not navigate (display-only)", () => {
    const store = useImportStore.getState();
    store.setActiveStep(1);
    store.setIngestionResults(["/data/SUB/ASL"], [pattern]);
    store.setTokenizerConfig("VARYING/VARYING", [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ]);

    renderWithProviders();
    const sidebar = screen.getAllByTestId("import-stepper-sidebar")[0];

    fireEvent.click(within(sidebar).getByTestId("import-step-2"));
    expect(useImportStore.getState().activeStep).toBe(1);

    fireEvent.click(within(sidebar).getByTestId("import-step-3"));
    expect(useImportStore.getState().activeStep).toBe(1);
  });
});

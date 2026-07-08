import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import ImportPage from "./ImportPage";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { makeMatlabProfile } from "../test/profileFixtures";
import { useImportStore } from "../stores/importStore";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";

function renderWithProviders() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

afterEach(() => {
  useImportStore.getState().resetImport();
  useGlobalStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: true,
    profileValidationState: {},
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
    expect(patternCard.textContent).toContain("Subject=1, Session (Visit)=2");
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
        id: "BAR/01",
        subject: "BAR",
        session: "01",
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
    expect(screen.getByRole("button", { name: /save metadata group/i })).toBeInTheDocument();
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
    });
    store.addMetadataGroup({
      id: "override-1",
      label: "Override 1",
      bidsParams: { ArterialSpinLabelingType: "PASL" },
    });
    store.setSubjectRows([
      {
        id: "BAR/01",
        subject: "BAR",
        session: "01",
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
        id: "C9ORF059/12",
        subject: "C9ORF059",
        session: "12",
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
        id: "sub-001/01",
        subject: "sub-001",
        session: "01",
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
  const validBidsParams = {
    ArterialSpinLabelingType: "PCASL" as const,
    PostLabelingDelay: [1.8],
    MRAcquisitionType: "3D" as const,
    MagneticFieldStrength: 3,
    Manufacturer: "Siemens" as const,
    ASLContext: "control,label",
    M0Type: "Separate" as const,
    LabelingDuration: 1.8,
    BackgroundSuppression: false,
  };

  it("renders preview-only navigation and gates Run Import when settings are missing", () => {
    const store = useImportStore.getState();
    store.setActiveStep(4);
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
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.setBMatchDirectories(true);
    store.setSessionAliases([{ captured: "01", alias: "ASL_1", index: 1 }]);
    store.setModalityAliases([{ captured: "01", mapped: "ASL4D" }]);
    store.addMetadataGroup({
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: validBidsParams,
    });

    renderWithProviders();

    expect(screen.getAllByText("Preview Import").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ExploreASL Configuration").length).toBeGreaterThan(0);
    const backButtons = screen.getAllByRole("button", { name: /back: metadata/i });
    expect(backButtons[backButtons.length - 1]).toBeEnabled();
    const nextButtons = screen.getAllByRole("button", { name: /next: run import/i });
    expect(nextButtons[nextButtons.length - 1]).toBeDisabled();
  });

  it("navigates from preview to run import when metadata and settings are configured", () => {
    const store = useImportStore.getState();
    store.setActiveStep(4);
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
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ]);
    store.setBMatchDirectories(false);
    store.setSessionAliases([{ captured: "visit_1", alias: "ASL_1", index: 1 }]);
    store.setModalityAliases([{ captured: "01", mapped: "T1w" }]);
    store.addMetadataGroup({
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: validBidsParams,
    });
    store.setSubjectRows([
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ]);
    store.updateImportProgress("BAR", {
      subject: "BAR",
      session: "01",
      status: "running",
      currentStep: "DCM2NII",
    });

    const profile = makeMatlabProfile({
      id: "import-page-profile",
      matlabPath: "/opt/matlab",
      exploreAslPath: "/opt/ExploreASL",
    });
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        executionProfiles: [profile],
      },
      profileValidationState: {
        [profile.id]: { valid: true, errors: [] },
      },
      loaded: true,
    });

    renderWithProviders();

    const nextButtons = screen.getAllByRole("button", { name: /next: run import/i });
    const nextButton = nextButtons[nextButtons.length - 1];
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);

    expect(useImportStore.getState().activeStep).toBe(5);
    expect(screen.getAllByText("Run Import Module").length).toBeGreaterThan(0);
  });

  it("locks step 5 back navigation while import is running and unlocks it after failure", () => {
    const store = useImportStore.getState();
    store.setActiveStep(5);
    store.setImportPhase("running");

    const { rerender } = renderWithProviders();

    const runningBackButtons = screen.getAllByRole("button", { name: /back: preview/i });
    expect(runningBackButtons[runningBackButtons.length - 1]).toBeDisabled();

    store.setImportPhase("failed");
    rerender(
      <MantineProvider>
        <MemoryRouter>
          <ImportPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    const failedBackButtons = screen.getAllByRole("button", { name: /back: preview/i });
    expect(failedBackButtons[failedBackButtons.length - 1]).toBeEnabled();
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

describe("ImportPage dataSource conditional rendering", () => {
  afterEach(() => {
    cleanup();
    useImportStore.getState().resetImport();
    useProjectStore.setState({ project: null });
  });

  it("renders BIDSReviewPanel when dataSource is bids", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "proj-bids",
          name: "BIDS Study",
          rootPath: "/tmp/bids-study",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastOpened: "2026-01-01T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "bids" as const,
        },
        uiState: { import: { bidsReviewConfirmed: false, skippedSubjects: [] } },
        mappingState: {},
        dataPar: {},
      } as any,
      loaded: true,
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <ImportPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getAllByTestId("bids-review-panel").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("import-stepper-sidebar")).not.toBeInTheDocument();
  });

  it("renders DICOM wizard stepper when dataSource is dicom", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "proj-dicom",
          name: "DICOM Study",
          rootPath: "/tmp/dicom-study",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastOpened: "2026-01-01T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      } as any,
      loaded: true,
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <ImportPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByTestId("import-stepper-sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("bids-review-panel")).not.toBeInTheDocument();
  });
});

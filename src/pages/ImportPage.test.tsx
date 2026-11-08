import { TestMantineProvider as MantineProvider } from "../test/render";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { makeMatlabProfile } from "../test/profileFixtures";
import ImportPage from "./ImportPage";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { projectFixture } from "../test/projectFixtures";
import type { TokenAssignment, MetadataGroup } from "../schemas/importSchemas";

function renderWithProviders() {
  return render(
    <MantineProvider env="test">
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  vi.clearAllMocks();
  vi.mocked(invoke).mockReset();
  useImportStore.getState().resetImport();
  resetProjectLifecycleForTests();
  activateProjectLease("project-1", "/project");
});

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  useImportStore.getState().resetImport();
  useGlobalStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: true,
    profileValidationState: {},
  });
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
});

describe("ImportPage metadata step", () => {
  it("keeps missing-source guidance visible outside ingestion and routes Relink to it", async () => {
    const snapshot = projectFixture("project-1", "Project", "/project", {
      mappingState: { sourceDataPath: "/missing/dicom" },
      uiState: { import: { mostRecentConfig: null, activeStep: 5 } },
    });
    activateProjectLease("project-1", "/project");
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.uiState.import!.activeStep = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return accepted;
      if (command === "preflight_staging_plan") return { valid: false, issues: [] };
      return undefined;
    });
    useImportStore.setState({
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing. Relink it.",
      },
    });

    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(screen.getByTestId("import-missing-source-warning")).toHaveTextContent(
      "Source missing. Relink it.",
    );
    expect(screen.getByTestId("import-missing-source-path")).toHaveTextContent("/missing/dicom");
    fireEvent.click(screen.getByTestId("import-relink-btn"));
    await waitFor(() =>
      expect(useProjectStore.getState().project?.uiState.import?.activeStep).toBe(0),
    );
    expect(screen.getByTestId("dicom-missing-source-warning")).toBeInTheDocument();
  });
  it("uses configured delimiters in the tokenizer hierarchy preview", () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 1 };
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["002.12/ASL"],
      pathPatterns: [
        {
          signature: "VARYING/ASL",
          samplePath: "002.12/ASL",
          blocks: ["002.12", "ASL"],
          uniqueNames: {
            0: ["002.12"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/ASL": assignments };
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    const patternCards = screen.getAllByTestId("pattern-card-VARYING/ASL");
    const patternCard = patternCards[patternCards.length - 1];
    expect(patternCard.textContent).toContain("^(.*)\\\\.(.*)$");
    expect(patternCard.textContent).toContain("Subject=1, Session (Visit)=2");
  });

  it("shows hyphen-delimited sub-blocks in the tokenizer when configured globally", () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 1 };
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["002-12-R1/ASL"],
      pathPatterns: [
        {
          signature: "VARYING/ASL",
          samplePath: "002-12-R1/ASL",
          blocks: ["002-12-R1", "ASL"],
          uniqueNames: {
            0: ["002-12-R1"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
      ingestionComplete: true,
    });
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "-"],
      },
      loaded: true,
    });

    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    const patternCards = screen.getAllByTestId("pattern-card-VARYING/ASL");
    const patternCard = patternCards[patternCards.length - 1];
    expect(within(patternCard).queryByText("002-12-R1")).not.toBeInTheDocument();
    expect(within(patternCard).getAllByText("002").length).toBeGreaterThan(0);
    expect(within(patternCard).getAllByText("12").length).toBeGreaterThan(0);
    expect(within(patternCard).getAllByText("R1").length).toBeGreaterThan(0);
  });

  it("opens the defaults metadata modal on first entry", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 3 };
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState.metadataGroups = [
      { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(
      await screen.findByRole("heading", {
        name: /configure default bids metadata/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("combobox", {
        name: /arterial spin labeling type/i,
      })[0],
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save metadata group/i })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /apply override metadata/i, hidden: true }).length,
    ).toBeGreaterThan(0);
    await useProjectStore.getState().flushEdits();
  });

  it("preserves assigned override groups when derived rows are recomputed", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 3 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["BAR/01/01", "FOO/01/01"],
      pathPatterns: [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: {
            0: ["BAR", "FOO"],
            1: ["01"],
            2: ["01"],
          },
          count: 2,
          depth: 3,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/VARYING/VARYING": assignments };
    const group: MetadataGroup = {
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: { ArterialSpinLabelingType: "PCASL" },
    };
    snapshot.document.mappingState.metadataGroups = [group];
    const override: MetadataGroup = {
      id: "override-1",
      label: "Override 1",
      bidsParams: { ArterialSpinLabelingType: "PASL" },
    };
    snapshot.document.mappingState.metadataGroups!.push(override);
    snapshot.document.mappingState.subjectRows = [
      {
        id: "BAR/01",
        subject: "BAR",
        session: "01",
        groupId: "override-1",
      },
    ];

    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState.subjectRows!.push({
      id: "captured:FOO/01",
      subject: "FOO",
      session: "01",
      groupId: "global-defaults",
    });
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      edit: { mapping: { subjectRows: accepted.document.mappingState.subjectRows } },
    });
    expect(screen.getAllByText("BAR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Override 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Global Defaults").length).toBeGreaterThan(0);
    expect(useProjectStore.getState().project?.mappingState.subjectRows?.[0]?.groupId).toBe(
      "override-1",
    );
  });

  it("derives metadata rows from configured delimiters for sub-block assignments", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 3 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["002.12.R1/ASL"],
      pathPatterns: [
        {
          signature: "VARYING/ASL",
          samplePath: "002.12.R1/ASL",
          blocks: ["002.12.R1", "ASL"],
          uniqueNames: {
            0: ["002.12.R1"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 0, subBlockIndex: 2, tag: "Run" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/ASL": assignments };
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    snapshot.document.mappingState.metadataGroups = [
      { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
    ];
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState.subjectRows = [
      { id: "captured:002/12", subject: "002", session: "12", groupId: "global-defaults" },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      edit: { mapping: { subjectRows: accepted.document.mappingState.subjectRows } },
    });
    expect(useProjectStore.getState().project?.mappingState.subjectRows).toEqual([
      {
        id: "captured:002/12",
        subject: "002",
        session: "12",
        groupId: "global-defaults",
      },
    ]);
  });

  it("does not apply one pattern's tokenizer assignments to another same-depth pattern", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 3 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["siteA/sub-001/asl", "siteB/visit-02/asl"],
      pathPatterns: [
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
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 1, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "siteA/VARYING/asl": assignments };

    snapshot.document.mappingState.metadataGroups = [
      { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
    ];
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState.subjectRows = [
      { id: "captured:sub-001/01", subject: "sub-001", session: "01", groupId: "global-defaults" },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      edit: { mapping: { subjectRows: accepted.document.mappingState.subjectRows } },
    });
    expect(useProjectStore.getState().project?.mappingState.subjectRows).toEqual([
      {
        id: "captured:sub-001/01",
        subject: "sub-001",
        session: "01",
        groupId: "global-defaults",
      },
    ]);
  });

  it("clears derived metadata rows when tokenizer changes remove all derived values", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 3 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["002.12.R1/ASL"],
      pathPatterns: [
        {
          signature: "VARYING/ASL",
          samplePath: "002.12.R1/ASL",
          blocks: ["002.12.R1", "ASL"],
          uniqueNames: {
            0: ["002.12.R1"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 0, subBlockIndex: 2, tag: "Run" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/ASL": assignments };
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    snapshot.document.mappingState.metadataGroups = [
      { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
    ];
    snapshot.document.mappingState.subjectRows = [
      { id: "002/12", subject: "002", session: "12", groupId: "global-defaults" },
    ];
    const changed = structuredClone(snapshot);
    changed.acceptedRevision = 1;
    changed.document.mappingState.tokenizerConfigs = { "VARYING/ASL": [] };
    const cleared = structuredClone(changed);
    cleared.acceptedRevision = 2;
    cleared.document.mappingState.subjectRows = [];
    vi.mocked(invoke).mockResolvedValueOnce(changed).mockResolvedValueOnce(cleared);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(useProjectStore.getState().project?.mappingState.subjectRows).toHaveLength(1);

    useImportStore.getState().setTokenizerConfig("VARYING/ASL", []);

    await useProjectStore.getState().flushEdits();
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
      edit: { mapping: { subjectRows: [] } },
    });
    await waitFor(() => {
      expect(useProjectStore.getState().project?.mappingState.subjectRows).toEqual([]);
    });
  });

  it("blocks navigation to step 5 (Run Import) if metadata is invalid", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 3 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["BAR/01/01"],
      pathPatterns: [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/VARYING/VARYING": assignments };
    const group: MetadataGroup = {
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: {},
    };
    snapshot.document.mappingState.metadataGroups = [group];

    snapshot.document.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ];
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    const nextButtons = screen.getAllByRole("button", { name: /next: preview import/i });
    const nextButton = nextButtons[nextButtons.length - 1];
    expect(nextButton).toBeInTheDocument();
    fireEvent.click(nextButton);

    expect(useProjectStore.getState().project?.uiState.import?.activeStep).toBe(3);

    expect(notifications.show).toHaveBeenCalled();
  });
});

describe("ImportPage alias resolution step", () => {
  it("does not mix same-depth patterns when deriving aliases", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 2 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["siteA/sub-001/asl", "siteB/visit-02/t1"],
      pathPatterns: [
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
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 1, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "siteA/VARYING/VARYING": assignments };

    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.mappingState.subjectRenames = [{ original: "sub-001", target: "sub-001" }];
    accepted.document.mappingState.modalityAliases = [{ captured: "asl", mapped: null }];
    vi.mocked(invoke).mockResolvedValue(accepted);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    await useProjectStore.getState().flushEdits();
    expect(invoke).toHaveBeenLastCalledWith(
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ mapping: accepted.document.mappingState }),
      }),
    );
    expect(useProjectStore.getState().project?.mappingState.subjectRenames).toEqual([
      {
        original: "sub-001",
        target: "sub-001",
      },
    ]);
    expect(useProjectStore.getState().project?.mappingState.modalityAliases).toEqual([
      {
        captured: "asl",
        mapped: null,
      },
    ]);
  });

  it("clears derived alias state when tokenizer changes remove all derived values", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 2 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["002.12/ASL"],
      pathPatterns: [
        {
          signature: "VARYING/ASL",
          samplePath: "002.12/ASL",
          blocks: ["002.12", "ASL"],
          uniqueNames: {
            0: ["002.12"],
            1: ["ASL"],
          },
          count: 1,
          depth: 2,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/ASL": assignments };
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        tokenSubDelimiters: ["_", "."],
      },
      loaded: true,
    });

    Object.assign(snapshot.document.mappingState, {
      subjectRenames: [{ original: "002", target: "002" }],
      sessionAliases: [{ captured: "12", alias: "12", index: 1 }],
      modalityAliases: [{ captured: "ASL", mapped: null }],
    });
    const changed = structuredClone(snapshot);
    changed.acceptedRevision = 1;
    changed.document.mappingState.tokenizerConfigs = { "VARYING/ASL": [] };
    const cleared = structuredClone(changed);
    cleared.acceptedRevision = 2;
    Object.assign(cleared.document.mappingState, {
      subjectRenames: [],
      sessionAliases: [],
      runAliases: [],
      modalityAliases: [],
    });
    vi.mocked(invoke).mockResolvedValueOnce(changed).mockResolvedValue(cleared);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(useProjectStore.getState().project?.mappingState.subjectRenames).toHaveLength(1);
    expect(useProjectStore.getState().project?.mappingState.sessionAliases).toHaveLength(1);
    expect(useProjectStore.getState().project?.mappingState.modalityAliases).toHaveLength(1);

    await useProjectStore.getState().flushEdits();
    expect(invoke).not.toHaveBeenCalled();
    useImportStore.getState().setTokenizerConfig("VARYING/ASL", []);

    await useProjectStore.getState().flushEdits();
    expect(invoke).toHaveBeenLastCalledWith(
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ mapping: cleared.document.mappingState }),
      }),
    );
    await waitFor(() => {
      expect(useProjectStore.getState().project?.mappingState.subjectRenames).toEqual([]);
      expect(useProjectStore.getState().project?.mappingState.sessionAliases).toEqual([]);
      expect(useProjectStore.getState().project?.mappingState.runAliases).toEqual([]);
      expect(useProjectStore.getState().project?.mappingState.modalityAliases).toEqual([]);
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

  it("renders preview-only navigation and gates Run Import when settings are missing", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 5 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["BAR/01/01"],
      pathPatterns: [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/VARYING/VARYING": assignments };
    snapshot.document.mappingState.bMatchDirectories = true;
    snapshot.document.mappingState.sessionAliases = [{ captured: "01", alias: "ASL_1", index: 1 }];
    snapshot.document.mappingState.modalityAliases = [{ captured: "01", mapped: "ASL4D" }];
    const group: MetadataGroup = {
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: validBidsParams,
    };
    snapshot.document.mappingState.metadataGroups = [group];

    vi.mocked(invoke).mockResolvedValue({ valid: false, issues: [] });
    const before = structuredClone(snapshot.document);
    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    expect(screen.getAllByText("Preview Import").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ExploreASL Configuration").length).toBeGreaterThan(0);
    const backButtons = screen.getAllByRole("button", { name: /back: metadata/i });
    expect(backButtons[backButtons.length - 1]).toBeEnabled();
    const nextButtons = screen.getAllByRole("button", { name: /next: run import/i });
    expect(nextButtons[nextButtons.length - 1]).toBeDisabled();
    await waitFor(() => expect(useImportStore.getState().stagingPreflight.status).toBe("invalid"));
    expect(useProjectStore.getState().project?.uiState.import?.activeStep).toBe(5);
    expect(useProjectStore.getState().project?.mappingState).toEqual(before.mappingState);
    expect(useProjectStore.getState().project?.uiState).toEqual(before.uiState);
    expect(screen.queryByTestId("import-execution")).not.toBeInTheDocument();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([command]) => command === "accept_project_edit" || command === "save_project",
        ),
    ).toBe(false);
  });

  it("navigates from preview to run import when metadata and settings are configured", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 4 };
    snapshot.document.mappingState.sourceDataPath = "/data";
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["BAR/01/01"],
      pathPatterns: [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "BAR/01/01",
          blocks: ["BAR", "01", "01"],
          uniqueNames: { 0: ["BAR"], 1: ["01"], 2: ["01"] },
          count: 1,
          depth: 3,
        },
      ],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/VARYING/VARYING": assignments };
    snapshot.document.mappingState.bMatchDirectories = false;
    snapshot.document.mappingState.sessionAliases = [
      { captured: "visit_1", alias: "ASL_1", index: 1 },
    ];
    snapshot.document.mappingState.modalityAliases = [{ captured: "01", mapped: "T1w" }];
    const group: MetadataGroup = {
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: validBidsParams,
    };
    snapshot.document.mappingState.metadataGroups = [group];
    snapshot.document.mappingState.subjectRows = [
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "global-defaults" },
    ];
    useImportStore.setState({
      importProgress: {
        BAR: {
          subject: "BAR",
          session: "01",
          status: "running",
          currentStep: "DCM2NII",
        },
      },
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
    snapshot.document.uiState.import!.selectedProfileId = profile.id;
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.uiState.import!.activeStep = 5;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "preflight_staging_plan") return { valid: true, issues: [] };
      if (command === "accept_project_edit") return accepted;
      if (command === "read_import_status" || command === "list_module_logs") return [];
      if (command === "get_active_import_run") return null;
      return undefined;
    });

    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();

    await waitFor(() => {
      const nextButtons = screen.getAllByRole("button", { name: /next: run import/i });
      expect(nextButtons[nextButtons.length - 1]).toBeEnabled();
    });

    const nextButtons = screen.getAllByRole("button", { name: /next: run import/i });
    const nextButton = nextButtons[nextButtons.length - 1];

    expect(useImportStore.getState().stagingPreflight.status).toBe("valid");
    expect(useImportStore.getState().importProgress.BAR.status).toBe("running");
    fireEvent.click(nextButton);
    await useProjectStore.getState().flushEdits();

    expect(useProjectStore.getState().project?.uiState.import?.activeStep).toBe(5);
    expect(screen.getAllByText("Run Import Module").length).toBeGreaterThan(0);
  });

  it("locks step 5 back navigation while import is running and unlocks it after failure", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 5 };
    useImportStore.setState({ importPhase: "running" });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run") return null;
      if (command === "read_import_status" || command === "list_module_logs") return [];
      return undefined;
    });

    useProjectStore.getState().acceptSnapshot(snapshot);
    const { rerender } = renderWithProviders();

    const runningBackButtons = screen.getAllByRole("button", { name: /back: preview/i });
    expect(runningBackButtons[runningBackButtons.length - 1]).toBeDisabled();

    useImportStore.setState({ importPhase: "failed" });
    rerender(
      <MantineProvider env="test">
        <MemoryRouter>
          <ImportPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    const failedBackButtons = screen.getAllByRole("button", { name: /back: preview/i });
    await waitFor(() => expect(failedBackButtons[failedBackButtons.length - 1]).toBeEnabled());
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

  it.each([
    [0, "dicom-nav"],
    [1, "tokenizer-nav"],
    [2, "alias-nav"],
    [3, "metadata-nav"],
    [4, "preview-nav"],
    [5, "import-execution-nav"],
  ] as const)("renders step %s navigation inside the stepper", (activeStep, navigationId) => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep };
    snapshot.document.mappingState.metadataGroups = [
      { id: "global-defaults", label: "Global Defaults", bidsParams: {} },
    ];
    if (activeStep === 5) useImportStore.setState({ importPhase: "failed" });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run") return null;
      if (command === "read_import_status" || command === "list_module_logs") return [];
      if (command === "preflight_staging_plan") return { valid: false, issues: [] };
      return undefined;
    });
    useProjectStore.getState().acceptSnapshot(snapshot);

    renderWithProviders();

    const navigation = screen.getByTestId(navigationId);
    expect(screen.getByTestId("import-stepper")).toContainElement(navigation);
    expect(screen.getByTestId("import-step-panel")).not.toContainElement(navigation);
    expect(screen.getAllByTestId(/-footer$/)).toHaveLength(1);
  });

  it("keeps navigation inside the stepper and stepper clicks display-only", async () => {
    const snapshot = projectFixture();
    snapshot.document.uiState.import = { mostRecentConfig: null, activeStep: 1 };
    Object.assign(snapshot.document.mappingState, {
      rawPaths: ["SUB/ASL"],
      pathPatterns: [pattern],
      ingestionComplete: true,
    });
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    snapshot.document.mappingState.tokenizerConfigs = { "VARYING/VARYING": assignments };
    const accepted = structuredClone(snapshot);
    accepted.acceptedRevision = 1;
    accepted.document.uiState.import!.activeStep = 0;
    vi.mocked(invoke).mockResolvedValueOnce(accepted);

    useProjectStore.getState().acceptSnapshot(snapshot);
    renderWithProviders();
    const sidebar = screen.getAllByTestId("import-stepper-sidebar")[0];
    const stepper = within(sidebar).getByTestId("import-stepper");
    const steps = within(stepper).getByTestId("import-stepper-steps");
    expect(within(stepper).getByRole("region", { name: "Import steps" })).toBe(steps);
    expect(steps).toHaveAttribute("tabindex", "0");
    expect(steps).toHaveStyle({ overflowY: "auto", flex: "1", minHeight: "0" });
    expect(screen.getByTestId("import-page")).toHaveStyle({ flex: "1", minHeight: "0" });
    expect(screen.getByTestId("import-panels")).toHaveStyle({ flex: "1", minHeight: "0" });
    const content = screen.getByTestId("path-tokenizer-content");
    const footer = screen.getByTestId("path-tokenizer-footer");
    expect(content).toHaveStyle({ flex: "1", minHeight: "0", overflow: "auto" });
    expect(footer).toHaveStyle({ flexShrink: "0" });
    expect(within(stepper).getByTestId("import-stepper-navigation")).toContainElement(footer);
    expect(footer).toContainElement(screen.getByTestId("tokenizer-nav"));
    expect(content).not.toContainElement(footer);
    expect(screen.getByTestId("import-step-panel")).not.toContainElement(footer);

    fireEvent.click(within(sidebar).getByTestId("import-step-2"));
    expect(useProjectStore.getState().project?.uiState.import?.activeStep).toBe(1);

    fireEvent.click(within(sidebar).getByTestId("import-step-3"));
    expect(useProjectStore.getState().project?.uiState.import?.activeStep).toBe(1);

    fireEvent.click(within(sidebar).getByTestId("tokenizer-back-btn"));
    await waitFor(() => expect(within(stepper).getByTestId("dicom-next-btn")).toBeEnabled());
    expect(within(stepper).queryByTestId("tokenizer-nav")).not.toBeInTheDocument();
  });
});

describe("ImportPage dataSource conditional rendering", () => {
  afterEach(() => {
    cleanup();
    useImportStore.getState().resetImport();
    useProjectStore.setState({ project: null });
  });

  it("renders BIDSReviewPanel when dataSource is bids", () => {
    vi.mocked(invoke).mockResolvedValueOnce({ groups: [], skipped: [] });
    const snapshot = projectFixture();
    snapshot.document.projectMeta.dataSource = "bids";
    snapshot.document.mappingState.sourceDataPath = ".";
    useProjectStore.getState().acceptSnapshot(snapshot);

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <ImportPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getAllByTestId("bids-review-panel").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("import-stepper-sidebar")).not.toBeInTheDocument();
  });
});

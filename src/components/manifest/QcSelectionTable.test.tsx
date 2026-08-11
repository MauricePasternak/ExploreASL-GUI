import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

vi.mock("mantine-datatable", () => ({
  DataTable: ({ records, columns, idAccessor = "id" }: any) => (
    <table data-testid="qc-verdict-table">
      <thead>
        <tr>
          {columns.map((col: any, idx: number) => (
            <th key={col.accessor || idx}>{col.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record: any) => {
          const id = record[idAccessor];
          return (
            <tr key={id} data-testid={`row-${id}`}>
              {columns.map((col: any, idx: number) => {
                const content = col.render ? col.render(record) : record[col.accessor];
                return <td key={col.accessor || idx}>{content}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  ),
}));

import QcSelectionTable from "./QcSelectionTable";
import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import type { ManifestVerdict } from "../../schemas/project";
import type { MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { useProjectStore } from "../../stores/projectStore";
import { useManifestStore } from "../../stores/manifestStore";
import { useProcessingStore } from "../../stores/processingStore";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const subject1: SubjectInfo = {
  subjectSession: "sub-01_01",
  subject: "sub-01",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: [],
};

const subject2: SubjectInfo = {
  subjectSession: "sub-02_01",
  subject: "sub-02",
  session: "01",
  hasStructural: true,
  hasASL: false,
  aslRuns: [],
};

const subject3: SubjectInfo = {
  subjectSession: "sub-03_01",
  subject: "sub-03",
  session: "01",
  hasStructural: false,
  hasASL: true,
  aslRuns: [],
};

const subject4: SubjectInfo = {
  subjectSession: "sub-04_01",
  subject: "sub-04",
  session: "01",
  hasStructural: false,
  hasASL: false,
  aslRuns: [],
};

const statusComplete: SubjectModuleStatus = {
  subjectSession: "sub-01_01",
  module: "structural",
  status: "complete",
  completedSteps: [],
  locked: false,
};

const statusIncomplete: SubjectModuleStatus = {
  subjectSession: "sub-02_01",
  module: "structural",
  status: "incomplete",
  completedSteps: [],
  locked: false,
};

const group1: MetadataGroup = {
  id: "g1",
  label: "Global Defaults",
  bidsParams: {},
};

const group2: MetadataGroup = {
  id: "g2",
  label: "Encoding Group",
  bidsParams: {},
};

const subjectRow1: SubjectRow = {
  id: "sub-01/01",
  subject: "sub-01",
  session: "01",
  groupId: "g1",
};

const subjectRow2: SubjectRow = {
  id: "sub-02/01",
  subject: "sub-02",
  session: "01",
  groupId: "g2",
};

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

let mockAvailableSubjects: SubjectInfo[] = [];
let mockSubjectStatuses: SubjectModuleStatus[] = [];
let mockVerdicts: Record<string, ManifestVerdict> = {};
let mockNestedVerdicts: Record<string, Record<string, ManifestVerdict>> | undefined;
let mockReviewers: { id: string; label: string; createdAt: string }[] | undefined;
let mockActiveReviewerId: string | undefined;
let mockStaleVerdicts: Set<string> | Record<string, Set<string>> = new Set();
let mockMetadataGroups: MetadataGroup[] = [];
let mockSubjectRows: SubjectRow[] = [];
let mockBids2LegacyExists = true;

function buildProjectState() {
  return {
    version: "0.1.0" as const,
    projectMeta: {
      id: "project-1",
      name: "Brain Study",
      rootPath: "/test/project",
      createdAt: "2026-05-03T00:00:00.000Z",
      lastOpened: "2026-05-03T00:00:00.000Z",
      currentPhase: "manifest" as const,
      dataSource: "dicom" as const,
    },
    mappingState: {
      metadataGroups: mockMetadataGroups,
      subjectRows: mockSubjectRows,
    },
    uiState: {
      processing: {
        population: {
          lastRun: {
            Mtime: null,
          },
        },
      },
      manifest: {
        ...(mockReviewers
          ? { reviewers: mockReviewers, activeReviewerId: mockActiveReviewerId }
          : {}),
        verdicts: mockNestedVerdicts ?? mockVerdicts,
      },
    },
    dataPar: {},
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTable(
  props: {
    noInfoSubjects?: Set<string>;
    onNextReady?: (ready: boolean) => void;
    reviewerId?: string;
  } = {},
) {
  vi.mocked(exists).mockResolvedValue(mockBids2LegacyExists);
  useProcessingStore.setState({
    availableSubjects: mockAvailableSubjects,
    subjectStatuses: mockSubjectStatuses.map((s) => ({
      bids2legacyExists: mockBids2LegacyExists,
      ...s,
    })),
  });
  useProjectStore.setState({
    project: buildProjectState() as any,
    loaded: true,
  });
  useManifestStore.setState({
    staleVerdicts: mockStaleVerdicts,
    step: 0,
    filter: "all",
  });
  return render(
    <MantineProvider>
      <QcSelectionTable
        noInfoSubjects={props.noInfoSubjects ?? new Set()}
        onNextReady={props.onNextReady}
        reviewerId={props.reviewerId}
      />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockAvailableSubjects = [];
  mockSubjectStatuses = [];
  mockVerdicts = {};
  mockNestedVerdicts = undefined;
  mockReviewers = undefined;
  mockActiveReviewerId = undefined;
  mockStaleVerdicts = new Set();
  mockMetadataGroups = [];
  mockSubjectRows = [];
  mockBids2LegacyExists = true;
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });
  useManifestStore.setState({ staleVerdicts: new Set(), step: 0, filter: "all" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QcSelectionTable", () => {
  const reviewer1 = {
    id: "11111111-1111-4111-8111-111111111111",
    label: "Reviewer 1",
    createdAt: "2026-08-08T00:00:00.000Z",
  };
  const reviewer2 = {
    id: "22222222-2222-4222-8222-222222222222",
    label: "Reviewer 2",
    createdAt: "2026-08-08T00:00:00.000Z",
  };

  function setupMultiReviewerVerdicts() {
    mockAvailableSubjects = [subject1, subject2];
    mockSubjectStatuses = [
      statusComplete,
      { ...statusComplete, module: "asl" },
      { ...statusComplete, subjectSession: "sub-02_01" },
      { ...statusComplete, subjectSession: "sub-02_01", module: "asl" },
    ];
    mockReviewers = [reviewer1, reviewer2];
    mockActiveReviewerId = reviewer1.id;
  }

  it("uses only the supplied reviewer verdict slice in multi-reviewer mode", () => {
    setupMultiReviewerVerdicts();
    mockActiveReviewerId = reviewer2.id;
    mockNestedVerdicts = {
      [reviewer1.id]: {},
      [reviewer2.id]: { "sub-01_01": { status: "pass", setAt: 1 } },
    };

    renderTable({ reviewerId: reviewer1.id });

    expect(
      within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Neutral"),
    ).toBeTruthy();
    expect(screen.getByTestId("qc-filter-count-neutral")).toHaveTextContent("2");
    expect(screen.getByTestId("qc-filter-count-pass")).toHaveTextContent("0");
  });

  it("does not read a verdict slice for an unregistered reviewer", () => {
    setupMultiReviewerVerdicts();
    mockNestedVerdicts = {
      [reviewer1.id]: {},
      [reviewer2.id]: {},
      "33333333-3333-4333-8333-333333333333": {
        "sub-01_01": { status: "pass", setAt: 1 },
      },
    };

    renderTable({ reviewerId: "33333333-3333-4333-8333-333333333333" });

    expect(
      within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Neutral"),
    ).toBeTruthy();
    expect(screen.getByTestId("qc-filter-count-pass")).toHaveTextContent("0");
  });

  it("writes and removes verdicts only for the supplied reviewer", async () => {
    const user = userEvent.setup();
    setupMultiReviewerVerdicts();
    mockActiveReviewerId = reviewer2.id;
    mockNestedVerdicts = {
      [reviewer1.id]: {},
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };

    renderTable({ reviewerId: reviewer1.id });
    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Pass"));
    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    });

    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Neutral"));
    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [reviewer1.id]: {},
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    });
  });

  it("does not retain another reviewer's unsaved notes after switching reviewer", () => {
    setupMultiReviewerVerdicts();
    mockNestedVerdicts = {
      [reviewer1.id]: { "sub-01_01": { status: "pass", notes: "Reviewer 1 note", setAt: 1 } },
      [reviewer2.id]: { "sub-01_01": { status: "pass", notes: "Reviewer 2 note", setAt: 1 } },
    };

    const view = renderTable({ reviewerId: reviewer1.id });
    expect(screen.getByTestId("verdict-notes-sub-01_01")).toHaveValue("Reviewer 1 note");

    view.rerender(
      <MantineProvider>
        <QcSelectionTable reviewerId={reviewer2.id} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("verdict-notes-sub-01_01")).toHaveValue("Reviewer 2 note");
  });

  it("keeps a pending fail selection scoped to its reviewer after switching reviewer", async () => {
    const user = userEvent.setup();
    setupMultiReviewerVerdicts();
    mockNestedVerdicts = { [reviewer1.id]: {}, [reviewer2.id]: {} };

    const view = renderTable({ reviewerId: reviewer1.id });
    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Fail"));
    expect(screen.getByTestId("verdict-reason-sub-01_01")).toBeInTheDocument();

    view.rerender(
      <MantineProvider>
        <QcSelectionTable reviewerId={reviewer2.id} />
      </MantineProvider>,
    );

    expect(screen.queryByTestId("verdict-reason-sub-01_01")).not.toBeInTheDocument();
  });

  it("uses the active store reviewer when reviewerId is omitted", async () => {
    const user = userEvent.setup();
    setupMultiReviewerVerdicts();
    mockActiveReviewerId = reviewer2.id;
    mockNestedVerdicts = { [reviewer1.id]: {}, [reviewer2.id]: {} };

    renderTable();
    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Pass"));

    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [reviewer1.id]: {},
      [reviewer2.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
    });
  });

  it("bulk marks complete rows only for its reviewer and skips No Info", async () => {
    const user = userEvent.setup();
    setupMultiReviewerVerdicts();
    mockActiveReviewerId = reviewer2.id;
    mockNestedVerdicts = {
      [reviewer1.id]: {},
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };

    renderTable({ reviewerId: reviewer1.id, noInfoSubjects: new Set(["sub-02_01"]) });
    await user.click(screen.getByTestId("bulk-mark-pass"));

    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    });
  });

  it("shows stale status only from its reviewer slice", () => {
    setupMultiReviewerVerdicts();
    mockActiveReviewerId = reviewer2.id;
    mockNestedVerdicts = { [reviewer1.id]: {}, [reviewer2.id]: {} };
    mockStaleVerdicts = { [reviewer1.id]: new Set(), [reviewer2.id]: new Set(["sub-01_01"]) };

    renderTable({ reviewerId: reviewer1.id });

    expect(screen.queryByTestId("stale-badge-sub-01_01")).not.toBeInTheDocument();
  });

  it("ignores reviewerId and retains flat storage in single-reviewer mode", async () => {
    const user = userEvent.setup();
    mockAvailableSubjects = [subject1];
    mockReviewers = [reviewer1];

    renderTable({ reviewerId: reviewer2.id });
    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Pass"));

    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      "sub-01_01": { status: "pass", setAt: 0 },
    });
  });

  // 12.1 — container and table structure
  it("renders container, table, filter, and bulk button", () => {
    mockAvailableSubjects = [subject1, subject2];
    mockSubjectStatuses = [statusComplete];
    mockMetadataGroups = [group1, group2];
    mockSubjectRows = [subjectRow1, subjectRow2];

    renderTable();

    expect(screen.getByTestId("qc-selection-table")).toBeTruthy();
    expect(screen.getByTestId("qc-verdict-table")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByTestId("qc-filter")).toBeTruthy();
    expect(screen.getByTestId("bulk-mark-pass")).toBeTruthy();
  });

  // 12.8 — next gate: disabled when neutral rows exist
  it("reports next not ready when neutral rows exist", async () => {
    const onNextReady = vi.fn();
    mockAvailableSubjects = [subject1];
    mockSubjectStatuses = [statusComplete];
    mockMetadataGroups = [group1];
    mockSubjectRows = [subjectRow1];

    renderTable({ onNextReady });

    await screen.findByTestId("qc-verdict-table");

    const calls = onNextReady.mock.calls as [boolean][];
    const falseCalls = calls.filter((call) => call[0] === false);
    expect(falseCalls.length).toBeGreaterThanOrEqual(1);
  });

  // 12.9 — next gate: ready when no neutral and no pending fails
  it("reports next ready when no neutral rows and no pending fails", async () => {
    const onNextReady = vi.fn();
    mockAvailableSubjects = [subject1, subject2];
    mockSubjectStatuses = [statusComplete, statusIncomplete];
    mockMetadataGroups = [group1, group2];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockVerdicts = {
      "sub-01_01": { status: "pass", setAt: 1000 },
      "sub-02_01": { status: "fail", reason: "motion", setAt: 1000 },
    };

    renderTable({ onNextReady });

    await screen.findByTestId("qc-verdict-table");

    const calls2 = onNextReady.mock.calls as [boolean][];
    const trueCalls = calls2.filter((call) => call[0] === true);
    expect(trueCalls.length).toBeGreaterThanOrEqual(1);
  });

  // 12.10 — filter chips show categories
  it("shows filter SegmentedControl with verdict categories", async () => {
    mockAvailableSubjects = [subject1, subject2, subject3, subject4];
    mockSubjectStatuses = [statusComplete, statusIncomplete];
    mockMetadataGroups = [group1, group2];
    mockSubjectRows = [
      subjectRow1,
      subjectRow2,
      { id: "sub-03/01", subject: "sub-03", session: "01", groupId: "g1" },
      { id: "sub-04/01", subject: "sub-04", session: "01", groupId: "g1" },
    ];
    mockVerdicts = {
      "sub-01_01": { status: "pass", setAt: 1000 },
    };
    const noInfo = new Set<string>(["sub-04_01"]);

    renderTable({ noInfoSubjects: noInfo });

    const filter = await screen.findByTestId("qc-filter");
    expect(filter).toBeTruthy();

    expect(within(filter).getByText("All")).toBeTruthy();
    expect(within(filter).getByText("Neutral")).toBeTruthy();
    expect(within(filter).getByText("Pass")).toBeTruthy();
    expect(within(filter).getByText("Fail")).toBeTruthy();
    expect(within(filter).getByText("No Info")).toBeTruthy();
  });

  // 12.11 — filter counts are accurate
  it("shows correct filter counts", async () => {
    mockAvailableSubjects = [subject1, subject2, subject3, subject4];
    mockSubjectStatuses = [statusComplete, statusIncomplete];
    mockMetadataGroups = [group1, group2];
    mockSubjectRows = [
      subjectRow1,
      subjectRow2,
      { id: "sub-03/01", subject: "sub-03", session: "01", groupId: "g1" },
      { id: "sub-04/01", subject: "sub-04", session: "01", groupId: "g1" },
    ];
    mockVerdicts = {
      "sub-01_01": { status: "pass", setAt: 1000 },
    };
    const noInfo = new Set<string>(["sub-04_01"]);

    renderTable({ noInfoSubjects: noInfo });

    await screen.findByTestId("qc-verdict-table");

    expect(screen.getByTestId("qc-filter-count-all").textContent).toBe("4");
    expect(screen.getByTestId("qc-filter-count-neutral").textContent).toBe("2");
    expect(screen.getByTestId("qc-filter-count-pass").textContent).toBe("1");
    expect(screen.getByTestId("qc-filter-count-fail").textContent).toBe("0");
    expect(screen.getByTestId("qc-filter-count-no-info").textContent).toBe("1");
  });

  // 12.12 — Mark all complete→Pass skips No Info
  it("Mark all complete→Pass button skips No Info subjects", async () => {
    const user = userEvent.setup();
    mockAvailableSubjects = [subject1, subject4];
    mockSubjectStatuses = [
      statusComplete,
      {
        subjectSession: "sub-01_01",
        module: "asl",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    mockMetadataGroups = [group1];
    mockSubjectRows = [
      subjectRow1,
      { id: "sub-04/01", subject: "sub-04", session: "01", groupId: "g1" },
    ];

    const noInfo = new Set<string>(["sub-04_01"]);
    renderTable({ noInfoSubjects: noInfo });

    const bulkBtn = await screen.findByTestId("bulk-mark-pass");
    await user.click(bulkBtn);

    const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
    expect(verdicts["sub-01_01"]?.status).toBe("pass");
    expect(verdicts["sub-04_01"]).toBeUndefined();
  });

  // 12.12b — Mark all complete skips incomplete modules
  it("Mark all complete→Pass skips subjects with incomplete modules", async () => {
    const user = userEvent.setup();
    mockAvailableSubjects = [subject1, subject2];
    mockSubjectStatuses = [statusComplete]; // only structural for sub-01 is complete
    // sub-02 has structural=incomplete and no ASL → not "complete"
    mockMetadataGroups = [group1, group2];
    mockSubjectRows = [subjectRow1, subjectRow2];

    renderTable();

    const bulkBtn = await screen.findByTestId("bulk-mark-pass");
    await user.click(bulkBtn);

    const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
    expect(verdicts["sub-01_01"]).toBeUndefined();
    expect(verdicts["sub-02_01"]).toBeUndefined();
  });

  // 12.12c — Mark all complete→Pass overwrites existing fail verdicts
  it("Mark all complete→Pass overwrites subjects with fail verdict", async () => {
    const user = userEvent.setup();
    mockAvailableSubjects = [subject1];
    mockSubjectStatuses = [
      statusComplete,
      {
        subjectSession: "sub-01_01",
        module: "asl",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    mockMetadataGroups = [group1];
    mockSubjectRows = [subjectRow1];
    mockVerdicts = {
      "sub-01_01": { status: "fail", reason: "motion", setAt: 1000 },
    };

    renderTable();

    const bulkBtn = await screen.findByTestId("bulk-mark-pass");
    await user.click(bulkBtn);

    const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
    expect(verdicts["sub-01_01"]?.status).toBe("pass");
  });

  it("marks completed Structural and ASL reports outdated when BIDS2Legacy lock is missing", async () => {
    mockBids2LegacyExists = false;
    mockAvailableSubjects = [subject1];
    mockSubjectStatuses = [
      statusComplete,
      {
        subjectSession: "sub-01_01",
        module: "asl",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    mockMetadataGroups = [group1];
    mockSubjectRows = [subjectRow1];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_subject_reports") {
        return Promise.resolve([
          { subjectSession: "sub-01_01", module: "structural", run: null },
          { subjectSession: "sub-01_01", module: "asl", run: null },
        ]);
      }
      return Promise.resolve([]);
    });

    renderTable();

    const outdatedReports = await screen.findAllByText("View Outdated Report");
    expect(outdatedReports).toHaveLength(2);
    expect(screen.getAllByTestId("status-outdated")).toHaveLength(2);
  });

  // 13.2c — verdict control renders with Neutral/Pass/Fail when no verdict stored
  it("renders Neutral/Pass/Fail in verdict control when row is visible", async () => {
    mockAvailableSubjects = [subject1, subject2];
    mockSubjectStatuses = [statusComplete, statusIncomplete];
    mockMetadataGroups = [group1, group2];
    mockSubjectRows = [subjectRow1, subjectRow2];
    // no stored verdict → displayedVerdict=neutral → visible under default filter "neutral"

    renderTable();
    const table = await screen.findByTestId("qc-verdict-table");
    expect(table).toBeTruthy();

    const cells = await screen.findAllByText("sub-01");
    expect(cells.length).toBeGreaterThanOrEqual(1);

    const control = screen.getByTestId("verdict-control-sub-01_01");
    expect(within(control).getByText("Neutral")).toBeTruthy();
    expect(within(control).getByText("Pass")).toBeTruthy();
    expect(within(control).getByText("Fail")).toBeTruthy();
  });

  describe("verdict setAt validation", () => {
    it("sets correct setAt from priorModulesMtimes when marking Pass", async () => {
      const user = userEvent.setup();
      mockAvailableSubjects = [subject1];
      mockSubjectStatuses = [
        statusComplete,
        {
          subjectSession: "sub-01_01",
          module: "asl",
          status: "complete",
          completedSteps: [],
          locked: false,
        },
      ];
      mockMetadataGroups = [group1];
      mockSubjectRows = [subjectRow1];

      renderTable();
      useManifestStore.setState({
        priorModulesMtimes: {
          "sub-01_01": 1700000000000,
        },
      });

      const control = await screen.findByTestId("verdict-control-sub-01_01");
      const passBtn = within(control).getByText("Pass");
      await user.click(passBtn);

      const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
      expect(verdicts["sub-01_01"]).toEqual({
        status: "pass",
        setAt: 1700000000000,
      });
    });

    it("falls back to 0 when subject session not found in priorModulesMtimes", async () => {
      const user = userEvent.setup();
      mockAvailableSubjects = [subject1];
      mockSubjectStatuses = [
        statusComplete,
        {
          subjectSession: "sub-01_01",
          module: "asl",
          status: "complete",
          completedSteps: [],
          locked: false,
        },
      ];
      mockMetadataGroups = [group1];
      mockSubjectRows = [subjectRow1];

      renderTable();
      useManifestStore.setState({
        priorModulesMtimes: {}, // Empty
      });

      const control = await screen.findByTestId("verdict-control-sub-01_01");
      const passBtn = within(control).getByText("Pass");
      await user.click(passBtn);

      const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
      expect(verdicts["sub-01_01"]).toEqual({
        status: "pass",
        setAt: 0,
      });
    });

    it("sets correct setAt from priorModulesMtimes when marking Fail with a reason", async () => {
      const user = userEvent.setup();
      mockAvailableSubjects = [subject1];
      mockSubjectStatuses = [
        statusComplete,
        {
          subjectSession: "sub-01_01",
          module: "asl",
          status: "complete",
          completedSteps: [],
          locked: false,
        },
      ];
      mockMetadataGroups = [group1];
      mockSubjectRows = [subjectRow1];

      renderTable();
      useManifestStore.setState({
        priorModulesMtimes: {
          "sub-01_01": 1700000000000,
        },
      });

      const control = await screen.findByTestId("verdict-control-sub-01_01");
      const failBtn = within(control).getByText("Fail");
      await user.click(failBtn);

      // Select a reason
      const reasonSelect = await screen.findByTestId("verdict-reason-sub-01_01");
      await user.click(reasonSelect);
      const option = await screen.findByText("Motion");
      await user.click(option);

      const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
      expect(verdicts["sub-01_01"]).toEqual({
        status: "fail",
        reason: "motion",
        setAt: 1700000000000,
      });
    });

    it("sets correct mtimes for each subject respectively during bulk Pass", async () => {
      const user = userEvent.setup();
      const customSubject2: SubjectInfo = {
        subjectSession: "sub-02_01",
        subject: "sub-02",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      };
      mockAvailableSubjects = [subject1, customSubject2];
      mockSubjectStatuses = [
        statusComplete,
        {
          subjectSession: "sub-01_01",
          module: "asl",
          status: "complete",
          completedSteps: [],
          locked: false,
        },
        {
          subjectSession: "sub-02_01",
          module: "structural",
          status: "complete",
          completedSteps: [],
          locked: false,
        },
        {
          subjectSession: "sub-02_01",
          module: "asl",
          status: "complete",
          completedSteps: [],
          locked: false,
        },
      ];
      mockMetadataGroups = [group1];
      mockSubjectRows = [subjectRow1, subjectRow2];

      renderTable();
      useManifestStore.setState({
        priorModulesMtimes: {
          "sub-01_01": 1700000000000,
          "sub-02_01": 1700000060000,
        },
      });

      const bulkBtn = await screen.findByTestId("bulk-mark-pass");
      await user.click(bulkBtn);

      const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
      expect(verdicts["sub-01_01"]).toEqual({
        status: "pass",
        setAt: 1700000000000,
      });
      expect(verdicts["sub-02_01"]).toEqual({
        status: "pass",
        setAt: 1700000060000,
      });
    });

    it("renders the Add Reviewer button in the header to the left of Mark all complete Pass button", async () => {
      renderTable();
      const addReviewerBtn = screen.getByTestId("add-reviewer");
      const bulkBtn = screen.getByTestId("bulk-mark-pass");
      expect(addReviewerBtn).toBeInTheDocument();
      expect(bulkBtn).toBeInTheDocument();
      expect(
        addReviewerBtn.compareDocumentPosition(bulkBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});

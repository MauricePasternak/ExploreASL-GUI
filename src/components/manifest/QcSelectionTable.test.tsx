import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

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
let mockMetadataGroups: MetadataGroup[] = [];
let mockSubjectRows: SubjectRow[] = [];

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
        verdicts: mockVerdicts,
      },
    },
    dataPar: {},
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTable(
  props: { noInfoSubjects?: Set<string>; onNextReady?: (ready: boolean) => void } = {},
) {
  useProcessingStore.setState({
    availableSubjects: mockAvailableSubjects,
    subjectStatuses: mockSubjectStatuses,
  });
  useProjectStore.setState({
    project: buildProjectState() as any,
    loaded: true,
  });
  useManifestStore.setState({
    staleVerdicts: new Set(),
    step: 0,
    filter: "all",
  });
  return render(
    <MantineProvider>
      <QcSelectionTable
        noInfoSubjects={props.noInfoSubjects ?? new Set()}
        onNextReady={props.onNextReady}
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
  mockMetadataGroups = [];
  mockSubjectRows = [];
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });
  useManifestStore.setState({ staleVerdicts: new Set(), step: 0, filter: "all" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QcSelectionTable", () => {
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
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

import { useState } from "react";
import QcSelectionTable, { type QcSelectionDrafts } from "./QcSelectionTable";
import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import type { ManifestVerdict } from "../../schemas/project";
import type { MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { useProjectStore } from "../../stores/projectStore";
import { useManifestStore } from "../../stores/manifestStore";
import { useProcessingStore } from "../../stores/processingStore";
import { projectFixture } from "../../test/projectFixtures";
import { projectView } from "../../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";

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

const emptyQc = { coverage: null, spatialCov: null, motion: [], motionExclusionPct: null };

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
let mockStaleVerdicts: Record<string, Set<string>> = {};
let editReply = projectFixture();
let mockMetadataGroups: MetadataGroup[] = [];
let mockSubjectRows: SubjectRow[] = [];
let mockBids2LegacyExists = true;

function buildProjectState() {
  const reviewers = mockReviewers ?? projectFixture().document.uiState.manifest.reviewers;
  return projectView(
    projectFixture("project-1", "Brain Study", "/test/project", {
      mappingState: {
        metadataGroups: mockMetadataGroups,
        subjectRows: mockSubjectRows,
      },
      uiState: {
        processing: {
          population: {
            lastRun: {
              profileId: "profile",
              Mtime: null,
            },
          },
        },
        manifest: {
          reviewers,
          activeReviewerId: mockActiveReviewerId ?? reviewers[0].id,
          verdicts: mockNestedVerdicts ?? { [reviewers[0].id]: mockVerdicts },
          resolvedVerdicts: {},
        },
      },
      dataPar: {},
    }),
  );
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function TableHarness({ reviewerId }: { reviewerId?: string }) {
  const draftState = useState<QcSelectionDrafts>(() => ({
    pendingFails: new Map(),
    notes: new Map(),
  }));
  return (
    <>
      <QcSelectionTable reviewerId={reviewerId} draftState={draftState} />
      <output data-testid="pending-qc-fails">
        {Array.from(draftState[0].pendingFails.values()).reduce(
          (count, slice) => count + slice.size,
          0,
        )}
      </output>
      <output data-testid="pending-qc-notes">
        {Array.from(draftState[0].notes.values()).reduce((count, slice) => count + slice.size, 0)}
      </output>
    </>
  );
}

function renderTable(props: { reviewerId?: string } = {}) {
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
  activateProjectLease("project-1", "/test/project");
  const originalInvoke = vi.mocked(invoke).getMockImplementation();
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === "accept_project_edit"
      ? Promise.resolve(editReply)
      : (originalInvoke?.(command, args) ?? Promise.resolve([])),
  );
  useManifestStore.setState({
    staleVerdicts: mockStaleVerdicts,
    step: 0,
    filter: "all",
  });
  return render(
    <MantineProvider env="test">
      <TableHarness reviewerId={props.reviewerId} />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  editReply = projectFixture("project-1", "Brain Study", "/test/project");
  vi.clearAllMocks();
  vi.mocked(invoke).mockReset();
  mockAvailableSubjects = [];
  mockSubjectStatuses = [];
  mockVerdicts = {};
  mockNestedVerdicts = undefined;
  mockReviewers = undefined;
  mockActiveReviewerId = undefined;
  mockStaleVerdicts = {};
  mockMetadataGroups = [];
  mockSubjectRows = [];
  mockBids2LegacyExists = true;
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });
  useManifestStore.getState().resetManifest();
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
    editReply.document.uiState.manifest.reviewers = [reviewer1, reviewer2];
    editReply.document.uiState.manifest.activeReviewerId = reviewer2.id;
    editReply.document.uiState.manifest.verdicts = {
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };

    renderTable({ reviewerId: reviewer1.id });
    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Pass"));
    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    });

    editReply = structuredClone(editReply);
    editReply.document.uiState.manifest.verdicts[reviewer1.id] = {};
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
      <MantineProvider env="test">
        <TableHarness reviewerId={reviewer2.id} />
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
    expect(screen.getByTestId("pending-qc-fails")).toHaveTextContent("1");

    view.rerender(
      <MantineProvider env="test">
        <TableHarness reviewerId={reviewer2.id} />
      </MantineProvider>,
    );

    expect(screen.queryByTestId("verdict-reason-sub-01_01")).not.toBeInTheDocument();
    expect(screen.getByTestId("pending-qc-fails")).toHaveTextContent("1");
  });

  it("uses the active store reviewer when reviewerId is omitted", async () => {
    const user = userEvent.setup();
    setupMultiReviewerVerdicts();
    mockActiveReviewerId = reviewer2.id;
    mockNestedVerdicts = { [reviewer1.id]: {}, [reviewer2.id]: {} };
    editReply.document.uiState.manifest.reviewers = [reviewer1, reviewer2];
    editReply.document.uiState.manifest.activeReviewerId = reviewer2.id;
    editReply.document.uiState.manifest.verdicts = {
      [reviewer1.id]: {},
      [reviewer2.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
    };

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
    editReply.document.uiState.manifest.reviewers = [reviewer1, reviewer2];
    editReply.document.uiState.manifest.activeReviewerId = reviewer2.id;
    editReply.document.uiState.manifest.verdicts = {
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
      [reviewer2.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };

    useManifestStore.setState({ qcLoaded: true, qcData: { "sub-01_01": emptyQc } });
    renderTable({ reviewerId: reviewer1.id });
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

  it("uses the registered indexed slice in single-reviewer mode", async () => {
    const user = userEvent.setup();
    mockAvailableSubjects = [subject1];
    mockReviewers = [reviewer1];
    editReply.document.uiState.manifest.verdicts = {
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
    };

    renderTable({ reviewerId: reviewer1.id });
    await user.click(within(screen.getByTestId("verdict-control-sub-01_01")).getByText("Pass"));

    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
    });
  });

  it.each(["newer draft", "expired lease"])(
    "retains notes after an ACK with %s",
    async (change) => {
      mockAvailableSubjects = [subject1];
      mockVerdicts = { "sub-01_01": { status: "pass", setAt: 1 } };
      renderTable();
      let acknowledge!: () => void;
      const submit = vi.spyOn(useProjectStore.getState(), "setManifestVerdict").mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            acknowledge = resolve;
          }),
      );
      const notes = screen.getByTestId("verdict-notes-sub-01_01");
      fireEvent.change(notes, { target: { value: "submitted" } });
      fireEvent.blur(notes);
      if (change === "newer draft") fireEvent.change(notes, { target: { value: "newer" } });
      else activateProjectLease("project-1", "/test/project");
      await act(async () => acknowledge());
      expect(notes).toHaveValue(change === "newer draft" ? "newer" : "submitted");
      expect(screen.getByTestId("pending-qc-notes")).toHaveTextContent("1");
      submit.mockRestore();
    },
  );

  it("counts notes by Unicode characters and clears only the acknowledged controlled draft", async () => {
    mockAvailableSubjects = [subject1];
    mockVerdicts = { "sub-01_01": { status: "pass", setAt: 1 } };
    renderTable();
    const submit = vi.spyOn(useProjectStore.getState(), "setManifestVerdict").mockResolvedValue();
    const notes = screen.getByTestId("verdict-notes-sub-01_01");
    fireEvent.change(notes, { target: { value: "🧠".repeat(501) } });
    fireEvent.blur(notes);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("Maximum 500 Unicode characters")).toBeInTheDocument();
    fireEvent.change(notes, { target: { value: "🧠".repeat(500) } });
    fireEvent.blur(notes);
    await waitFor(() => expect(screen.getByTestId("pending-qc-notes")).toHaveTextContent("0"));
    expect(submit).toHaveBeenCalledWith(
      "sub-01_01",
      "pass",
      { reason: undefined, notes: "🧠".repeat(500) },
      reviewer1.id,
    );
    submit.mockRestore();
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
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("row", { name: /01 Session 01/ })).toHaveTextContent("Global Defaults");
    expect(screen.getByRole("row", { name: /02 Session 01/ })).toHaveTextContent("Encoding Group");
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.getByRole("columnheader", { name: "Reviewer verdict" })).toBeInTheDocument();
    expect(screen.getByTestId("qc-search-tools")).toContainElement(
      screen.getByTestId("bulk-mark-pass"),
    );
  });

  it("opens QC metrics from the subject cell without changing a verdict", async () => {
    const user = userEvent.setup();
    mockAvailableSubjects = [subject1];
    renderTable();

    await user.click(screen.getByTestId("view-qc-metrics-sub-01_01"));
    expect(await screen.findByTestId("qc-metrics-sub-01_01")).toHaveTextContent("Coverage");
    expect(screen.getByTestId("qc-metrics-sub-01_01")).toHaveTextContent("Unavailable");
    expect(useProjectStore.getState().project?.uiState.manifest.verdicts[reviewer1.id]).toEqual({});
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
    useManifestStore.setState({
      qcLoaded: true,
      qcData: { "sub-01_01": emptyQc, "sub-02_01": emptyQc, "sub-03_01": emptyQc },
    });
    renderTable();

    const filter = await screen.findByTestId("qc-filter");
    expect(filter).toBeTruthy();

    for (const label of ["All", "Neutral", "Pass", "Fail", "No Info", "Stale"]) {
      expect(within(filter).getByRole("radio", { name: new RegExp(label) })).toBeTruthy();
    }
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
    useManifestStore.setState({
      qcLoaded: true,
      qcData: { "sub-01_01": emptyQc, "sub-02_01": emptyQc, "sub-03_01": emptyQc },
    });
    renderTable();

    await screen.findByTestId("qc-verdict-table");

    expect(screen.getByTestId("qc-filter-count-all").textContent).toBe("4");
    expect(screen.getByTestId("qc-filter-count-neutral").textContent).toBe("2");
    expect(screen.getByTestId("qc-filter-count-pass").textContent).toBe("1");
    expect(screen.getByTestId("qc-filter-count-fail").textContent).toBe("0");
    expect(screen.getByTestId("qc-filter-count-no-info").textContent).toBe("1");
  });

  // 12.12 — Mark all complete→Pass skips No Info

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
    expect(verdicts[reviewer1.id]["sub-01_01"]).toBeUndefined();
    expect(verdicts[reviewer1.id]["sub-02_01"]).toBeUndefined();
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
    editReply.document.uiState.manifest.verdicts = {
      [reviewer1.id]: { "sub-01_01": { status: "pass", setAt: 0 } },
    };

    renderTable();

    const bulkBtn = await screen.findByTestId("bulk-mark-pass");
    await user.click(bulkBtn);

    const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
    expect(verdicts[reviewer1.id]["sub-01_01"]?.status).toBe("pass");
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

    const cells = await screen.findAllByText("01");
    expect(cells.length).toBeGreaterThanOrEqual(1);

    const control = screen.getByTestId("verdict-control-sub-01_01");
    expect(within(control).getByText("Neutral")).toBeTruthy();
    expect(within(control).getByText("Pass")).toBeTruthy();
    expect(within(control).getByText("Fail")).toBeTruthy();
  });

  describe("verdict setAt validation", () => {
    it("writes indexed Fail only after a controlled reason and displays the accepted timestamp", async () => {
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

      editReply.document.uiState.manifest.verdicts = {
        [reviewer1.id]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1700000000000 } },
      };
      renderTable();

      const control = await screen.findByTestId("verdict-control-sub-01_01");
      const failBtn = within(control).getByText("Fail");
      await user.click(failBtn);
      expect(useProjectStore.getState().project?.uiState.manifest.verdicts[reviewer1.id]).toEqual(
        {},
      );

      // Select a reason
      const reasonSelect = await screen.findByTestId("verdict-reason-sub-01_01");
      await user.click(reasonSelect);
      const option = await screen.findByText("Motion");
      await user.click(option);

      const verdicts = useProjectStore.getState().project?.uiState?.manifest?.verdicts ?? {};
      expect(verdicts[reviewer1.id]["sub-01_01"]).toEqual({
        status: "fail",
        reason: "motion",
        setAt: 1700000000000,
      });
    });
  });
});

import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processingSnapshot } from "../../test/processingFixtures";
import type { ProcessingRunSnapshot } from "../../schemas/processingSchemas";

let mockConfig: Record<string, unknown> | null = {
  subjects: ["sub-001_01", "sub-002_01"],
  modules: ["structural", "asl"],
};
let mockSnapshot: ProcessingRunSnapshot | null = null;
let mockSubjectStatuses: Array<{
  subjectSession: string;
  module: string;
  run?: string;
  status: string;
  completedSteps: string[];
  locked: boolean;
}> = [];
let mockAvailableSubjects = [
  {
    subjectSession: "sub-001_01",
    subject: "001",
    session: "01",
    hasStructural: true,
    hasASL: true,
  },
  {
    subjectSession: "sub-002_01",
    subject: "002",
    session: "01",
    hasStructural: true,
    hasASL: true,
  },
];

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      subjectStatuses: mockSubjectStatuses,
      availableSubjects: mockAvailableSubjects,
      processingPhase: "running",
      activeRunId: "run-1",
      snapshot: mockSnapshot,
    }),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: {
        projectMeta: { rootPath: "/test/project" },
        uiState: { processing: { config: mockConfig } },
      },
    }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

const { default: ExecutionDashboard } = await import("./ExecutionDashboard");

function renderDashboard() {
  if (!mockSnapshot && mockConfig) {
    mockSnapshot = processingSnapshot({
      runId: "run-1",
      lifecycle: "running",
      selectedModules: mockConfig.modules as ProcessingRunSnapshot["selectedModules"],
      selectedSubjectSessions: mockConfig.subjects as string[],
      expectedTargets: mockSubjectStatuses.map((status) => ({
        module: status.module as ProcessingRunSnapshot["selectedModules"][number],
        subjectSession: status.subjectSession || null,
        run: status.run ?? null,
        complete: status.status === "complete",
      })),
    });
  }
  return render(
    <MantineProvider env="test">
      <ExecutionDashboard />
    </MantineProvider>,
  );
}

describe("ExecutionDashboard component", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      subjects: ["sub-001_01", "sub-002_01"],
      modules: ["structural", "asl"],
    };
    mockSnapshot = null;
    mockSubjectStatuses = [];
    mockAvailableSubjects = [
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: true,
        hasASL: true,
      },
      {
        subjectSession: "sub-002_01",
        subject: "002",
        session: "01",
        hasStructural: true,
        hasASL: true,
      },
    ];
  });

  it("renders empty state when no config", () => {
    mockConfig = null;
    renderDashboard();
    expect(screen.getByTestId("execution-dashboard-empty")).toBeInTheDocument();
  });

  it("renders empty state when no modules selected", () => {
    mockConfig = { subjects: [], modules: [] };
    renderDashboard();
    expect(screen.getByTestId("execution-dashboard-empty")).toBeInTheDocument();
  });

  it("renders execution dashboard with accordion modules", () => {
    renderDashboard();
    expect(screen.getByTestId("execution-dashboard")).toBeInTheDocument();
    expect(screen.getByText("Structural")).toBeInTheDocument();
    expect(screen.getByText("ASL")).toBeInTheDocument();
  });

  it("renders step timeline for complete subject", () => {
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["060_Segment_T1w", "070_SkullStrip_T1w"],
        locked: false,
      },
    ];
    renderDashboard();
    const timelines = screen.getAllByTestId("step-timeline");
    expect(timelines.length).toBeGreaterThan(0);
  });

  it("renders running badge for locked subjects", () => {
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "incomplete",
        completedSteps: ["060_Segment_T1w"],
        locked: true,
      },
    ];
    renderDashboard();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("renders Done badge for complete subjects", () => {
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["060_Segment_T1w"],
        locked: false,
      },
    ];
    renderDashboard();
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  });

  it("shows Done badge and no Running badge when status is complete but locked is true", () => {
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["060_Segment_T1w", "070_SkullStrip_T1w"],
        locked: true,
      },
    ];
    renderDashboard();
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("renders population section as single row when population module enabled", () => {
    mockConfig = {
      subjects: ["sub-001_01"],
      modules: ["population"],
    };
    mockSubjectStatuses = [
      {
        subjectSession: "",
        module: "population",
        status: "complete",
        completedSteps: ["GroupStats"],
        locked: false,
      },
    ];
    renderDashboard();
    expect(screen.getByTestId("population-status-section")).toBeInTheDocument();
    expect(screen.getByText("Population (group)")).toBeInTheDocument();
  });

  it("shows no-subjects message when no eligible subjects for module", () => {
    mockAvailableSubjects = [
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: false,
        hasASL: true,
      },
    ];
    mockConfig = {
      subjects: ["sub-001_01"],
      modules: ["structural"],
    };
    renderDashboard();
    expect(screen.getByTestId("no-subjects-msg")).toBeInTheDocument();
  });

  it("renders subjects in alphanumeric order", () => {
    mockAvailableSubjects = [
      {
        subjectSession: "sub-001Philips_11",
        subject: "001Philips",
        session: "11",
        hasStructural: true,
        hasASL: true,
      },
      {
        subjectSession: "sub-001Philips_01",
        subject: "001Philips",
        session: "01",
        hasStructural: true,
        hasASL: true,
      },
      {
        subjectSession: "sub-001Philips_02",
        subject: "001Philips",
        session: "02",
        hasStructural: true,
        hasASL: true,
      },
      {
        subjectSession: "sub-002Siemens_01",
        subject: "002Siemens",
        session: "01",
        hasStructural: true,
        hasASL: true,
      },
    ];
    mockConfig = {
      subjects: [
        "sub-001Philips_11",
        "sub-001Philips_01",
        "sub-001Philips_02",
        "sub-002Siemens_01",
      ],
      modules: ["structural"],
    };
    renderDashboard();
    const section = screen.getByTestId("structural-section");
    const rows = within(section).getAllByTestId("subject-row");
    expect(rows).toHaveLength(4);
    const labels = rows.map((r) => within(r).getByText(/sub-/).textContent);
    expect(labels).toEqual([
      "sub-001Philips_01",
      "sub-001Philips_02",
      "sub-001Philips_11",
      "sub-002Siemens_01",
    ]);
  });

  it("renders module header with progress badge", () => {
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    renderDashboard();
    const headers = screen.getAllByTestId("module-header");
    expect(headers.length).toBeGreaterThan(0);
    // Badge should show 1/2 (one of two subjects complete)
    expect(within(headers[0]).getByText("1 / 2 complete")).toBeInTheDocument();
  });

  it("shows pending steps without Done or Running badges when statuses are empty", () => {
    mockSubjectStatuses = [];
    renderDashboard();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.getAllByText("Pending")).toHaveLength(4);
    const section = screen.getByTestId("structural-section");
    const rows = within(section).getAllByTestId("subject-row");
    expect(rows).toHaveLength(2);
    expect(within(section).getAllByTestId("step-pending")).toHaveLength(20);
  });

  it("renders collapsible nested rows for ASL subjects with multiple runs", async () => {
    mockAvailableSubjects = [
      {
        subjectSession: "sub-001_01",
        subject: "001",
        session: "01",
        hasStructural: false,
        hasASL: true,
        aslRuns: ["1", "2"],
      },
    ];
    mockConfig = {
      subjects: ["sub-001_01"],
      modules: ["asl"],
    };
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "1",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "2",
        status: "incomplete",
        completedSteps: [],
        locked: true,
      },
    ];

    renderDashboard();

    const aslSection = screen.getByTestId("asl-section");

    // Parent row should be rendered
    const parentRows = within(aslSection).getAllByTestId("subject-row");
    expect(parentRows).toHaveLength(1);

    // Verify parent row displays "2 runs" badge and "1 of 2 runs complete" text
    expect(within(parentRows[0]).getByTestId("runs-summary-text")).toHaveTextContent(
      "1 of 2 runs complete",
    );

    // Run lanes open by default; toggle remains keyboard-accessible.
    expect(within(aslSection).getAllByTestId("run-sub-row")).toHaveLength(2);
    const user = userEvent.setup();
    await user.click(within(parentRows[0]).getByTestId("expand-toggle"));
    expect(within(parentRows[0]).getByTestId("expand-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(within(parentRows[0]).getByTestId("expand-toggle"));

    // Sub-rows should now be rendered (e.g. Run 1 and Run 2)
    const runRows = within(aslSection).getAllByTestId("run-sub-row");
    expect(runRows).toHaveLength(2);
    expect(within(runRows[0]).getByText("Run 01")).toBeInTheDocument();
    expect(within(runRows[1]).getByText("Run 02")).toBeInTheDocument();

    // The header progress badge should count complete subjects (0/1 complete)
    // because sub-001_01 is not fully complete (run 2 is incomplete)
    const headers = screen.getAllByTestId("module-header");
    expect(within(headers[0]).getByText("0 / 1 complete")).toBeInTheDocument();
  });

  it("keeps attached modules and subjects when next-run configuration changes", () => {
    mockSnapshot = processingSnapshot({
      runId: "run-1",
      lifecycle: "running",
      selectedModules: ["structural"],
      selectedSubjectSessions: ["sub-001_01"],
    });
    mockConfig = { subjects: ["sub-002_01"], modules: ["asl"] };
    renderDashboard();
    expect(screen.getByTestId("structural-section")).toHaveTextContent("sub-001_01");
    expect(screen.queryByTestId("execution-module-asl")).not.toBeInTheDocument();
  });
});

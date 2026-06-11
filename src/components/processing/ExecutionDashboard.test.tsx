import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockConfig: Record<string, unknown> | null = {
  subjects: ["sub-001_01", "sub-002_01"],
  modules: ["structural", "asl"],
};
let mockSubjectStatuses: Array<{
  subjectSession: string;
  module: string;
  run?: string;
  status: string;
  completedSteps: string[];
  locked: boolean;
}> = [];
let mockAvailableSubjects = [
  { subjectSession: "sub-001_01", subject: "001", session: "01", hasStructural: true, hasASL: true },
  { subjectSession: "sub-002_01", subject: "002", session: "01", hasStructural: true, hasASL: true },
];

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      config: mockConfig,
      subjectStatuses: mockSubjectStatuses,
      availableSubjects: mockAvailableSubjects,
    }),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

const { default: ExecutionDashboard } = await import("./ExecutionDashboard");

function renderDashboard() {
  return render(
    <MantineProvider>
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
    mockSubjectStatuses = [];
    mockAvailableSubjects = [
      { subjectSession: "sub-001_01", subject: "001", session: "01", hasStructural: true, hasASL: true },
      { subjectSession: "sub-002_01", subject: "002", session: "01", hasStructural: true, hasASL: true },
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

  it("renders subject rows for structural module", () => {
    renderDashboard();
    const structSection = screen.getByTestId("structural-section");
    const rows = within(structSection).getAllByTestId("subject-row");
    expect(rows).toHaveLength(2);
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
    expect(screen.getByTestId("population-section")).toBeInTheDocument();
    expect(screen.getByText("Population (group)")).toBeInTheDocument();
  });

  it("shows no-subjects message when no eligible subjects for module", () => {
    mockAvailableSubjects = [
      { subjectSession: "sub-001_01", subject: "001", session: "01", hasStructural: false, hasASL: true },
    ];
    mockConfig = {
      subjects: ["sub-001_01"],
      modules: ["structural"],
    };
    renderDashboard();
    expect(screen.getByTestId("no-subjects-msg")).toBeInTheDocument();
  });

  it("renders clean subject button on each row", () => {
    renderDashboard();
    const cleanButtons = screen.getAllByTestId("clean-subject-btn");
    expect(cleanButtons.length).toBeGreaterThan(0);
  });

  it("shows confirmation dialog when clean button clicked", async () => {
    const user = userEvent.setup();
    renderDashboard();
    const cleanButtons = screen.getAllByTestId("clean-subject-btn");
    await user.click(cleanButtons[0]);
    const modals = screen.getAllByTestId("clean-confirm-modal");
    expect(modals.length).toBeGreaterThan(0);
    expect(screen.getByText(/Delete all output files/)).toBeInTheDocument();
  });

  it("closes confirmation dialog when cancel clicked", async () => {
    const user = userEvent.setup();
    renderDashboard();
    const cleanButtons = screen.getAllByTestId("clean-subject-btn");
    await user.click(cleanButtons[0]);
    // Confirm dialog is open
    expect(screen.getByText(/Delete all output files/)).toBeInTheDocument();
    const cancelBtns = screen.getAllByTestId("clean-cancel-btn");
    await user.click(cancelBtns[0]);
    // invoke should not have been called (no actual clean happened)
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).not.toHaveBeenCalledWith("clean_subject_output", expect.anything());
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
    expect(within(headers[0]).getByText("1/2")).toBeInTheDocument();
  });
});

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPath } from "@tauri-apps/plugin-opener";

const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

let mockPhase = "completed";
let mockSubjectStatuses: Array<{
  subjectSession: string;
  module: string;
  run?: string;
  status: string;
  completedSteps: string[];
  locked: boolean;
}> = [];
let mockConfig: { subjects: string[] } | null = { subjects: ["sub-01", "sub-02"] };

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      processingPhase: mockPhase,
      subjectStatuses: mockSubjectStatuses,
      config: mockConfig,
    }),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

const { default: ResultsSummary } = await import("./ResultsSummary");

function renderSummary() {
  return render(
    <MantineProvider>
      <ResultsSummary />
    </MantineProvider>,
  );
}

function getSummary() {
  return screen.getByTestId("results-summary");
}

describe("ResultsSummary", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "completed";
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-02", module: "structural", status: "complete", completedSteps: [], locked: false },
    ];
    mockConfig = { subjects: ["sub-01", "sub-02"] };
  });

  it("renders nothing when phase is idle", () => {
    mockPhase = "idle";
    renderSummary();
    expect(screen.queryByTestId("results-summary")).not.toBeInTheDocument();
  });

  it("renders nothing when phase is running", () => {
    mockPhase = "running";
    renderSummary();
    expect(screen.queryByTestId("results-summary")).not.toBeInTheDocument();
  });

  it("shows success count for completed subjects", () => {
    renderSummary();
    const succeeded = within(getSummary()).getByTestId("results-succeeded");
    expect(succeeded).toHaveTextContent("2");
  });

  it("shows zero failed when all succeed", () => {
    renderSummary();
    const failed = within(getSummary()).getByTestId("results-failed");
    expect(failed).toHaveTextContent("0");
  });

  it("shows zero skipped when all complete", () => {
    renderSummary();
    const skipped = within(getSummary()).getByTestId("results-skipped");
    expect(skipped).toHaveTextContent("0");
  });

  it("counts failed subjects (status incomplete without locked)", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-02", module: "structural", status: "incomplete", completedSteps: ["Step1"], locked: false },
    ];
    renderSummary();
    const summary = getSummary();
    expect(within(summary).getByTestId("results-succeeded")).toHaveTextContent("1");
    expect(within(summary).getByTestId("results-failed")).toHaveTextContent("1");
  });

  it("counts pending subjects as skipped", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-02", module: "structural", status: "pending", completedSteps: [], locked: false },
    ];
    renderSummary();
    const summary = getSummary();
    expect(within(summary).getByTestId("results-succeeded")).toHaveTextContent("1");
    expect(within(summary).getByTestId("results-skipped")).toHaveTextContent("1");
  });

  it("shows cancelled phase label", () => {
    mockPhase = "cancelled";
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
    ];
    renderSummary();
    expect(within(getSummary()).getByTestId("results-phase-label")).toHaveTextContent(/cancelled/i);
  });

  it("shows failed phase label", () => {
    mockPhase = "failed";
    renderSummary();
    expect(within(getSummary()).getByTestId("results-phase-label")).toHaveTextContent(/failed/i);
  });

  it("shows completed phase label", () => {
    renderSummary();
    expect(within(getSummary()).getByTestId("results-phase-label")).toHaveTextContent(/completed/i);
  });

  it("renders open output directory button", () => {
    renderSummary();
    expect(within(getSummary()).getByTestId("open-output-dir-btn")).toBeInTheDocument();
  });

  it("calls open with output directory when button clicked", async () => {
    const user = userEvent.setup();
    renderSummary();
    const btn = within(getSummary()).getByRole("button", { name: /open output directory/i });
    await user.click(btn);
    expect(openPath).toHaveBeenCalledWith("/test/project/derivatives/ExploreASL");
  });

  it("does not show failed details accordion when no failures", () => {
    renderSummary();
    expect(within(getSummary()).queryByText("Failed Subjects")).not.toBeInTheDocument();
  });

  it("shows failed details accordion when there are failures", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-02", module: "structural", status: "incomplete", completedSteps: ["Step1"], locked: false },
    ];
    renderSummary();
    expect(within(getSummary()).getByText("Failed Subjects")).toBeInTheDocument();
  });

  it("shows failed subject name in accordion", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-02", module: "structural", status: "incomplete", completedSteps: ["Step1"], locked: false },
    ];
    renderSummary();
    expect(within(getSummary()).getByText("sub-02")).toBeInTheDocument();
  });

  it("has data-testid on summary container", () => {
    renderSummary();
    expect(screen.getByTestId("results-summary")).toBeInTheDocument();
  });

  // C2: classifySubjects must not drop per-module statuses when same subject
  // has multiple modules
  it("considers subject failed when any module fails (multi-module)", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: ["ImportModule"], locked: false },
      { subjectSession: "sub-01", module: "asl", status: "incomplete", completedSteps: ["AslModule_Step1"], locked: false },
    ];
    mockConfig = { subjects: ["sub-01"] };
    renderSummary();
    const summary = getSummary();
    expect(within(summary).getByTestId("results-succeeded")).toHaveTextContent("0");
    expect(within(summary).getByTestId("results-failed")).toHaveTextContent("1");
  });

  // C2: Same subject with structural=complete, asl=complete should count as succeeded
  it("considers subject succeeded when all modules complete (multi-module)", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-01", module: "asl", status: "complete", completedSteps: [], locked: false },
    ];
    mockConfig = { subjects: ["sub-01"] };
    renderSummary();
    const summary = getSummary();
    expect(within(summary).getByTestId("results-succeeded")).toHaveTextContent("1");
    expect(within(summary).getByTestId("results-failed")).toHaveTextContent("0");
  });

  // C1: Failed subject detail must show module name and last completed step
  it("shows module and last completed step for failed subject", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-01", module: "asl", status: "incomplete", completedSteps: ["AslModule_Step1", "AslModule_Step2"], locked: false },
    ];
    mockConfig = { subjects: ["sub-01"] };
    renderSummary();
    const summary = getSummary();
    expect(within(summary).getByText("Failed Subjects")).toBeInTheDocument();
    // Should show subject name
    expect(within(summary).getByText("sub-01")).toBeInTheDocument();
    // Should show module name
    expect(within(summary).getByText(/asl/)).toBeInTheDocument();
    // Should show last completed step
    expect(within(summary).getByText(/AslModule_Step2/)).toBeInTheDocument();
  });

  // C1: Failed subject with multiple failed modules shows all
  it("shows all failed modules for a subject with multiple failures", () => {
    mockSubjectStatuses = [
      { subjectSession: "sub-01", module: "structural", status: "incomplete", completedSteps: ["StructuralStep1"], locked: false },
      { subjectSession: "sub-01", module: "asl", status: "incomplete", completedSteps: ["AslStep1", "AslStep2"], locked: false },
    ];
    mockConfig = { subjects: ["sub-01"] };
    renderSummary();
    const summary = getSummary();
    // Both modules should appear
    expect(within(summary).getByText(/structural/)).toBeInTheDocument();
    expect(within(summary).getByText(/asl/)).toBeInTheDocument();
    // Last completed steps for each
    expect(within(summary).getByText(/StructuralStep1/)).toBeInTheDocument();
    expect(within(summary).getByText(/AslStep2/)).toBeInTheDocument();
  });

  it("catches and logs error when openPath rejects", async () => {
    const error = new Error("Directory not found");
    (openPath as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);
    const user = userEvent.setup();
    renderSummary();
    const btn = within(getSummary()).getByRole("button", { name: /open output directory/i });
    await user.click(btn);
    expect(openPath).toHaveBeenCalledWith("/test/project/derivatives/ExploreASL");
    // Should have logged the error without throwing
    expect(mockConsoleError).toHaveBeenCalledWith("Failed to open output directory:", error);
  });

  it("does not throw unhandled rejection when openPath fails", async () => {
    (openPath as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    renderSummary();
    const btn = within(getSummary()).getByRole("button", { name: /open output directory/i });
    // This should NOT throw — the error is caught
    await user.click(btn);
    // Component still rendered (no crash)
    expect(screen.getByTestId("results-summary")).toBeInTheDocument();
  });
});

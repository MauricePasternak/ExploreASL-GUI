import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPhase = "running";
const mockSubjectStatuses = [
  { subjectSession: "sub-001_01", module: "structural", status: "complete", completedSteps: [], locked: false },
  { subjectSession: "sub-002_01", module: "structural", status: "pending", completedSteps: [], locked: false },
];

const mockState = () => ({
  processingPhase: mockPhase,
  subjectStatuses: mockSubjectStatuses,
});

vi.mock("../../stores/processingStore", () => {
  const storeFn = (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mockState());
  storeFn.getState = () => mockState();
  return { useProcessingStore: storeFn };
});

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { id: "test-proj", rootPath: "/test" } },
    }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "test-proj" }),
}));

const { default: ProcessingStatusBar } = await import("./ProcessingStatusBar");

function renderBar() {
  return render(
    <MantineProvider>
      <ProcessingStatusBar />
    </MantineProvider>,
  );
}

describe("ProcessingStatusBar", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "running";
  });

  it("renders with Running label when phase is running", () => {
    mockPhase = "running";
    renderBar();
    expect(screen.getByTestId("processing-status-bar")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders with Completed label when phase is completed", () => {
    mockPhase = "completed";
    renderBar();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("renders with Failed label when phase is failed", () => {
    mockPhase = "failed";
    renderBar();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders with Cancelled label when phase is cancelled", () => {
    mockPhase = "cancelled";
    renderBar();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("returns null when phase is idle", () => {
    mockPhase = "idle";
    renderBar();
    expect(screen.queryByTestId("processing-status-bar")).not.toBeInTheDocument();
  });

  it("shows per-module progress counts", () => {
    mockPhase = "running";
    renderBar();
    // Default mock has 2 sessions with only structural: 1 complete, 1 pending
    expect(screen.getByText(/Structural 1\/2/)).toBeInTheDocument();
  });

  it("shows per-module breakdown for multi-module statuses (regression: 8/16 bug)", () => {
    // 2 sessions × 2 modules = 4 entries; structural all complete, ASL all incomplete
    const multiModuleStatuses = [
      { subjectSession: "sub-001_01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-001_01", module: "asl", status: "incomplete", completedSteps: [], locked: false },
      { subjectSession: "sub-002_01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-002_01", module: "asl", status: "incomplete", completedSteps: [], locked: false },
    ];
    mockSubjectStatuses.splice(0, mockSubjectStatuses.length, ...multiModuleStatuses);
    mockPhase = "failed";
    renderBar();
    // Should show per-module: "Structural 2/2 · ASL 0/2"
    expect(screen.getByText(/Structural 2\/2/)).toBeInTheDocument();
    expect(screen.getByText(/ASL 0\/2/)).toBeInTheDocument();
    // Restore
    mockSubjectStatuses.splice(
      0,
      mockSubjectStatuses.length,
      { subjectSession: "sub-001_01", module: "structural", status: "complete", completedSteps: [], locked: false },
      { subjectSession: "sub-002_01", module: "structural", status: "pending", completedSteps: [], locked: false },
    );
  });
});
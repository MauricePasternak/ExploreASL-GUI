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

  it("shows progress count text", () => {
    mockPhase = "running";
    renderBar();
    expect(screen.getByText(/1\/2 subjects/)).toBeInTheDocument();
  });
});
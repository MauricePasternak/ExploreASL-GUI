import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProcessingStore } from "../../stores/processingStore";
import { useDataParStore } from "../../stores/dataParStore";
import PopulationSection from "./PopulationSection";

// Mock tauri-apps core to avoid loading tauri native APIs in jsdom
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock tauri-apps fs plugin to avoid loading tauri native APIs in jsdom
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

vi.mock("../../lib/logViewer", () => ({
  fetchModuleLogs: vi.fn().mockResolvedValue([]),
  fetchLogContent: vi.fn().mockResolvedValue({ lines: [], totalLines: 0, truncated: false }),
}));

function renderSection() {
  return render(
    <MantineProvider>
      <PopulationSection />
    </MantineProvider>,
  );
}

afterEach(() => cleanup());

describe("PopulationSection", () => {
  beforeEach(() => {
    // Reset stores to default state
    useProcessingStore.setState({
      config: {
        subjects: [],
        modules: [],
        matlabPath: "",
        exploreAslPath: "",
        workers: 4,
        subjectRegexp: "",
      },
      availableSubjects: [],
      subjectStatuses: [],
    });

    useDataParStore.setState({
      dataPar: {
        Atlases: [],
      },
    });
  });

  it("renders eligibility summary", () => {
    useProcessingStore.setState({
      availableSubjects: [
        { subjectSession: "sub-01_01", subject: "sub-01", session: "01", hasStructural: true, hasASL: true },
        { subjectSession: "sub-02_01", subject: "sub-02", session: "01", hasStructural: true, hasASL: true },
        { subjectSession: "sub-03_01", subject: "sub-03", session: "01", hasStructural: true, hasASL: true },
        { subjectSession: "sub-04_01", subject: "sub-04", session: "01", hasStructural: true, hasASL: true },
        { subjectSession: "sub-05_01", subject: "sub-05", session: "01", hasStructural: true, hasASL: true },
      ],
      subjectStatuses: [
        { subjectSession: "sub-01_01", module: "structural", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-01_01", module: "asl", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-02_01", module: "structural", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-02_01", module: "asl", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-03_01", module: "structural", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-03_01", module: "asl", status: "incomplete", completedSteps: [], locked: false },
      ],
    });

    renderSection();
    expect(screen.getByTestId("population-eligibility")).toHaveTextContent(
      "2/5 subjects eligible (structural + ASL complete)"
    );
  });

  it("disables checkbox when structural is selected", () => {
    useProcessingStore.setState({
      config: {
        subjects: [],
        modules: ["structural"],
        matlabPath: "",
        exploreAslPath: "",
        workers: 4,
        subjectRegexp: "",
      },
      availableSubjects: [
        { subjectSession: "sub-01_01", subject: "sub-01", session: "01", hasStructural: true, hasASL: true },
      ],
      subjectStatuses: [
        { subjectSession: "sub-01_01", module: "structural", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-01_01", module: "asl", status: "complete", completedSteps: [], locked: false },
      ],
    });

    renderSection();
    const checkbox = screen.getByTestId("population-checkbox");
    expect(checkbox).toBeDisabled();
  });

  it("disables checkbox when no subjects eligible", () => {
    useProcessingStore.setState({
      config: {
        subjects: [],
        modules: [],
        matlabPath: "",
        exploreAslPath: "",
        workers: 4,
        subjectRegexp: "",
      },
      availableSubjects: [
        { subjectSession: "sub-01_01", subject: "sub-01", session: "01", hasStructural: true, hasASL: true },
      ],
      subjectStatuses: [
        { subjectSession: "sub-01_01", module: "structural", status: "complete", completedSteps: [], locked: false },
        { subjectSession: "sub-01_01", module: "asl", status: "incomplete", completedSteps: [], locked: false },
      ],
    });

    renderSection();
    const checkbox = screen.getByTestId("population-checkbox");
    expect(checkbox).toBeDisabled();
  });

  it("renders atlas badges with display names", () => {
    useDataParStore.setState({
      dataPar: {
        Atlases: ["Total", "DeepWM"],
      },
    });

    renderSection();
    const badges = screen.getAllByTestId("population-atlas-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("Whole Brain Grey and White Matter");
    expect(badges[1]).toHaveTextContent("Deep White Matter");
  });

  it("shows 'No atlases configured' when atlases empty", () => {
    useDataParStore.setState({
      dataPar: { Atlases: [] },
    });

    renderSection();
    expect(screen.getByTestId("population-atlas-recap")).toHaveTextContent("No atlases configured");
  });

  it("falls back to raw name for unknown atlas codes", () => {
    useDataParStore.setState({
      dataPar: {
        Atlases: ["UnknownAtlas"],
      },
    });

    renderSection();
    const badges = screen.getAllByTestId("population-atlas-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("UnknownAtlas");
  });

  it("shows 'No Logs' text when no log files exist", () => {
    renderSection();
    expect(screen.getByTestId("population-no-logs")).toHaveTextContent("No Logs");
  });

  it("shows pending status icon when no population status exists", () => {
    useProcessingStore.setState({ subjectStatuses: [] });
    renderSection();
    expect(screen.getByTestId("population-status-pending")).toBeInTheDocument();
  });

  it("shows complete status icon when population is complete", () => {
    useProcessingStore.setState({
      subjectStatuses: [
        { subjectSession: "", module: "population", status: "complete", completedSteps: [], locked: false },
      ],
    });
    renderSection();
    expect(screen.getByTestId("population-status-complete")).toBeInTheDocument();
  });

  it("shows in-progress status icon when population is incomplete", () => {
    useProcessingStore.setState({
      processingPhase: "running",
      subjectStatuses: [
        { subjectSession: "", module: "population", status: "incomplete", completedSteps: [], locked: true },
      ],
    });
    renderSection();
    expect(screen.getByTestId("population-status-incomplete")).toBeInTheDocument();
  });

  it("shows stalled status icon when population is incomplete and phase is failed", () => {
    useProcessingStore.setState({
      processingPhase: "failed",
      subjectStatuses: [
        { subjectSession: "", module: "population", status: "incomplete", completedSteps: [], locked: true },
      ],
    });
    renderSection();
    expect(screen.getByTestId("population-status-incomplete-stalled")).toBeInTheDocument();
  });
});

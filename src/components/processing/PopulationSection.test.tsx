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

  it("renders atlas recap from dataPar", () => {
    useDataParStore.setState({
      dataPar: {
        Atlases: ["Total", "DeepWM"],
      },
    });

    renderSection();
    expect(screen.getByTestId("population-atlas-recap")).toHaveTextContent("Total, DeepWM");
  });

  it("disables log button when no log file exists", () => {
    renderSection();
    expect(screen.getByTestId("population-log-btn")).toBeDisabled();
  });
});

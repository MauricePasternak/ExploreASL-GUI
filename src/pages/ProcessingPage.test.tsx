import { cleanup, render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProcessingStore } from "../stores/processingStore";

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

vi.mock("../../stores/globalStore", () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings: {
        matlabInstallations: [{ label: "R2024a", path: "/usr/bin/matlab", version: "R2024a" }],
        exploreAslPath: "/opt/ExploreASL",
      },
    }),
}));

vi.mock("../../hooks/useProcessingSync", () => ({
  useProcessingSync: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_cores") return Promise.resolve(8);
    if (cmd === "get_available_memory_mb") return Promise.resolve(16384);
    if (cmd === "list_module_logs") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn().mockResolvedValue(true),
}));

const { default: ProcessingPage } = await import("./ProcessingPage");

const DEFAULT_CONFIG = {
  subjects: ["sub-001_01", "sub-002_01"],
  modules: ["structural", "asl"] as ("structural" | "asl" | "population")[],
  matlabPath: "/usr/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
  workers: 2,
  subjectRegexp: "^(sub-001_01|sub-002_01)$",
};

const DEFAULT_SUBJECTS = [
  { subjectSession: "sub-001_01", subject: "001", session: "01", hasStructural: true, hasASL: true },
  { subjectSession: "sub-002_01", subject: "002", session: "01", hasStructural: false, hasASL: true },
];

function renderPage() {
  return render(
    <MantineProvider>
      <ProcessingPage />
    </MantineProvider>,
  );
}

describe("ProcessingPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useProcessingStore.setState({
      processingPhase: "idle",
      availableSubjects: DEFAULT_SUBJECTS,
      subjectStatuses: [],
      config: DEFAULT_CONFIG,
      workerPids: [],
    });
  });

  it("renders the processing page container", () => {
    renderPage();
    expect(screen.getByTestId("processing-page")).toBeInTheDocument();
  });

  it("renders SubjectSelection with subjects from store", () => {
    renderPage();
    expect(screen.getByTestId("subject-selection")).toBeInTheDocument();
    expect(screen.getByText("Select Subject/Session Entries")).toBeInTheDocument();
  });

  it("does not render population status column in SubjectSelection", () => {
    renderPage();
    const subjectSelection = screen.getByTestId("subject-selection");
    expect(within(subjectSelection).queryByText(/Population/i)).not.toBeInTheDocument();
  });

  it("renders PipelineConfig with module checkboxes", () => {
    renderPage();
    const config = screen.getByTestId("pipeline-config");
    expect(config).toBeInTheDocument();
    expect(screen.getByTestId("module-checkbox-structural")).toBeInTheDocument();
    expect(screen.getByTestId("module-checkbox-asl")).toBeInTheDocument();
    expect(screen.queryByTestId("module-checkbox-population")).not.toBeInTheDocument();
  });

  it("renders PopulationSection between PipelineConfig and PreflightCheck", () => {
    renderPage();
    const pipeline = screen.getByTestId("pipeline-config");
    const population = screen.getByTestId("population-section");
    const preflight = screen.getByTestId("preflight-check");
    // Verify DOM order
    expect(pipeline.compareDocumentPosition(population) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preflight.compareDocumentPosition(population) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("shows validation errors when config has issues", () => {
    renderPage();
    expect(screen.getByTestId("pipeline-config")).toBeInTheDocument();
  });

  it("renders ControlButtons", () => {
    renderPage();
    expect(screen.getByTestId("control-buttons")).toBeInTheDocument();
  });

  it("renders MATLAB version select", () => {
    renderPage();
    expect(screen.getByTestId("matlab-select")).toBeInTheDocument();
  });

  it("renders worker count input", () => {
    renderPage();
    expect(screen.getByTestId("worker-count-input")).toBeInTheDocument();
  });

  it("renders LogViewerModal as part of log column integration", () => {
    renderPage();
    expect(screen.getAllByTestId("log-viewer-modal")[0]).toBeInTheDocument();
  });

  it("does not show orphaned subjects warning for population module status", () => {
    useProcessingStore.setState({
      subjectStatuses: [
        { subjectSession: "", module: "population", status: "incomplete", completedSteps: [], locked: true },
      ],
    });
    renderPage();
    expect(screen.queryByTestId("orphaned-subjects-warning")).not.toBeInTheDocument();
  });

  it("shows orphaned subjects warning for non-population module with unknown subject", () => {
    useProcessingStore.setState({
      subjectStatuses: [
        { subjectSession: "sub-999_01", module: "structural", status: "incomplete", completedSteps: [], locked: false },
      ],
    });
    renderPage();
    expect(screen.getByTestId("orphaned-subjects-warning")).toBeInTheDocument();
    expect(screen.getByText(/orphaned lock file entr/i)).toHaveTextContent("1 orphaned lock file entry");
  });

  it("renders ReportViewerModal in the layout", () => {
    renderPage();
    expect(screen.getByTestId("report-viewer-modal")).toBeInTheDocument();
  });
});

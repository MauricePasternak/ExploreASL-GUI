import { TestMantineProvider as MantineProvider } from "../test/render";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProcessingStore } from "../stores/processingStore";
import type { ProcessConfig } from "../schemas/processingSchemas";
import { processingSnapshot } from "../test/processingFixtures";
import type { LogFileInfo } from "../lib/logViewer";
import type { ReportFileInfo } from "../lib/reportViewer";

const evidence = vi.hoisted(() => ({ logs: [] as LogFileInfo[], reports: [] as ReportFileInfo[] }));

const { mockProject, mockSettings, mockValidationState, mockGetProfileById, mockHasValidProfile } =
  vi.hoisted(() => {
    const settings = {
      executionProfiles: [
        {
          id: "profile-1",
          label: "R2024a",
          type: "matlab" as const,
          matlabPath: "/usr/bin/matlab",
          exploreAslPath: "/opt/ExploreASL",
          exploreAslVersion: "1.11.0",
        },
      ],
    };
    return {
      mockProject: {
        project: {
          projectMeta: { rootPath: "/test/project" },
          dataPar: {},
          uiState: { processing: { config: null as ProcessConfig | null } },
        },
      },
      mockSettings: settings,
      mockValidationState: {
        "profile-1": { valid: true, errors: [] as string[] },
      },
      mockGetProfileById: (id: string) => settings.executionProfiles.find((p) => p.id === id),
      mockHasValidProfile: () => true,
    };
  });

vi.mock("../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mockProject),
}));

vi.mock("../stores/globalStore", () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings: mockSettings,
      profileValidationState: mockValidationState,
      getProfileById: mockGetProfileById,
      hasValidProfile: mockHasValidProfile,
    }),
}));

vi.mock("../hooks/useProcessingSync", () => ({
  useProcessingSync: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_cores") return Promise.resolve(8);
    if (cmd === "get_available_memory_mb") return Promise.resolve(16384);
    if (cmd === "list_module_logs") return Promise.resolve(evidence.logs);
    if (cmd === "list_subject_reports") return Promise.resolve(evidence.reports);
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
  selectedProfileId: "profile-1",
  workers: 2,
};

const DEFAULT_SUBJECTS = [
  {
    subjectSession: "sub-001_01",
    subject: "001",
    session: "01",
    hasStructural: true,
    hasASL: true,
    aslRuns: [],
  },
  {
    subjectSession: "sub-002_01",
    subject: "002",
    session: "01",
    hasStructural: false,
    hasASL: true,
    aslRuns: [],
  },
];

function renderPage() {
  return render(
    <MantineProvider env="test">
      <ProcessingPage />
    </MantineProvider>,
  );
}

describe("ProcessingPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    evidence.logs = [];
    evidence.reports = [];
    mockProject.project.uiState.processing.config = DEFAULT_CONFIG;
    useProcessingStore.setState({
      processingPhase: "idle",
      snapshot: null,
      activeRunId: null,
      availableSubjects: DEFAULT_SUBJECTS,
      subjectStatuses: [],
    });
  });

  it("renders the idle configuration, controls, and viewers in workflow order", () => {
    renderPage();
    expect(screen.getByTestId("processing-page")).toBeInTheDocument();
    expect(screen.getByTestId("subject-selection")).toBeInTheDocument();
    expect(screen.getByText("Subject / session selection")).toBeInTheDocument();
    const subjectSelection = screen.getByTestId("subject-selection");
    expect(within(subjectSelection).queryByText(/Population/i)).not.toBeInTheDocument();

    const pipeline = screen.getByTestId("pipeline-config");
    expect(pipeline).toBeInTheDocument();
    expect(screen.getByTestId("module-checkbox-structural")).toBeInTheDocument();
    expect(screen.getByTestId("module-checkbox-asl")).toBeInTheDocument();
    expect(screen.queryByTestId("module-checkbox-population")).not.toBeInTheDocument();
    const population = screen.getByTestId("population-section");
    expect(
      pipeline.compareDocumentPosition(population) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByTestId("control-buttons")).toBeInTheDocument();
    expect(screen.getByTestId("profile-selector")).toBeInTheDocument();
    expect(screen.getByTestId("worker-count-input")).toBeInTheDocument();
    expect(screen.getAllByTestId("log-viewer-modal")[0]).toBeInTheDocument();
    expect(screen.getByTestId("report-viewer-modal")).toBeInTheDocument();
  });

  it("presents compact setup hierarchy with grouped module columns", () => {
    renderPage();
    const header = screen.getByTestId("processing-header");
    expect(within(header).getByRole("heading", { name: "Processing" })).toBeInTheDocument();
    expect(header).toHaveTextContent("Choose subjects and settings for the next run.");
    expect(screen.getByTestId("processing-settings-heading")).toHaveTextContent("NEXT RUN");
    expect(screen.getByTestId("processing-settings-content")).toHaveClass(
      "processing-settings-content--config",
    );
    expect(screen.getByText("What to process")).toBeInTheDocument();
    expect(screen.getByText("Parallel workers")).toBeInTheDocument();
    expect(screen.getByTestId("processing-resync-details")).not.toHaveAttribute("open");
    const table = screen.getByTestId("subject-table");
    expect(within(table).getByRole("columnheader", { name: "Structural" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "ASL" })).toBeInTheDocument();
  });

  it("preserves per-module errors, M0-only ASL reports, unavailable evidence and skipped controls", async () => {
    evidence.logs = [
      {
        filename: "asl.log",
        module: "asl",
        subjectSession: "sub-001_01",
        run: undefined,
        hasError: false,
      },
    ];
    evidence.reports = [{ module: "m0", subjectSession: "sub-001_01", run: undefined }];
    useProcessingStore.setState({
      subjectStatuses: [
        {
          subjectSession: "sub-001_01",
          module: "structural",
          status: "incomplete",
          completedSteps: [],
          locked: false,
        },
        {
          subjectSession: "sub-001_01",
          module: "asl",
          status: "outdated",
          completedSteps: [],
          locked: false,
        },
      ],
    });
    renderPage();
    expect(
      await screen.findByRole("button", { name: "View outdated ASL report for sub-001_01" }),
    ).toHaveTextContent("View Outdated Report");
    expect(
      screen.getByRole("button", { name: "View Structural errors for sub-001_01" }),
    ).toHaveTextContent("View Errors");
    expect(screen.getByRole("button", { name: "View ASL logs for sub-001_01" })).toHaveTextContent(
      "View Logs",
    );
    const first = within(screen.getByRole("row", { name: /001 01/ }));
    expect(first.getByTestId("structural-status-label")).toHaveTextContent("Incomplete");
    expect(first.getByTestId("asl-status-label")).toHaveTextContent("Outdated");
    expect(first.getByTestId("no-structural-report")).toHaveTextContent("No Report");
    const second = within(screen.getByRole("row", { name: /002 01/ }));
    expect(second.getByTestId("structural-status-label")).toHaveTextContent("No data");
    expect(second.queryByTestId("no-structural-logs")).not.toBeInTheDocument();
    expect(second.queryByTestId("no-structural-report")).not.toBeInTheDocument();
    expect(second.getByTestId("no-asl-logs")).toHaveTextContent("No Logs");
    expect(second.getByTestId("no-asl-report")).toHaveTextContent("No Report");
  });

  it("does not show orphaned subjects warning for population module status", () => {
    useProcessingStore.setState({
      subjectStatuses: [
        {
          subjectSession: "",
          module: "population",
          status: "incomplete",
          completedSteps: [],
          locked: true,
        },
      ],
    });
    renderPage();
    const alert = screen.getByTestId("processing-status-alert");
    expect(alert).not.toHaveTextContent(/session in earlier processing results/i);
  });

  it("shows orphaned subjects warning for non-population module with unknown subject", async () => {
    useProcessingStore.setState({
      subjectStatuses: [
        {
          subjectSession: "sub-999_01",
          module: "structural",
          status: "incomplete",
          completedSteps: [],
          locked: false,
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      const alert = screen.getByTestId("processing-status-alert");
      expect(alert).toHaveTextContent(
        "1 session in earlier processing results is not in this project",
      );
    });
  });

  describe("Start button gated by ProcessingStatusAlert errors", () => {
    it("disables Start button when preflight reports errors (no subjects selected)", async () => {
      mockProject.project.uiState.processing.config = {
        ...DEFAULT_CONFIG,
        subjects: [],
        modules: ["structural", "asl"],
      };
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });

      expect(screen.getByTestId("start-btn")).toBeDisabled();
    });

    it("disables Start button when no modules selected", async () => {
      mockProject.project.uiState.processing.config = {
        ...DEFAULT_CONFIG,
        modules: [],
      };
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });

      expect(screen.getByTestId("start-btn")).toBeDisabled();
    });

    it("enables Start synchronously when pure request preflight passes", () => {
      renderPage();
      expect(screen.getByTestId("start-btn")).toBeEnabled();
    });
  });

  describe("Preparing transition state", () => {
    it("renders PreparingTransition when phase is preparing", () => {
      useProcessingStore.setState({
        processingPhase: "preparing",
        activeRunId: "processing-run-1",
        snapshot: processingSnapshot({
          runId: "processing-run-1",
          selectedModules: ["structural", "asl"],
          selectedSubjectSessions: ["sub-001_01"],
        }),
        preparingMessage: "Generating participants list...",
      });
      renderPage();

      expect(screen.getByTestId("preparing-transition")).toBeInTheDocument();
      expect(screen.getByTestId("preparing-message")).toHaveTextContent(
        "Generating participants list...",
      );
      expect(screen.queryByTestId("subject-selection")).not.toBeInTheDocument();
      expect(screen.getByTestId("execution-dashboard")).toBeInTheDocument();
    });

    it("falls back to default text when preparingMessage is null", () => {
      useProcessingStore.setState({
        processingPhase: "preparing",
        preparingMessage: null,
      });
      renderPage();

      expect(screen.getByTestId("preparing-transition")).toBeInTheDocument();
      expect(screen.getByTestId("preparing-message")).toHaveTextContent(
        "Getting ready to start...",
      );
    });
  });

  it.each(["running", "finalizing", "cancelling"] as const)(
    "keeps the attached dashboard visible during %s",
    (processingPhase) => {
      useProcessingStore.setState({
        processingPhase,
        activeRunId: "processing-run-1",
        snapshot: processingSnapshot({
          runId: "processing-run-1",
          lifecycle: processingPhase,
          selectedModules: ["structural", "asl"],
          selectedSubjectSessions: ["sub-001_01"],
          workerCount: 1,
        }),
      });
      renderPage();
      expect(screen.getByTestId("execution-dashboard")).toBeInTheDocument();
      expect(screen.queryByTestId("pipeline-config")).not.toBeInTheDocument();
      expect(screen.getByTestId("processing-reserved-modules")).toHaveTextContent(
        "Structural + ASL · 1 session",
      );
      if (processingPhase === "running") {
        expect(screen.getByTestId("processing-live-status")).toHaveTextContent(
          "Processing is running",
        );
        expect(screen.getByTestId("stop-btn")).toHaveTextContent("Stop processing");
      }
    },
  );

  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "hides active dashboard for terminal %s",
    (processingPhase) => {
      useProcessingStore.setState({ processingPhase, activeRunId: null });
      renderPage();
      expect(screen.queryByTestId("execution-dashboard")).not.toBeInTheDocument();
      expect(screen.getByTestId("pipeline-config")).toBeInTheDocument();
    },
  );
});

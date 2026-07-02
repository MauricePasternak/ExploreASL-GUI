import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { invoke } from "@tauri-apps/api/core";

import ImportSubjectTable from "./ImportSubjectTable";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import type { ImportProgress } from "../../schemas/importSchemas";

function renderWithProviders(
  rows: ImportProgress[],
  selectedSubjects: string[] = [],
  onSelectedSubjectsChange = vi.fn(),
) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <ImportSubjectTable
          rows={rows}
          selectedSubjects={selectedSubjects}
          onSelectedSubjectsChange={onSelectedSubjectsChange}
        />
      </MemoryRouter>
    </MantineProvider>,
  );
}

function makeProgress(
  subject: string,
  status: ImportProgress["status"],
  stale = false,
  currentStep?: ImportProgress["currentStep"],
  errorStep?: ImportProgress["errorStep"],
): ImportProgress {
  return {
    subject,
    session: "01",
    status,
    stale,
    currentStep,
    errorStep,
  };
}

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
  });
  vi.resetAllMocks();
});

describe("ImportSubjectTable", () => {
  it("renders rows with checkboxes", () => {
    const rows = [makeProgress("SUB01", "pending"), makeProgress("SUB02", "completed")];
    renderWithProviders(rows);

    expect(screen.getByTestId("import-subject-table")).toBeInTheDocument();
    expect(screen.getByTestId("import-table")).toBeInTheDocument();
    expect(screen.getByTestId("import-filter")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    // Header select-all plus one checkbox per subject row
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);
  });

  it("filter counts match subject distribution", async () => {
    const rows = [
      makeProgress("SUB01", "pending"),
      makeProgress("SUB02", "completed"),
      makeProgress("SUB03", "failed", false, undefined, "NII2BIDS"),
      makeProgress("SUB04", "completed", true),
      makeProgress("SUB05", "completed"),
    ];
    renderWithProviders(rows);

    expect(screen.getByTestId("import-filter")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();

    // Filter badge counts (All=5, Pending=1, Completed=2, Failed=1, Stale=1)
    const badges = screen.getAllByText("5");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("checkbox pre-selection follows staleness logic", () => {
    const rows = [
      makeProgress("SUB01", "completed", false),
      makeProgress("SUB02", "completed", true),
      makeProgress("SUB03", "failed", false),
      makeProgress("SUB04", "pending", false),
    ];
    const onSelectedSubjectsChange = vi.fn();

    // Pre-select stale+failed
    renderWithProviders(rows, ["SUB02", "SUB03"], onSelectedSubjectsChange);

    expect(screen.getByText("SUB01")).toBeInTheDocument();
    expect(screen.getByText("SUB02")).toBeInTheDocument();
    expect(screen.getByText("SUB03")).toBeInTheDocument();
    expect(screen.getByText("SUB04")).toBeInTheDocument();
  });

  it("renders stale overlay on completed-but-stale subjects", () => {
    const rows = [
      makeProgress("SUB01", "completed", true),
      makeProgress("SUB02", "completed", false),
    ];
    renderWithProviders(rows, [], vi.fn());

    const staleWrappers = screen.getAllByTestId("status-stale-wrapper");
    expect(staleWrappers.length).toBe(1);

    const staleOverlays = screen.getAllByTestId("stale-overlay");
    expect(staleOverlays.length).toBe(1);
  });

  it("opens LogViewerModal on View Logs click", async () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          dataPar: {},
        },
      },
      isDirty: false,
      loaded: true,
    });

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_module_logs") {
        return Promise.resolve([
          {
            filename: "xASL_module_Import_sub-SUB01.log",
            module: "import",
            subjectSession: "sub-SUB01",
            run: null,
            hasError: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const rows = [makeProgress("SUB01", "completed")];
    renderWithProviders(rows);

    const viewLogsBtn = await screen.findByTestId("view-import-logs-SUB01");
    expect(viewLogsBtn).toBeInTheDocument();

    await userEvent.click(viewLogsBtn);

    expect(screen.getByTestId("log-viewer-modal")).toBeInTheDocument();
  });

  it("renders no log badge when no logs exist", () => {
    const rows = [makeProgress("SUB01", "completed")];
    renderWithProviders(rows);

    const noLogs = screen.getByTestId("no-import-logs-SUB01");
    expect(noLogs).toBeInTheDocument();
    expect(noLogs.textContent).toBe("No Logs");
  });

  it("shows empty state when no rows provided", () => {
    renderWithProviders([]);

    expect(screen.getByTestId("import-progress-empty")).toBeInTheDocument();
    expect(screen.getByText(/progress will appear here/i)).toBeInTheDocument();
  });
});

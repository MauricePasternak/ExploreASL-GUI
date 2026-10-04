import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
    <MantineProvider env="test">
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

function subjectCheckbox(subject: string) {
  return within(screen.getByRole("cell", { name: subject }).closest("tr")!).getByRole("checkbox");
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
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(subjectCheckbox("SUB01")).not.toBeChecked();
    expect(subjectCheckbox("SUB02")).not.toBeChecked();
  });

  it("filter counts match subject distribution", async () => {
    const user = userEvent.setup();
    const rows = [
      makeProgress("SUB01", "pending"),
      makeProgress("SUB02", "completed"),
      makeProgress("SUB03", "failed", false, undefined, "NII2BIDS"),
      makeProgress("SUB04", "completed", true),
      makeProgress("SUB05", "completed"),
    ];
    renderWithProviders(rows);

    const filter = within(screen.getByTestId("import-filter"));
    for (const [label, count, subjects] of [
      ["All", 5, ["SUB01", "SUB02", "SUB03", "SUB04", "SUB05"]],
      ["Pending", 1, ["SUB01"]],
      ["Completed", 2, ["SUB02", "SUB05"]],
      ["Failed", 1, ["SUB03"]],
      ["Stale", 1, ["SUB04"]],
    ] as const) {
      const radio = filter.getByRole("radio", { name: `${label} ${count}` });
      await user.click(radio);
      expect(radio).toBeChecked();
      const tableRows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
      expect(tableRows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(
        subjects,
      );
    }
  });

  it("renders supplied stale and failed pre-selection", () => {
    const rows = [
      makeProgress("SUB01", "completed", false),
      makeProgress("SUB02", "completed", true),
      makeProgress("SUB03", "failed", false),
      makeProgress("SUB04", "pending", false),
    ];
    const onSelectedSubjectsChange = vi.fn();

    // Pre-select stale+failed
    renderWithProviders(rows, ["SUB02", "SUB03"], onSelectedSubjectsChange);

    expect(subjectCheckbox("SUB01")).not.toBeChecked();
    expect(subjectCheckbox("SUB02")).toBeChecked();
    expect(subjectCheckbox("SUB03")).toBeChecked();
    expect(subjectCheckbox("SUB04")).not.toBeChecked();
  });

  it("keeps only committed partial success eligible for preservation; failed and interrupted rows remain selected", () => {
    const rows = [
      makeProgress("COMMITTED", "completed", false),
      makeProgress("STALE", "completed", true),
      makeProgress("INVALID", "failed", false, undefined, "NII2BIDS"),
      makeProgress("INTERRUPTED", "interrupted"),
    ];
    renderWithProviders(rows, ["STALE", "INVALID", "INTERRUPTED"]);
    expect(subjectCheckbox("COMMITTED")).not.toBeChecked();
    expect(subjectCheckbox("STALE")).toBeChecked();
    expect(subjectCheckbox("INVALID")).toBeChecked();
    expect(subjectCheckbox("INTERRUPTED")).toBeChecked();
    expect(screen.getByTestId("status-failed")).toBeInTheDocument();
    expect(screen.getByTestId("status-interrupted")).toBeInTheDocument();
  });

  it("renders authoritative retry matrix rather than frontend completion flags", () => {
    const rows = [
      makeProgress("COMMITTED", "completed"),
      makeProgress("STALE-COMMITTED", "completed", true),
      makeProgress("INVALID-AUDIT", "failed", false, undefined, "NII2BIDS"),
      makeProgress("INTERRUPTED-STAGING", "interrupted"),
      makeProgress("CANCELLED", "cancelled"),
    ];
    renderWithProviders(rows, [
      "STALE-COMMITTED",
      "INVALID-AUDIT",
      "INTERRUPTED-STAGING",
      "CANCELLED",
    ]);

    expect(screen.getAllByTestId("status-completed")).toHaveLength(2);
    expect(screen.getByTestId("status-stale-wrapper")).toHaveTextContent("");
    expect(screen.getByTestId("status-failed")).toBeInTheDocument();
    expect(screen.getByTestId("status-interrupted")).toBeInTheDocument();
    expect(screen.getByTestId("status-cancelled")).toBeInTheDocument();
    expect(subjectCheckbox("COMMITTED")).not.toBeChecked();
    for (const subject of [
      "STALE-COMMITTED",
      "INVALID-AUDIT",
      "INTERRUPTED-STAGING",
      "CANCELLED",
    ]) {
      expect(subjectCheckbox(subject)).toBeChecked();
    }
  });

  it("retains selection across real pagination and disables selection when locked", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 12 }, (_, index) =>
      makeProgress(`SUB${index + 1}`, "pending"),
    );
    function ControlledTable({ selectionLocked = false }: { selectionLocked?: boolean }) {
      const [selectedSubjects, setSelectedSubjects] = useState(["SUB1"]);
      return (
        <ImportSubjectTable
          rows={rows}
          selectedSubjects={selectedSubjects}
          onSelectedSubjectsChange={setSelectedSubjects}
          selectionLocked={selectionLocked}
        />
      );
    }
    const view = render(
      <MantineProvider env="test">
        <ControlledTable />
      </MantineProvider>,
    );

    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.queryByText("SUB11")).not.toBeInTheDocument();
    expect(subjectCheckbox("SUB1")).toBeChecked();
    await user.click(subjectCheckbox("SUB2"));
    expect(subjectCheckbox("SUB2")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByText("SUB1")).not.toBeInTheDocument();
    expect(subjectCheckbox("SUB11")).not.toBeChecked();
    await user.click(subjectCheckbox("SUB11"));
    expect(subjectCheckbox("SUB11")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(subjectCheckbox("SUB1")).toBeChecked();
    expect(subjectCheckbox("SUB2")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(subjectCheckbox("SUB11")).toBeChecked();

    view.rerender(
      <MantineProvider env="test">
        <ControlledTable selectionLocked />
      </MantineProvider>,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
    await user.click(subjectCheckbox("SUB12"));
    expect(subjectCheckbox("SUB12")).not.toBeChecked();
    expect(subjectCheckbox("SUB11")).toBeChecked();
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
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { MantineProvider } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import ImportExecution from "./ImportExecution";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { DEFAULT_PROJECT_FILE } from "../../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import { useGlobalStore } from "../../stores/globalStore";
import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
  resetProjectLifecycleForTests();
  vi.mocked(invoke).mockReset();
});
function renderExecution() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <ImportExecution />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("ImportExecution authoritative lifecycle", () => {
  it.each([
    ["preparing", "Preparing"],
    ["running", "Running"],
    ["finalizing", "Finalizing"],
    ["cancelling", "Cancelling"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["interrupted", "Interrupted"],
  ] as const)("renders %s distinctly with state-correct controls", (phase, label) => {
    useImportStore.setState({
      importPhase: phase,
      activeRunId: ["preparing", "running", "finalizing", "cancelling"].includes(phase)
        ? "import-run-1"
        : null,
      terminalRunId: ["completed", "failed", "cancelled", "interrupted"].includes(phase)
        ? "import-run-1"
        : null,
    });
    renderExecution();
    expect(screen.getByTestId("import-lifecycle-badge")).toHaveTextContent(label);
    if (phase === "running") expect(screen.getByTestId("stop-import-btn")).toBeEnabled();
    else expect(screen.getByTestId("stop-import-btn")).toBeDisabled();
    if (["preparing", "running", "finalizing", "cancelling"].includes(phase)) {
      expect(screen.getByTestId("import-back-btn")).toBeDisabled();
    } else {
      expect(screen.getByTestId("import-back-btn")).toBeEnabled();
    }
    expect(screen.getByTestId("import-log-panel")).toBeInTheDocument();
  });

  it("renders finalization as locked native work", () => {
    useImportStore.setState({ importPhase: "finalizing", activeRunId: "import-run-1" });
    renderExecution();
    expect(screen.getByTestId("import-lifecycle-badge")).toHaveTextContent("Finalizing");
    expect(screen.getByTestId("import-finalizing-message")).toBeInTheDocument();
    expect(screen.getByTestId("start-import-btn")).toBeDisabled();
    expect(screen.getByTestId("import-back-btn")).toBeDisabled();
  });

  it("renders interrupted evidence as retryable terminal state", () => {
    useImportStore.setState({
      importPhase: "interrupted",
      activeRunId: null,
      terminalRunId: "import-run-1",
      importRunError: "staging marker missing",
    });
    renderExecution();
    expect(screen.getByTestId("import-lifecycle-badge")).toHaveTextContent("Interrupted");
    expect(screen.getByTestId("import-interrupted-message")).toBeInTheDocument();
    expect(screen.getByTestId("import-run-error")).toHaveTextContent("staging marker missing");
  });

  it("renders authoritative committed/failed counts", () => {
    useImportStore.setState({
      importPhase: "failed",
      terminalRunId: "import-run-1",
      importSummary: { succeeded: 1, failed: 2, errors: ["missing lock"] },
    });
    renderExecution();
    expect(screen.getByTestId("import-terminal-summary")).toHaveTextContent(
      "Committed: 1; failed: 2",
    );
  });

  it("renders field-level authoritative launch preflight issues", () => {
    useImportStore.setState((state) => ({
      stagingPreflight: {
        ...state.stagingPreflight,
        status: "invalid",
        issues: [
          {
            code: "PORTABLE_COLLISION",
            field: "destination",
            entryIndex: 0,
            conflictingEntryIndex: 1,
            message: "Two entries collide",
          },
        ],
      },
    }));

    renderExecution();

    expect(screen.getByTestId("import-staging-issues")).toHaveTextContent(
      "destination: Two entries collide",
    );
  });

  it("blocks replacement admission until terminal save and acknowledgement finish", () => {
    useImportStore.setState({
      importPhase: "failed",
      activeRunId: null,
      terminalRunId: "import-run-1",
    });

    renderExecution();

    expect(screen.getByTestId("start-import-btn")).toBeDisabled();
  });

  it("blocks import while the saved DICOM source is unavailable", () => {
    useImportStore.setState({
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing",
        message: "missing",
      },
    });

    renderExecution();

    expect(screen.getByTestId("start-import-btn")).toBeDisabled();
    expect(screen.getByTestId("import-source-unavailable-alert")).toBeInTheDocument();
  });

  it("reattaches before enabling Start after local runtime loss", async () => {
    const running = {
      runId: "import-run-1",
      lifecycle: "running",
      ownershipGeneration: 1,
      profileId: "profile-1",
      selectedSubjects: ["ONE"],
      createdAtMs: 1,
      updatedAtMs: 2,
      subjectOutcomes: [],
    };
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project"),
      loaded: true,
    });
    activateProjectLease("project-1", "/project");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run" || command === "attach_import_run") return running;
      return null;
    });

    renderExecution();

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_active_import_run");
    expect(invoke).toHaveBeenCalledWith("attach_import_run", { runId: "import-run-1" });
    expect(screen.getByTestId("start-import-btn")).toBeDisabled();
    expect(useImportStore.getState().activeRunId).toBe("import-run-1");
  });

  it("replays a missed terminal result on remount without requesting relocation", async () => {
    const completed = {
      runId: "replayed-run",
      lifecycle: "completed" as const,
      ownershipGeneration: 1,
      profileId: "profile-1",
      selectedSubjects: ["ONE"],
      createdAtMs: 1,
      updatedAtMs: 2,
      exitEvidence: { exitCode: 0, successful: true },
      subjectOutcomes: [
        {
          subject: "ONE",
          outcome: "committed" as const,
          readyLockVerified: true,
          rawdataVerified: true,
          committed: true,
        },
      ],
      terminalResult: "completed" as const,
    };
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project"),
      loaded: true,
      saveProject: vi.fn().mockResolvedValue(undefined),
    });
    activateProjectLease("project-1", "/project");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run" || command === "attach_import_run") return completed;
      return undefined;
    });

    renderExecution();

    expect(await screen.findByTestId("import-terminal-summary")).toBeInTheDocument();
    expect(screen.getByTestId("import-terminal-summary")).toHaveTextContent("Committed: 1");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("acknowledge_import_run", { runId: "replayed-run" }),
    );
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => /relocat|move|clean|post.?process/i.test(command)),
    ).toBe(false);
  });

  it("blocks Start and shows actionable discovery failures", async () => {
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project"),
      loaded: true,
    });
    activateProjectLease("project-1", "/project");
    vi.mocked(invoke).mockRejectedValue(new Error("native unavailable"));

    renderExecution();

    expect(await screen.findByTestId("import-discovery-error")).toHaveTextContent(
      "native unavailable",
    );
    expect(screen.getByTestId("start-import-btn")).toBeDisabled();
  });

  it("uses native rerun inventory then reserve-bind-listen-attach-launch with only committed locks preserved", async () => {
    const order: string[] = [];
    let reserveParams: unknown;
    const preparing = {
      runId: "rerun-1",
      lifecycle: "preparing" as const,
      ownershipGeneration: 7,
      profileId: "profile-1",
      selectedSubjects: ["INTERRUPTED", "INVALID", "STALE"],
      createdAtMs: 1,
      updatedAtMs: 2,
      subjectOutcomes: [],
    };
    const running = { ...preparing, lifecycle: "running" as const, updatedAtMs: 3 };
    const inventory = {
      planId: "plan-rerun",
      fingerprint: "fingerprint",
      subjects: preparing.selectedSubjects.map((subject) => ({
        subject,
        entries: [{ path: `rawdata/sub-${subject}/scan.nii`, kind: "file", bytes: 3 }],
        fileCount: 1,
        byteTotal: 3,
        sessions: ["01"],
        fingerprint: `fingerprint-${subject}`,
      })),
    };
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project"),
      loaded: true,
    });
    activateProjectLease("project-1", "/project");
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        executionProfiles: [
          {
            id: "profile-1",
            type: "matlab",
            label: "MATLAB",
            matlabPath: "/matlab",
            exploreAslPath: "/ExploreASL",
          },
        ],
      },
      profileValidationState: { "profile-1": { valid: true, errors: [] } },
    });
    useImportStore.setState({
      selectedProfileId: "profile-1",
      subjectRows: ["COMMITTED", "STALE", "INVALID", "INTERRUPTED"].map((subject) => ({
        id: `${subject}/01`,
        subject,
        session: "01",
        groupId: "global",
      })),
    });
    vi.mocked(listen).mockImplementation(async (event) => {
      order.push(`listen:${event}`);
      return () => undefined;
    });
    vi.mocked(invoke).mockImplementation(async (command, params) => {
      if (command === "get_active_import_run") return null;
      if (command === "read_import_status") return [];
      if (command === "plan_import_relocation") return inventory;
      if (command === "reserve_import_run") {
        order.push("reserve");
        reserveParams = params;
        return preparing;
      }
      if (command === "attach_import_run") {
        order.push("attach");
        return preparing;
      }
      if (command === "launch_import_run") {
        order.push("launch");
        return running;
      }
      return undefined;
    });

    const unsubscribe = useImportStore.subscribe((state, previous) => {
      if (state.activeRunId === "rerun-1" && previous.activeRunId !== "rerun-1") {
        order.push("bind");
      }
    });
    renderExecution();
    await vi.waitFor(() => expect(screen.getByTestId("start-import-btn")).toBeEnabled());
    useImportStore.setState({
      importProgress: {
        COMMITTED: { subject: "COMMITTED", session: "01", status: "completed" },
        STALE: { subject: "STALE", session: "01", status: "completed", stale: true },
        INVALID: { subject: "INVALID", session: "01", status: "failed" },
        INTERRUPTED: { subject: "INTERRUPTED", session: "01", status: "interrupted" },
      },
    });
    order.length = 0;

    await userEvent.click(screen.getByTestId("start-import-btn"));
    expect(await screen.findByTestId("confirm-reimport-dialog")).toBeInTheDocument();
    expect(await screen.findByTestId("relocation-inventory-STALE")).toHaveTextContent("1 files");
    await userEvent.click(screen.getByTestId("confirm-reimport-confirm"));
    await vi.waitFor(() => expect(order).toContain("launch"));
    unsubscribe();

    expect(order).toEqual([
      "reserve",
      "bind",
      "listen:import-run-snapshot",
      "listen:import-raw-event",
      "listen:import-structured-event",
      "attach",
      "launch",
    ]);
    expect(reserveParams).toMatchObject({
      subjectList: ["INTERRUPTED", "INVALID", "STALE"],
      subjectsToPreserve: ["COMMITTED"],
      relocationPlanId: "plan-rerun",
    });
    expect(useImportStore.getState().importPhase).toBe("running");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import ImportExecution from "./ImportExecution";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectView } from "../../schemas/project";
import { projectFixture } from "../../test/projectFixtures";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import { useGlobalStore } from "../../stores/globalStore";
import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import { processingProfile } from "../../test/processingFixtures";

beforeEach(() => {
  vi.mocked(listen)
    .mockReset()
    .mockResolvedValue(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.getState().cancelAutosave();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  resetProjectLifecycleForTests();
  vi.mocked(invoke).mockReset();
  vi.restoreAllMocks();
});
function renderExecution() {
  return render(
    <MantineProvider env="test">
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ImportExecution />} />
          <Route path="/project/:id/parameters" element={<div data-testid="parameters-route" />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("ImportExecution authoritative lifecycle", () => {
  it("updates live subject status and conversion steps without granting parser completion authority", async () => {
    const callbacks = new Map<string, (event: { payload: unknown }) => void>();
    vi.mocked(listen).mockImplementation(async (name, callback) => {
      callbacks.set(name, (event) => callback({ event: name, id: 0, ...event }));
      return () => callbacks.delete(name);
    });
    const running = {
      runId: "live-run",
      lifecycle: "running" as const,
      ownershipGeneration: 1,
      profileId: "profile-1",
      selectedSubjects: ["GE001", "Philips001"],
      createdAtMs: 1,
      updatedAtMs: 2,
      subjectOutcomes: [],
      confirmationRequired: false,
    };
    useProjectStore.setState({
      project: projectView(projectFixture("project-1", "Project", "/project")),
      loaded: true,
    });
    activateProjectLease("project-1", "/project");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run" || command === "attach_import_run") return running;
      return [];
    });
    renderExecution();
    await vi.waitFor(() =>
      expect(screen.getByTestId("import-lifecycle-badge")).toHaveTextContent("Running"),
    );
    const row = () => within(screen.getByText("GE001").closest("tr")!);
    expect(row().getByTestId("status-pending")).toBeInTheDocument();
    const emit = (payload: Record<string, unknown>) =>
      act(() => {
        callbacks.get("import-structured-event")!({
          payload: { runId: running.runId, ownershipGeneration: 1, subject: "GE001", ...payload },
        });
      });

    emit({ type: "subject_start", step: "DCM2NII" });
    expect(row().getByTestId("status-running")).toBeInTheDocument();
    expect(row().getByTestId("status-running")).toHaveClass("mantine-Loader-root");
    expect(row().getByText("DCM2NII")).toBeInTheDocument();
    expect(
      within(screen.getByText("Philips001").closest("tr")!).getByTestId("status-pending"),
    ).toBeInTheDocument();
    emit({ type: "subject_start", step: "NII2BIDS" });
    expect(row().getByText("NII2BIDS")).toBeInTheDocument();
    emit({ type: "subject_complete", duration_secs: 5 });
    expect(row().queryByTestId("status-completed")).not.toBeInTheDocument();
    expect(useImportStore.getState().importPhase).toBe("running");

    act(() => {
      callbacks.get("import-run-snapshot")!({
        payload: { ...running, lifecycle: "finalizing", updatedAtMs: 3 },
      });
    });
    expect(row().getByTestId("status-running")).toBeInTheDocument();
    expect(row().getByText("NII2BIDS")).toBeInTheDocument();
    emit({ type: "subject_start", step: "DCM2NII" });
    expect(row().getByText("NII2BIDS")).toBeInTheDocument();

    act(() => {
      useImportStore.getState().reconcileImportRunSnapshot({
        ...running,
        lifecycle: "completed",
        terminalResult: "completed",
        updatedAtMs: 4,
        subjectOutcomes: running.selectedSubjects.map((subject) => ({
          subject,
          outcome: "committed",
          committed: true,
          readyLockVerified: true,
          rawdataVerified: true,
        })),
      });
    });
    expect(row().getByTestId("status-completed")).toBeInTheDocument();
    expect(row().queryByText("NII2BIDS")).not.toBeInTheDocument();
    emit({ type: "subject_start", step: "DCM2NII" });
    expect(row().getByTestId("status-completed")).toBeInTheDocument();
  });

  it("confirms the exact interrupted run once, disables while pending, and ignores a stale response", async () => {
    let resolveConfirmation!: (snapshot: Record<string, unknown>) => void;
    const confirmation = new Promise<Record<string, unknown>>((resolve) => {
      resolveConfirmation = resolve;
    });
    const interrupted = {
      runId: "interrupted-run",
      lifecycle: "interrupted" as const,
      ownershipGeneration: 1,
      profileId: "profile-1",
      selectedSubjects: ["ONE"],
      createdAtMs: 1,
      updatedAtMs: 2,
      subjectOutcomes: [],
      terminalResult: "interrupted" as const,
      confirmationRequired: true,
    };
    useProjectStore.setState({
      project: projectView(projectFixture("project-1", "Project", "/project")),
      loaded: true,
      saveProject: vi.fn().mockResolvedValue(undefined),
    });
    activateProjectLease("project-1", "/project");
    useImportStore.getState().bindImportRunSnapshot(interrupted);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run") return null;
      if (command === "read_import_status") return [];
      if (command === "confirm_import_worker_stopped") return confirmation;
      return undefined;
    });
    const user = userEvent.setup();
    const execution = renderExecution();

    const confirm = await screen.findByTestId("confirm-import-stopped-btn");
    await user.click(confirm);
    expect(invoke).toHaveBeenCalledWith("confirm_import_worker_stopped", {
      runId: "interrupted-run",
    });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "confirm_import_worker_stopped"),
    ).toHaveLength(1);

    execution.unmount();
    renderExecution();
    await user.click(await screen.findByTestId("confirm-import-stopped-btn"));
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "confirm_import_worker_stopped"),
    ).toHaveLength(1);

    // A project replacement makes the pending response stale. It must neither
    // replace the new terminal authority nor acknowledge either run.
    useImportStore.setState({
      importPhase: "interrupted",
      terminalRunId: "replacement-run",
      confirmationRequired: true,
    });
    useProjectStore.setState({
      project: projectView(projectFixture("project-2", "Project 2", "/project-2")),
    });
    activateProjectLease("project-2", "/project-2");
    resolveConfirmation({ ...interrupted, confirmationRequired: false, updatedAtMs: 3 });

    await vi.waitFor(() => expect(useImportStore.getState().terminalRunId).toBe("replacement-run"));
    expect(invoke).not.toHaveBeenCalledWith("acknowledge_import_run", expect.anything());
  });

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
      project: projectView(projectFixture("project-1", "Project", "/project")),
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
      project: projectView(projectFixture("project-1", "Project", "/project")),
      loaded: true,
      saveProject: vi.fn().mockResolvedValue(undefined),
    });
    activateProjectLease("project-1", "/project");
    const reconciled = {
      ...projectFixture("project-1", "Project", "/project"),
      acceptedRevision: 1,
      persistedRevision: 1,
    };
    reconciled.document.uiState.import = {
      mostRecentConfig: null,
      completed: true,
      currentPhase: "completed",
    };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run" || command === "attach_import_run") return completed;
      if (command === "get_project_snapshot" || command === "reconcile_import_result")
        return reconciled;
      return undefined;
    });

    renderExecution();

    expect(await screen.findByTestId("import-terminal-summary")).toBeInTheDocument();
    expect(screen.getByTestId("import-terminal-summary")).toHaveTextContent("Committed: 1");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("reconcile_import_result", {
        runId: "replayed-run",
        generation: 1,
      }),
    );
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => /relocat|move|clean|post.?process/i.test(command)),
    ).toBe(false);
    expect(useProjectStore.getState().project?.uiState.import?.completed).toBe(true);
    expect(useImportStore.getState().terminalRunId).toBeNull();
  });

  it("blocks Start and shows actionable discovery failures", async () => {
    useProjectStore.setState({
      project: projectView(projectFixture("project-1", "Project", "/project")),
      loaded: true,
    });
    activateProjectLease("project-1", "/project");
    const error = new Error("native unavailable");
    vi.mocked(invoke).mockRejectedValue(error);

    renderExecution();

    expect(await screen.findByTestId("import-discovery-error")).toHaveTextContent(
      "native unavailable",
    );
    expect(screen.getByTestId("start-import-btn")).toBeDisabled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[import] Run discovery failed",
      {
        operation: "get_active_import_run",
        runId: null,
        phase: "idle",
        projectGeneration: 1,
      },
      error,
    );
  });

  it.each([
    "plan_import_relocation",
    "reserve_import_run",
    "setup_import_listeners",
    "attach_import_run",
    "launch_import_run",
  ])("logs rejected %s once without request data", async (operation) => {
    const configured = projectFixture("project-1", "Project", "/project", {
      mappingState: {
        subjectRows: [{ id: "ONE/01", subject: "ONE", session: "01", groupId: "global" }],
      },
      uiState: { import: { mostRecentConfig: null, selectedProfileId: processingProfile.id } },
    });
    useProjectStore.setState({
      project: projectView(configured),
      loaded: true,
      saveProject: vi.fn().mockResolvedValue(undefined),
    });
    activateProjectLease("project-1", "/project");
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [processingProfile] },
      profileValidationState: { [processingProfile.id]: { valid: true, errors: [] } },
    });
    const run = {
      runId: "new-run",
      lifecycle: "preparing",
      ownershipGeneration: 1,
      profileId: processingProfile.id,
      selectedSubjects: ["ONE"],
      createdAtMs: 1,
      updatedAtMs: 2,
      subjectOutcomes: [],
      confirmationRequired: false,
    };
    const error = new Error("IPC unavailable");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === operation) throw error;
      if (command === "get_active_import_run") return null;
      if (command === "read_import_status") return [];
      if (command === "plan_import_relocation")
        return { planId: "plan", subjects: [], fingerprint: "fingerprint" };
      return run;
    });
    renderExecution();
    await vi.waitFor(() => expect(screen.getByTestId("start-import-btn")).toBeEnabled());
    if (operation === "setup_import_listeners") vi.mocked(listen).mockRejectedValueOnce(error);
    await userEvent.click(screen.getByTestId("start-import-btn"));
    expect(await screen.findByTestId("import-run-error")).toHaveTextContent(error.message);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[import] Start request failed",
      {
        operation,
        runId: ["plan_import_relocation", "reserve_import_run"].includes(operation)
          ? null
          : run.runId,
        phase: ["plan_import_relocation", "reserve_import_run"].includes(operation)
          ? "idle"
          : "preparing",
        projectGeneration: 1,
      },
      error,
    );
  });

  it.each(["stop", "confirm"])(
    "logs rejected import %s once with original error",
    async (action) => {
      const run = {
        runId: "attached-run",
        lifecycle: action === "stop" ? "running" : "interrupted",
        ownershipGeneration: 1,
        profileId: "profile-1",
        selectedSubjects: ["ONE"],
        createdAtMs: 1,
        updatedAtMs: 2,
        subjectOutcomes: [],
        ...(action === "confirm"
          ? { terminalResult: "interrupted", confirmationRequired: true }
          : {}),
      };
      const operation = action === "stop" ? "cancel_import_run" : "confirm_import_worker_stopped";
      const error = new Error("IPC unavailable");
      useProjectStore.setState({ project: projectView(projectFixture()), loaded: true });
      activateProjectLease("project-1", "/project");
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === operation) throw error;
        return run;
      });
      renderExecution();
      await screen.findByText(action === "stop" ? "Running" : "Interrupted");
      await userEvent.click(
        screen.getByTestId(action === "stop" ? "stop-import-btn" : "confirm-import-stopped-btn"),
      );
      expect(await screen.findByTestId("import-run-error")).toHaveTextContent(error.message);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        {
          operation,
          runId: run.runId,
          phase: run.lifecycle,
          projectGeneration: 1,
        },
        error,
      );
    },
  );

  it("uses native rerun inventory then reserve-bind-listen-attach-launch with only committed locks preserved", async () => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    const order: string[] = [];
    let finishSave!: () => void;
    let failSave!: (error: Error) => void;
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
      project: projectView(projectFixture("project-1", "Project", "/project")),
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
    const configured = projectFixture("project-1", "Project", "/project");
    configured.document.uiState.import = { mostRecentConfig: null, selectedProfileId: "profile-1" };
    configured.document.mappingState.subjectRows = [
      "COMMITTED",
      "STALE",
      "INVALID",
      "INTERRUPTED",
    ].map((subject) => ({
      id: `${subject}/01`,
      subject,
      session: "01",
      groupId: "global",
    }));
    useProjectStore.setState({ project: projectView(configured) });
    vi.mocked(listen).mockImplementation(async (event) => {
      order.push(`listen:${event}`);
      return () => undefined;
    });
    vi.mocked(invoke).mockImplementation(async (command, params) => {
      if (command === "get_active_import_run") return null;
      if (command === "read_import_status") return [];
      if (command === "save_project") {
        order.push("save");
        await new Promise<void>((resolve, reject) => {
          finishSave = resolve;
          failSave = reject;
        });
        return configured;
      }
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
    await vi.waitFor(() => expect(order).toEqual(["save"]));
    expect(invoke).not.toHaveBeenCalledWith("reserve_import_run", expect.anything());
    failSave(new Error("Storage unavailable"));
    await vi.waitFor(() =>
      expect(useImportStore.getState().importRunError).toBe("Storage unavailable"),
    );
    await userEvent.click(screen.getByTestId("start-import-btn"));
    await vi.waitFor(() => expect(order).toEqual(["save", "save"]));
    finishSave();
    expect(await screen.findByTestId("confirm-reimport-dialog")).toBeInTheDocument();
    expect(await screen.findByTestId("relocation-inventory-STALE")).toHaveTextContent("1 files");
    await userEvent.click(screen.getByTestId("confirm-reimport-confirm"));
    await vi.waitFor(() => expect(order).toEqual(["save", "save", "save"]));
    finishSave();
    await vi.waitFor(() => expect(order).toContain("launch"));
    unsubscribe();

    expect(order).toEqual([
      "save",
      "save",
      "save",
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

  it("waits for durable saving before Parameters navigation and stays on failure", async () => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    const configured = projectFixture("project-1", "Project", "/project");
    useProjectStore.getState().acceptSnapshot(configured);
    activateProjectLease("project-1", "/project");
    let finish!: () => void;
    let fail!: (error: Error) => void;
    let saves = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return configured;
      if (command === "save_project") {
        saves += 1;
        await new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
        return configured;
      }
      return command === "read_import_status" ? [] : null;
    });
    renderExecution();
    await userEvent.click(screen.getByTestId("import-next-params-btn"));
    await vi.waitFor(() => expect(saves).toBe(1));
    expect(screen.queryByTestId("parameters-route")).not.toBeInTheDocument();
    fail(new Error("Storage unavailable"));
    await vi.waitFor(() =>
      expect(useProjectStore.getState().saveError).toBe("Storage unavailable"),
    );
    expect(screen.getByTestId("import-next-params-btn")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("import-next-params-btn"));
    await vi.waitFor(() => expect(saves).toBe(2));
    finish();
    expect(await screen.findByTestId("parameters-route")).toBeInTheDocument();
  });
});

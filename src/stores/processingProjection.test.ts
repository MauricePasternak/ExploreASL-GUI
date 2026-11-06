import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createElement, Fragment } from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { ProcessingRunSnapshotSchema } from "../schemas/processingSchemas";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { processingSnapshot, processingTerminal } from "../test/processingFixtures";
import { renderWithMantine } from "../test/render";
import SubjectSelection from "../components/processing/SubjectSelection";
import PopulationSection from "../components/processing/PopulationSection";
import { useProjectStore } from "./projectStore";
import { useProcessingStore } from "./processingStore";
import { projectProcessingSnapshot } from "../lib/processingEvents";

describe("native processing projection", () => {
  beforeEach(async () => {
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    vi.clearAllMocks();
    useProjectStore.setState({ project: projectView(projectFixture()) });
    activateProjectLease("project-1", "/project");
  });
  afterEach(() => {
    cleanup();
    resetProjectLifecycleForTests();
  });

  it("accepts exact native snapshot without renderer worker or watcher authority", () => {
    expect(ProcessingRunSnapshotSchema.safeParse(processingSnapshot()).success).toBe(true);
  });
  it("rejects same-run stale revisions and foreign roots", () => {
    const store = useProcessingStore.getState();
    store.bindRunSnapshot(processingSnapshot({ lifecycle: "running", revision: 3 }));
    store.reconcileRunSnapshot(processingSnapshot({ revision: 2 }));
    expect(useProcessingStore.getState().processingPhase).toBe("running");
    store.reconcileRunSnapshot(
      processingSnapshot({ revision: 4, projectRoot: "/other", lifecycle: "cancelling" }),
    );
    expect(useProcessingStore.getState().processingPhase).toBe("running");
  });
  it("retains completed subject cells and eligibility throughout a separate Population run", async () => {
    const store = useProcessingStore.getState();
    const subjects = ["170", "172"].map((subject) => ({
      subjectSession: `sub-${subject}_hormoneabsent`,
      subject,
      session: "hormoneabsent",
      hasStructural: true,
      hasASL: true,
      aslRuns: ["1"],
    }));
    store.setAvailableSubjects(subjects);
    const completed = processingTerminal({
      selectedModules: ["structural", "asl"],
      selectedSubjectSessions: subjects.map((subject) => subject.subjectSession),
      expectedTargets: subjects.flatMap(({ subjectSession }) =>
        (["structural", "asl"] as const).map((module) => ({
          module,
          subjectSession,
          run: module === "asl" ? "1" : null,
          complete: true,
        })),
      ),
    });
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "reconcile_processing_result" || command === "get_project_snapshot"
        ? projectFixture()
        : [],
    );
    store.bindRunSnapshot(completed);
    await projectProcessingSnapshot(completed);
    expect(useProcessingStore.getState().terminalRunId).toBeNull();
    // An older Population result must not leak into the new target's progress.
    store.updateSubjectStatus({
      subjectSession: "",
      module: "population",
      status: "complete",
      completedSteps: ["010_CreatePopulationTemplates"],
      locked: false,
    });
    renderWithMantine(
      createElement(
        Fragment,
        null,
        createElement(SubjectSelection),
        createElement(PopulationSection),
      ),
    );
    const expectSubjectsReady = () => {
      expect(screen.getAllByTestId("status-complete")).toHaveLength(4);
      expect(screen.getByTestId("population-eligibility")).toHaveTextContent(
        "2 of 2 sessions ready",
      );
    };
    expectSubjectsReady();
    const population = processingSnapshot({
      runId: "12345678-1234-4234-8234-123456789003",
      selectedModules: ["population"],
      selectedSubjectSessions: [],
      expectedTargets: [{ module: "population", subjectSession: null, run: null, complete: false }],
    });
    act(() => store.bindRunSnapshot(population));
    expectSubjectsReady();
    expect(
      useProcessingStore.getState().subjectStatuses.find((s) => s.module === "population"),
    ).toMatchObject({
      status: "pending",
      completedSteps: [],
      locked: false,
    });
    act(() => {
      store.updateSubjectStatus({
        subjectSession: "",
        module: "population",
        status: "incomplete",
        completedSteps: ["010_CreatePopulationTemplates"],
        locked: true,
      });
      store.reconcileRunSnapshot({
        ...population,
        revision: 2,
        lifecycle: "running",
        executionCommitted: true,
      });
      store.reconcileRunSnapshot({
        ...population,
        revision: 3,
        lifecycle: "finalizing",
        executionCommitted: true,
      });
    });
    expectSubjectsReady();
    expect(
      useProcessingStore.getState().subjectStatuses.find((s) => s.module === "population")?.status,
    ).toBe("incomplete");
    const terminal = processingTerminal({
      ...population,
      lifecycle: "completed",
      revision: 4,
      terminalRevision: 4,
      availableAction: "acknowledge",
      executionCommitted: true,
      populationExecutionCommitted: true,
      terminalSummary: { ...completed.terminalSummary!, populationCompleted: true },
      expectedTargets: population.expectedTargets.map((target) => ({ ...target, complete: true })),
    });
    act(() => store.reconcileRunSnapshot(terminal));
    expectSubjectsReady();
    expect(screen.getByTestId("population-status-complete")).toBeInTheDocument();
    await act(() => projectProcessingSnapshot(terminal));
    expect(useProcessingStore.getState().terminalRunId).toBeNull();
    expectSubjectsReady();
    expect(invoke).toHaveBeenLastCalledWith("reconcile_processing_result", {
      generation: 1,
      runId: population.runId,
      terminalRevision: 4,
    });
    act(() => store.hydrateProcessing());
    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });
  it("still resets selected subject-run evidence instead of retaining stale completion", async () => {
    const store = useProcessingStore.getState();
    const target = {
      module: "asl" as const,
      subjectSession: "sub-001_01",
      run: "1",
      complete: true,
    };
    const completed = processingTerminal({ selectedModules: ["asl"], expectedTargets: [target] });
    vi.mocked(invoke).mockResolvedValueOnce(projectFixture());
    store.bindRunSnapshot(completed);
    await projectProcessingSnapshot(completed);
    store.updateSubjectStatus({
      subjectSession: target.subjectSession,
      module: "asl",
      run: "01",
      status: "complete",
      completedSteps: ["old-step"],
      locked: false,
    });
    const rerun = processingSnapshot({
      runId: "12345678-1234-4234-8234-123456789004",
      selectedModules: ["asl"],
      expectedTargets: [{ ...target, complete: false }],
    });
    store.bindRunSnapshot(rerun);
    expect(useProcessingStore.getState().subjectStatuses).toEqual([
      {
        subjectSession: target.subjectSession,
        module: "asl",
        run: "1",
        status: "pending",
        completedSteps: [],
        locked: false,
      },
    ]);
    store.reconcileRunSnapshot({
      ...rerun,
      revision: 2,
      executionCommitted: true,
      expectedTargets: [target],
    });
    expect(useProcessingStore.getState().subjectStatuses[0].status).toBe("complete");
  });
  it("refreshes native Population metadata only on accepted execution commit, not progress", async () => {
    const accepted = projectFixture();
    accepted.document.uiState.processing = { population: { completed: true } };
    useProjectStore.getState().acceptSnapshot(accepted);
    const store = useProcessingStore.getState();
    store.bindRunSnapshot(processingSnapshot({ selectedModules: ["population"] }));
    expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
      true,
    );
    await projectProcessingSnapshot(processingSnapshot({ revision: 2 }));
    expect(invoke).not.toHaveBeenCalled();
    const committed = projectFixture();
    committed.acceptedRevision = 1;
    committed.document.uiState.processing = { population: { completed: false } };
    vi.mocked(invoke).mockResolvedValueOnce(committed);
    await projectProcessingSnapshot(
      processingSnapshot({
        revision: 3,
        selectedModules: ["population"],
        populationExecutionCommitted: true,
        executionCommitted: true,
      }),
    );
    expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
      false,
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("get_project_snapshot", { generation: 1 });
  });
});

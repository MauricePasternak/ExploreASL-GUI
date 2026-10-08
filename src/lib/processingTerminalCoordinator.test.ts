import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { processingTerminal } from "../test/processingFixtures";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";
import { reconcileProcessingTerminal } from "./processingTerminalCoordinator";

const realSave = useProjectStore.getState().saveProject;
beforeEach(async () => {
  resetProjectLifecycleForTests();
  await useProcessingStore.getState().resetProcessing();
  useProjectStore.setState({
    project: projectView(projectFixture()),
    saveProject: vi.fn().mockResolvedValue(undefined),
  });
  activateProjectLease("project-1", "/project");
  vi.mocked(invoke).mockResolvedValue(projectFixture());
});
afterEach(() => {
  useProjectStore.setState({ saveProject: realSave });
  resetProjectLifecycleForTests();
  vi.clearAllMocks();
});

describe("processing terminal persistence", () => {
  it("saves accepted native Population versions and mtime before exact acknowledgement", async () => {
    const snapshot = processingTerminal({
      selectedModules: ["population"],
      populationExecutionCommitted: true,
      populationReadyMtimeMs: 1700000060000,
      terminalSummary: {
        result: "completed",
        executionCommitted: true,
        populationCompleted: true,
        profileId: "profile-native",
        exploreAslVersion: "1.2.3",
      },
    });
    useProcessingStore.getState().bindRunSnapshot(snapshot);
    let release!: () => void;
    const accepted = projectFixture();
    accepted.document.uiState.processing = {
      population: {
        completed: true,
        lastRun: {
          profileId: "profile-native",
          exploreASLVersion: "1.2.3",
          matlabVersion: "R2024a",
          guiVersion: "2.0.0",
          Mtime: 1700000060000,
        },
      },
    };
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(accepted);
        }),
    );
    const saving = reconcileProcessingTerminal();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "acknowledge_processing_run"),
    ).toBe(false);
    expect(useProjectStore.getState().project?.uiState.processing?.population).toBeUndefined();
    release();
    await saving;
    expect(useProjectStore.getState().project?.uiState.processing?.population).toMatchObject({
      completed: true,
      lastRun: {
        profileId: "profile-native",
        exploreASLVersion: "1.2.3",
        matlabVersion: "R2024a",
        guiVersion: "2.0.0",
        Mtime: 1700000060000,
      },
    });
    expect(invoke).toHaveBeenCalledWith("reconcile_processing_result", {
      generation: 1,
      runId: snapshot.runId,
      terminalRevision: 5,
    });
    expect(useProcessingStore.getState().terminalRunId).toBeNull();
  });
  it.each(["save", "acknowledgement"])(
    "retains terminal authority and retries after %s failure",
    async (stage) => {
      const terminal = processingTerminal();
      useProcessingStore.getState().bindRunSnapshot(terminal);
      vi.mocked(invoke).mockRejectedValueOnce(new Error(`${stage} failed`));
      await expect(reconcileProcessingTerminal()).rejects.toThrow();
      expect(useProcessingStore.getState()).toMatchObject({
        terminalRunId: terminal.runId,
        availableAction: "acknowledge",
        processingPhase: "completed",
      });
      expect(useProcessingStore.getState().processingError).toContain(stage);
      if (stage === "save")
        expect(invoke).not.toHaveBeenCalledWith("acknowledge_processing_run", expect.anything());
      await reconcileProcessingTerminal();
      expect(useProcessingStore.getState().terminalRunId).toBeNull();
    },
  );
  it("drops overlapping replay cache updates after project replacement", async () => {
    useProcessingStore.getState().bindRunSnapshot(processingTerminal());
    let release!: () => void;
    const releases: (() => void)[] = [];
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve(projectFixture()));
          release = () => releases.forEach((resolve) => resolve());
        }),
    );
    const first = reconcileProcessingTerminal();
    const second = reconcileProcessingTerminal();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    invalidateProjectLease();
    release();
    await Promise.all([first, second]);
    expect(invoke).not.toHaveBeenCalledWith("acknowledge_processing_run", expect.anything());
    expect(useProcessingStore.getState().terminalRunId).not.toBeNull();
  });
});

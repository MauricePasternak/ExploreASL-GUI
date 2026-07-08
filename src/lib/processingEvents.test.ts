import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { mapModuleName, runProcessingPipeline, setupProcessingListeners } from "./processingEvents";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";
import type { ProcessConfig } from "../schemas/processingSchemas";
import type { ExecutionProfile } from "../schemas/executionProfile";

const MATLAB_PROFILE: ExecutionProfile = {
  id: "profile-1",
  type: "matlab",
  label: "MATLAB R2023b",
  matlabPath: "/usr/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([1234]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("mapModuleName", () => {
  it("maps xASL_module_Structural to structural", () => {
    expect(mapModuleName("xASL_module_Structural")).toBe("structural");
  });

  it("maps xASL_module_ASL to asl", () => {
    expect(mapModuleName("xASL_module_ASL")).toBe("asl");
  });

  it("maps xASL_module_Population to population", () => {
    expect(mapModuleName("xASL_module_Population")).toBe("population");
  });

  it("returns structural for lowercase structural", () => {
    expect(mapModuleName("structural")).toBe("structural");
  });

  it("returns asl for lowercase asl", () => {
    expect(mapModuleName("asl")).toBe("asl");
  });

  it("returns population for lowercase population", () => {
    expect(mapModuleName("population")).toBe("population");
  });

  it("returns undefined for unknown module name", () => {
    expect(mapModuleName("unknown_module")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(mapModuleName("")).toBeUndefined();
  });
});

describe("runProcessingPipeline worker capping", () => {
  const baseConfig: ProcessConfig = {
    subjects: ["sub-001_01", "sub-002_01"],
    modules: ["structural"],
    selectedProfileId: "profile-1",
    workers: 4,
  };

  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    useProjectStore.setState({
      project: {
        projectMeta: {
          rootPath: "/test/project_root",
        },
      } as any,
    });
  });

  it("throws an error if no project is loaded", async () => {
    useProjectStore.setState({ project: null });
    await expect(runProcessingPipeline(baseConfig, MATLAB_PROFILE)).rejects.toThrow(
      "No project loaded",
    );
  });

  it("passes the typed execution profile to run_pipeline", async () => {
    await runProcessingPipeline(baseConfig, MATLAB_PROFILE);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        executionProfile: MATLAB_PROFILE,
      }),
    );
  });

  it("caps workers to subjects length when workers exceed selected subjects", async () => {
    const config = {
      ...baseConfig,
      subjects: ["sub-001_01", "sub-002_01"], // 2 subjects
      workers: 4, // 4 workers
    };

    await runProcessingPipeline(config, MATLAB_PROFILE);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        workers: 2, // Capped to subjects length
      }),
    );
  });

  it("does not cap workers when workers are less than selected subjects", async () => {
    const config = {
      ...baseConfig,
      subjects: ["sub-001_01", "sub-002_01", "sub-003_01"], // 3 subjects
      workers: 2, // 2 workers
    };

    await runProcessingPipeline(config, MATLAB_PROFILE);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        workers: 2, // Keeps configured worker count
      }),
    );
  });

  it("keeps configured workers when subjects list is empty", async () => {
    const config = {
      ...baseConfig,
      subjects: [], // empty subjects list
      workers: 4,
    };

    await runProcessingPipeline(config, MATLAB_PROFILE);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        workers: 4, // Keeps 4
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Population completion — mtime capture
// ---------------------------------------------------------------------------

describe("population completion mtime capture", () => {
  const COMPLETED_POPULATION_STATUS = {
    subjectSession: "sub-001_01",
    module: "xASL_module_Population",
    status: "complete",
    completedSteps: ["999_ready"],
    locked: false,
  };

  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(listen).mockClear();

    // Set up invoke mock for all commands called during completion
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "stop_watch_lock_dir") return Promise.resolve(undefined);
      if (cmd === "clear_stale_locks") return Promise.resolve(undefined);
      if (cmd === "read_lock_status") return Promise.resolve([COMPLETED_POPULATION_STATUS]);
      if (cmd === "read_population_ready_mtime") return Promise.resolve(1700000000000);
      return Promise.resolve([1234]);
    });

    // Set up project store with setLastPopulationRunMtime
    useProjectStore.setState({
      project: {
        projectMeta: {
          rootPath: "/test/project_root",
        },
      } as any,
    });

    // Set up processing store with population config and empty worker list
    useProcessingStore.setState({
      config: {
        subjects: [],
        modules: ["population"],
        selectedProfileId: "profile-1",
        workers: 1,
      } as any,
      workerPids: [] as number[],
      processingPhase: "running" as any,
      subjectStatuses: [] as any[],
    });
  });

  afterEach(() => {
    useProcessingStore.setState({
      config: null,
      workerPids: [],
      processingPhase: "idle" as any,
      subjectStatuses: [],
    });
    useProjectStore.setState({ project: null });
  });

  it("calls read_population_ready_mtime after all workers exit with population completion", async () => {
    // Capture the WorkerExited callback from listen
    const listeners: Record<string, (event: any) => void> = {};
    vi.mocked(listen).mockImplementation(async (eventName: string, callback: any) => {
      listeners[eventName] = callback;
      return () => {};
    });

    await setupProcessingListeners();

    // Verify listener was registered
    expect(listen).toHaveBeenCalledWith("WorkerExited", expect.any(Function));

    // Set a worker PID that will be removed
    useProcessingStore.setState({ workerPids: [99] });

    // Trigger WorkerExited for the last worker
    const workerExitedCb = listeners["WorkerExited"];
    expect(workerExitedCb).toBeDefined();

    await workerExitedCb({
      payload: { pid: 99, exitCode: 0 },
    });

    expect(invoke).toHaveBeenCalledWith("read_population_ready_mtime", {
      projectRoot: "/test/project_root",
    });

    expect(
      useProjectStore.getState().project?.uiState?.processing?.population?.lastRun?.Mtime,
    ).toBe(1700000000000);
  });

  it("falls back to null when read_population_ready_mtime throws", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "read_population_ready_mtime") return Promise.reject(new Error("fs error"));
      if (cmd === "stop_watch_lock_dir") return Promise.resolve(undefined);
      if (cmd === "clear_stale_locks") return Promise.resolve(undefined);
      if (cmd === "read_lock_status") return Promise.resolve([COMPLETED_POPULATION_STATUS]);
      return Promise.resolve([1234]);
    });

    const listeners: Record<string, (event: any) => void> = {};
    vi.mocked(listen).mockImplementation(async (eventName: string, callback: any) => {
      listeners[eventName] = callback;
      return () => {};
    });

    // Re-setup with the new invoke mock
    useProcessingStore.setState({
      config: {
        subjects: [],
        modules: ["population"],
        selectedProfileId: "profile-1",
        workers: 1,
      } as any,
      workerPids: [99],
      processingPhase: "running" as any,
      subjectStatuses: [],
    });

    await setupProcessingListeners();

    const workerExitedCb = listeners["WorkerExited"];
    await workerExitedCb({ payload: { pid: 99, exitCode: 0 } });

    expect(
      useProjectStore.getState().project?.uiState?.processing?.population?.lastRun?.Mtime,
    ).toBeNull();
  });
});

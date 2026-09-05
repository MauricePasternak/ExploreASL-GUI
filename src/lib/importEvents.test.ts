import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import {
  copyLockFilesForRetry,
  decodeImportPipelineError,
  setupImportListeners,
  type ImportStructuredEventPayload,
} from "./importEvents";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";

type EventHandler = (event: { payload: unknown }) => void;

const handlers: Record<string, EventHandler> = {};
const RUN_REQUEST_ID = "run-request-a";
const OWNERSHIP_GENERATION = 1;

function emitStructured(
  payload: Omit<ImportStructuredEventPayload, "runRequestId" | "ownershipGeneration">,
  runRequestId = RUN_REQUEST_ID,
  ownershipGeneration = OWNERSHIP_GENERATION,
) {
  handlers["import-structured-event"]?.({
    payload: { ...payload, runRequestId, ownershipGeneration },
  });
}

function emitRaw(
  line: string,
  runRequestId = RUN_REQUEST_ID,
  ownershipGeneration = OWNERSHIP_GENERATION,
) {
  handlers["import-raw-event"]?.({ payload: { line, runRequestId, ownershipGeneration } });
}

function emitPrepareComplete(
  runRequestId = RUN_REQUEST_ID,
  ownershipGeneration = OWNERSHIP_GENERATION,
) {
  handlers.ImportPrepareComplete?.({ payload: { runRequestId, ownershipGeneration } });
}

function emitMatlabExitError(
  exitCode: number,
  runRequestId = RUN_REQUEST_ID,
  ownershipGeneration = OWNERSHIP_GENERATION,
) {
  handlers.MatlabExitError?.({ payload: { exitCode, runRequestId, ownershipGeneration } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectLifecycleForTests();
  activateProjectLease("project-a", "/tmp/project");
  useImportStore.getState().resetImport();
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      import: { preserveStagingDir: true },
      executionProfiles: [
        {
          id: "profile-1",
          type: "matlab",
          label: "MATLAB R2023b",
          matlabPath: "/usr/local/bin/matlab",
          exploreAslPath: "/opt/ExploreASL",
        },
      ],
    },
    profileValidationState: { "profile-1": { valid: true, errors: [] } },
  });
  useImportStore.setState({ selectedProfileId: "profile-1" });

  Object.keys(handlers).forEach((key) => delete handlers[key]);

  vi.mocked(listen).mockImplementation(async (event, handler) => {
    handlers[event] = handler as EventHandler;
    return () => {};
  });

  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "run_import_pipeline":
        return 12345;
      default:
        return null;
    }
  });
});

afterEach(() => {
  resetProjectLifecycleForTests();
  useImportStore.getState().resetImport();
});

describe("setupImportListeners", () => {
  it("rejects stale structured events and queued raw log batches", async () => {
    vi.useFakeTimers();
    useImportStore.getState().startImport();
    await setupImportListeners(RUN_REQUEST_ID);
    emitRaw("project A log");

    invalidateProjectLease();
    activateProjectLease("project-b", "/tmp/project-b");
    emitStructured({ type: "subject_start", subject: "GOOD" });
    vi.advanceTimersByTime(16);

    expect(useImportStore.getState().importLog).toEqual([]);
    expect(useImportStore.getState().importProgress.GOOD).toBeUndefined();
    vi.useRealTimers();
  });

  it("abandons listener setup that resolves after project replacement", async () => {
    let resolveFirst!: (unlisten: () => void) => void;
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const setup = setupImportListeners(RUN_REQUEST_ID);
    invalidateProjectLease();
    activateProjectLease("project-b", "/tmp/project-b");
    resolveFirst(unlisten);
    await setup;

    expect(unlisten).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("rejects queued events from a same-project rerun before they bind a generation", async () => {
    const prepareHandlers: EventHandler[] = [];
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === "ImportPrepareComplete") prepareHandlers.push(handler as EventHandler);
      return () => {};
    });
    useImportStore.getState().startImport();

    await setupImportListeners("run-old");
    await setupImportListeners("run-new");

    prepareHandlers[0]?.({
      payload: { runRequestId: "run-old", ownershipGeneration: 1 },
    });
    expect(useImportStore.getState().importPhase).toBe("preparing");

    prepareHandlers[1]?.({
      payload: { runRequestId: "run-new", ownershipGeneration: 2 },
    });
    expect(useImportStore.getState().importPhase).toBe("running");
  });

  it("fails closed for missing, mismatched, and changed event correlation", async () => {
    useImportStore.getState().startImport();
    await setupImportListeners(RUN_REQUEST_ID);

    handlers.ImportPrepareComplete?.({ payload: {} });
    emitStructured({ type: "subject_start", subject: "OLD" }, "old-request", 1);
    emitRaw("old output", "old-request", 1);
    emitMatlabExitError(1, "old-request", 1);
    expect(useImportStore.getState().importPhase).toBe("preparing");
    expect(useImportStore.getState().importProgress.OLD).toBeUndefined();
    expect(useImportStore.getState().importLog).toEqual([]);

    emitRaw("current output", RUN_REQUEST_ID, 7);
    emitStructured({ type: "subject_start", subject: "WRONG_GENERATION" }, RUN_REQUEST_ID, 8);
    emitPrepareComplete(RUN_REQUEST_ID, 7);

    expect(useImportStore.getState().importPhase).toBe("running");
    expect(useImportStore.getState().importProgress.WRONG_GENERATION).toBeUndefined();
  });

  it("stops late post-processing before moving output or mutating the replacement project", async () => {
    useImportStore.getState().startImport();
    useImportStore.getState().markSubjectFailed("BAD", "NII2BIDS", "bad metadata");
    let releaseClean!: () => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "clean_import_status") {
        await new Promise<void>((resolve) => {
          releaseClean = resolve;
        });
      }
      return null;
    });
    await setupImportListeners(RUN_REQUEST_ID);

    emitStructured({ type: "import_complete" });
    await vi.waitFor(() => expect(releaseClean).toBeTypeOf("function"));
    invalidateProjectLease();
    activateProjectLease("project-b", "/tmp/project-b");
    useImportStore.getState().resetImport();
    releaseClean();
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalledWith("move_import_output", expect.anything());
    expect(useImportStore.getState()).toMatchObject({
      importPhase: "idle",
      importSummary: null,
      importProgress: {},
    });
  });
  it("maps structured events to import store actions", async () => {
    useImportStore.getState().startImport();
    await setupImportListeners(RUN_REQUEST_ID);

    emitStructured({ type: "subject_start", subject: "GOOD" });
    expect(useImportStore.getState().importProgress.GOOD.status).toBe("running");

    emitStructured({ type: "subject_complete", subject: "GOOD", duration_secs: 42 });
    expect(useImportStore.getState().importProgress.GOOD).toMatchObject({
      status: "completed",
      duration: 42,
    });

    emitStructured({
      type: "import_failed",
      subject: "BADDIE",
      step: "NII2BIDS",
      message: "LabelingDuration has invalid value",
    });
    expect(useImportStore.getState().importProgress.BADDIE).toMatchObject({
      status: "failed",
      errorStep: "NII2BIDS",
      error: "LabelingDuration has invalid value",
    });
    expect(useImportStore.getState().failedSubjects).toEqual(["BADDIE"]);
  });

  it("accumulates raw log lines and transitions preparing to running", async () => {
    vi.useFakeTimers();
    useImportStore.getState().setImportPhase("preparing");
    await setupImportListeners(RUN_REQUEST_ID);

    emitRaw("ExploreASL import started");
    vi.advanceTimersByTime(16);

    expect(useImportStore.getState().importLog).toEqual(["ExploreASL import started"]);

    emitPrepareComplete();
    expect(useImportStore.getState().importPhase).toBe("running");

    vi.useRealTimers();
  });

  it("flushes section dividers immediately without waiting for rAF", async () => {
    vi.useFakeTimers();
    useImportStore.getState().startImport();
    const cleanup = await setupImportListeners(RUN_REQUEST_ID);

    emitRaw(
      "[ ======================================== ExploreASL Settings ==================================]",
    );
    expect(useImportStore.getState().importLog).toEqual([
      "[ ======================================== ExploreASL Settings ==================================]",
    ]);

    emitRaw("some regular line");
    expect(useImportStore.getState().importLog).toEqual([
      "[ ======================================== ExploreASL Settings ==================================]",
    ]);

    vi.advanceTimersByTime(16);
    expect(useImportStore.getState().importLog).toEqual([
      "[ ======================================== ExploreASL Settings ==================================]",
      "some regular line",
    ]);

    cleanup();
    vi.useRealTimers();
  });

  it("flushes remaining buffered lines on cleanup", async () => {
    vi.useFakeTimers();
    useImportStore.getState().startImport();
    const cleanup = await setupImportListeners(RUN_REQUEST_ID);

    emitRaw("buffered line 1");
    emitRaw("buffered line 2");

    expect(useImportStore.getState().importLog).toEqual([]);

    cleanup();

    expect(useImportStore.getState().importLog).toEqual(["buffered line 1", "buffered line 2"]);
    vi.useRealTimers();
  });

  it("runs post-processing on import_complete with partial success", async () => {
    useImportStore.getState().startImport();
    useImportStore.getState().markSubjectCompleted("GOOD", 10);
    useImportStore.getState().markSubjectFailed("BADDIE", "NII2BIDS", "Bad metadata");

    await setupImportListeners(RUN_REQUEST_ID);

    emitStructured({ type: "import_complete" });
    await vi.waitFor(() => {
      expect(useImportStore.getState().importPhase).toBe("failed");
    });

    expect(vi.mocked(invoke).mock.calls).toEqual(
      expect.arrayContaining([
        ["clean_import_status", {}],
        [
          "move_import_output",
          {
            debugMode: true,
            cleanupStaging: false,
          },
        ],
      ]),
    );
  });

  it("runs post-processing on import_complete with full success using subject-scoped merge", async () => {
    useImportStore.getState().startImport();
    useImportStore.getState().markSubjectCompleted("GOOD", 10);
    useImportStore.getState().markSubjectCompleted("BADDIE", 20);

    await setupImportListeners(RUN_REQUEST_ID);

    vi.mocked(invoke).mockClear();
    emitStructured({ type: "import_complete" });
    await vi.waitFor(() => {
      expect(useImportStore.getState().importPhase).toBe("completed");
    });

    expect(vi.mocked(invoke).mock.calls).toEqual(
      expect.arrayContaining([
        [
          "move_import_output",
          {
            debugMode: true,
            cleanupStaging: true,
          },
        ],
      ]),
    );
    expect(vi.mocked(invoke).mock.calls.some((call) => call[0] === "clean_import_status")).toBe(
      false,
    );
  });

  it("marks running subjects failed and post-processes on MatlabExitError", async () => {
    useImportStore.getState().startImport();
    useImportStore.getState().setImportPhase("running");
    useImportStore.getState().markSubjectRunning("GOOD");
    useImportStore.getState().markSubjectCompleted("DONE", 5);

    await setupImportListeners(RUN_REQUEST_ID);

    emitMatlabExitError(1);
    await vi.waitFor(() => {
      expect(useImportStore.getState().importProgress.GOOD.status).toBe("failed");
    });

    expect(useImportStore.getState().importProgress.GOOD.error).toBe(
      "MATLAB process exited unexpectedly",
    );
    expect(useImportStore.getState().importProgress.DONE.status).toBe("completed");
  });

  it("marks pending subjects failed and sets importPhase to failed on MatlabExitError during initialization", async () => {
    useImportStore.setState({
      subjectRows: [
        { id: "GOOD/01", subject: "GOOD", session: "01", groupId: "global-defaults" },
        {
          id: "PENDING_SUBJ/01",
          subject: "PENDING_SUBJ",
          session: "01",
          groupId: "global-defaults",
        },
      ],
    });
    useImportStore.getState().startImport();
    useImportStore.getState().setImportPhase("running");
    // All subjects are still in "pending" status on initialization failure

    await setupImportListeners(RUN_REQUEST_ID);

    emitMatlabExitError(1);
    await vi.waitFor(() => {
      expect(useImportStore.getState().importProgress.GOOD.status).toBe("failed");
      expect(useImportStore.getState().importProgress.PENDING_SUBJ.status).toBe("failed");
    });

    await vi.waitFor(() => {
      expect(useImportStore.getState().importPhase).toBe("failed");
    });

    expect(useImportStore.getState().importProgress.GOOD.error).toBe(
      "MATLAB process exited unexpectedly",
    );
    expect(useImportStore.getState().importProgress.PENDING_SUBJ.error).toBe(
      "MATLAB process exited unexpectedly",
    );
  });
});

describe("copyLockFilesForRetry", () => {
  it("invokes copy_lock_files when retry subjects are provided", async () => {
    await copyLockFilesForRetry({
      subjects: ["GOOD"],
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("copy_lock_files", {
      subjects: ["GOOD"],
    });
    const copyPayload = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === "copy_lock_files")?.[1] as Record<
      string,
      unknown
    >;
    expect(copyPayload).not.toHaveProperty("projectRoot");
    expect(copyPayload).not.toHaveProperty("stagingRoot");
  });

  it("skips invoke when there are no retry subjects", async () => {
    vi.mocked(invoke).mockClear();

    await copyLockFilesForRetry({
      subjects: [],
    });

    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});

describe("decodeImportPipelineError", () => {
  it("keeps structured preflight issues for current Rust command failures", () => {
    expect(
      decodeImportPipelineError({
        kind: "preflight",
        issues: [
          { code: "PORTABLE_COLLISION", field: "subject", entryIndex: 1, message: "collision" },
        ],
      }),
    ).toMatchObject({
      kind: "preflight",
      issues: [{ code: "PORTABLE_COLLISION", entryIndex: 1 }],
    });
  });

  it("falls back to legacy string operational errors", () => {
    expect(decodeImportPipelineError("legacy import failed")).toEqual({
      kind: "operational",
      message: "legacy import failed",
    });
  });
});

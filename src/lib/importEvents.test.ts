import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import {
  copyLockFilesForRetry,
  setupImportListeners,
  type ImportStructuredEventPayload,
} from "./importEvents";

type EventHandler = (event: { payload: unknown }) => void;

const handlers: Record<string, EventHandler> = {};

function emitStructured(payload: ImportStructuredEventPayload) {
  handlers["import-structured-event"]?.({ payload });
}

function emitRaw(line: string) {
  handlers["import-raw-event"]?.({ payload: { line } });
}

function emitPrepareComplete() {
  handlers.ImportPrepareComplete?.({ payload: {} });
}

function emitMatlabExitError(exitCode: number) {
  handlers.MatlabExitError?.({ payload: { exitCode } });
}

beforeEach(() => {
  useImportStore.getState().resetImport();
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      import: { preserveStagingDir: true },
    },
  });

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
  useImportStore.getState().resetImport();
});

describe("setupImportListeners", () => {
  it("maps structured events to import store actions", async () => {
    useImportStore.getState().startImport();
    await setupImportListeners("/tmp/project/.easl_staging", "/tmp/project", [
      "GOOD",
      "BADDIE",
    ]);

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
    await setupImportListeners("/tmp/project/.easl_staging", "/tmp/project", ["GOOD"]);

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
    const cleanup = await setupImportListeners("/tmp/project/.easl_staging", "/tmp/project", ["GOOD"]);

    emitRaw("[ ======================================== ExploreASL Settings ==================================]");
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
    const cleanup = await setupImportListeners("/tmp/project/.easl_staging", "/tmp/project", ["GOOD"]);

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

    await setupImportListeners("/tmp/project/.easl_staging", "/tmp/project", [
      "GOOD",
      "BADDIE",
    ]);

    emitStructured({ type: "import_complete" });
    await vi.waitFor(() => {
      expect(useImportStore.getState().importPhase).toBe("failed");
    });

    expect(vi.mocked(invoke).mock.calls).toEqual(
      expect.arrayContaining([
        [
          "clean_import_status",
          {
            stagingRoot: "/tmp/project/.easl_staging",
            subjects: ["BADDIE"],
          },
        ],
        [
          "move_import_output",
          {
            stagingRoot: "/tmp/project/.easl_staging",
            projectRoot: "/tmp/project",
            succeededSubjects: ["GOOD"],
            debugMode: true,
          },
        ],
      ]),
    );
  });

  it("marks running subjects failed and post-processes on MatlabExitError", async () => {
    useImportStore.getState().startImport();
    useImportStore.getState().setImportPhase("running");
    useImportStore.getState().markSubjectRunning("GOOD");
    useImportStore.getState().markSubjectCompleted("DONE", 5);

    await setupImportListeners("/tmp/project/.easl_staging", "/tmp/project", [
      "GOOD",
      "DONE",
    ]);

    emitMatlabExitError(1);
    await vi.waitFor(() => {
      expect(useImportStore.getState().importProgress.GOOD.status).toBe("failed");
    });

    expect(useImportStore.getState().importProgress.GOOD.error).toBe(
      "MATLAB process exited unexpectedly",
    );
    expect(useImportStore.getState().importProgress.DONE.status).toBe("completed");
  });
});

describe("copyLockFilesForRetry", () => {
  it("invokes copy_lock_files when retry subjects are provided", async () => {
    await copyLockFilesForRetry({
      projectRoot: "/tmp/project",
      stagingRoot: "/tmp/project/.easl_staging",
      subjects: ["GOOD"],
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("copy_lock_files", {
      projectRoot: "/tmp/project",
      stagingRoot: "/tmp/project/.easl_staging",
      subjects: ["GOOD"],
    });
  });

  it("skips invoke when there are no retry subjects", async () => {
    vi.mocked(invoke).mockClear();

    await copyLockFilesForRetry({
      projectRoot: "/tmp/project",
      stagingRoot: "/tmp/project/.easl_staging",
      subjects: [],
    });

    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});

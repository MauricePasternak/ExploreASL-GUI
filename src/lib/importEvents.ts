/**
 * Tauri event listener glue for the import module.
 *
 * Bridges Rust backend events → Zustand store actions.
 * Also exposes thin wrappers around Tauri `invoke` for running/stopping the import.
 *
 * Raw log lines are batched before flushing to the store:
 * - Section dividers (e.g. "[ ======...") flush immediately for atomic rendering
 * - All other lines accumulate and flush once per animation frame
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { StagingEntry } from "../schemas/importSchemas";
import type { ExecutionProfile } from "../schemas/executionProfile";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
  type ProjectLease,
} from "./projectLifecycle";

declare global {
  interface Window {
    __IMPORT_CLEANUP__?: () => void;
  }
}

// =============================================================================
// Log batching
// =============================================================================

/**
 * Matches ExploreASL section dividers like:
 *   [ ==============================================================================================]
 *   [ ======================================== ExploreASL Settings ==================================]
 *
 * The character after `[` may be a regular space, non-breaking space (\\u00A0),
 * or other whitespace — the \\s pattern handles all of these.
 * The line must contain 5+ `=` chars to qualify as a divider.
 */
const SECTION_DIVIDER_RE = /^\[\s={5,}/;

type LogFlusher = (lines: string[]) => void;

function createLogBatcher(flusher: LogFlusher) {
  let buffer: string[] = [];
  let rafId: number | null = null;

  function flush() {
    if (buffer.length > 0) {
      flusher([...buffer]);
      buffer = [];
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function push(line: string) {
    buffer.push(line);
    if (SECTION_DIVIDER_RE.test(line)) {
      flush();
    } else if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        flush();
      });
    }
  }

  return { push, flush };
}

// =============================================================================
// Event Payload Types (matching Rust event shapes)
// =============================================================================

export interface ImportStructuredEventPayload {
  type:
    "subject_start" | "subject_complete" | "import_failed" | "import_complete" | "dcm2nii_status";
  subject?: string;
  duration_secs?: number;
  step?: string;
  message?: string;
  exit_code?: number;
}

export interface ImportRawEventPayload {
  line: string;
}

export interface MatlabExitErrorPayload {
  exitCode: number;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Normalise the lowercase step field from Rust to the uppercase enum expected by the store.
 */
function normalizeStep(step?: string): "DCM2NII" | "NII2BIDS" {
  const upper = (step ?? "").toUpperCase();
  if (upper === "DCM2NII") return "DCM2NII";
  return "NII2BIDS";
}

/**
 * Post-processing logic shared by `import_complete` and `MatlabExitError`.
 *
 * 1. Clean up staging status for failed subjects
 * 2. Move successfully imported output to the project root
 * 3. Mark the import as completed or failed in the store
 */
async function runPostProcessing(
  stagingRoot: string,
  projectRoot: string,
  allSubjects: string[],
  isExitError = false,
  lease: ProjectLease | null = captureProjectLease(),
): Promise<void> {
  if (lease && !isCurrentProjectLease(lease)) return;
  const { failedSubjects, completeImport, failImport } = useImportStore.getState();
  const debugMode = useGlobalStore.getState().settings.import.preserveStagingDir;

  // 1. Clean import status for failed subjects
  if (failedSubjects.length > 0) {
    try {
      await invoke("clean_import_status", {
        stagingRoot,
        subjects: failedSubjects,
      });
      if (lease && !isCurrentProjectLease(lease)) return;
    } catch {
      // Best-effort — don't block the rest of post-processing
    }
  }

  // 2. Determine succeeded vs failed
  const succeededSubjects = allSubjects.filter((s) => !failedSubjects.includes(s));
  const allSucceeded = failedSubjects.length === 0 && !isExitError;

  // 3. Move output and update store
  if (succeededSubjects.length > 0) {
    try {
      await invoke("move_import_output", {
        stagingRoot,
        projectRoot,
        succeededSubjects,
        debugMode,
        cleanupStaging: allSucceeded,
      });
      if (lease && !isCurrentProjectLease(lease)) return;
    } catch {
      if (allSucceeded) {
        failImport();
        return;
      }
    }
  }

  if (allSucceeded) {
    completeImport();
  } else {
    failImport();
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Set up all Tauri event listeners for the import pipeline.
 *
 * Returns a cleanup function that removes every listener.
 */
export async function setupImportListeners(
  stagingRoot: string,
  projectRoot: string,
  allSubjects: string[],
): Promise<() => void> {
  const lease = captureProjectLease();
  const isCurrent = () => !lease || isCurrentProjectLease(lease);
  if (typeof window !== "undefined" && window.__IMPORT_CLEANUP__) {
    try {
      window.__IMPORT_CLEANUP__();
    } catch (e) {
      console.warn("Failed to run previous import cleanup:", e);
    }
    window.__IMPORT_CLEANUP__ = undefined;
  }

  const {
    addLogLines,
    setImportPhase,
    markSubjectRunning,
    markSubjectCompleted,
    markSubjectFailed,
  } = useImportStore.getState();

  const logBatcher = createLogBatcher((lines) => {
    if (isCurrent()) addLogLines(lines);
  });
  const unlisteners: Array<() => void> = [];
  const acceptListener = (unlisten: () => void) => {
    if (!isCurrent()) {
      unlisten();
      for (const prior of unlisteners) prior();
      return false;
    }
    unlisteners.push(unlisten);
    return true;
  };

  // 1. import-structured-event
  const unlistenStructured = await listen<ImportStructuredEventPayload>(
    "import-structured-event",
    (event) => {
      if (!isCurrent()) return;
      const payload = event.payload;

      switch (payload.type) {
        case "subject_start":
          if (payload.subject) {
            markSubjectRunning(payload.subject, payload.step as "DCM2NII" | "NII2BIDS");
          }
          break;

        case "subject_complete":
          if (payload.subject) {
            markSubjectCompleted(payload.subject, payload.duration_secs ?? 0);
          }
          break;

        case "import_failed":
          if (payload.subject) {
            markSubjectFailed(
              payload.subject,
              normalizeStep(payload.step),
              payload.message ?? "Unknown error",
            );
          }
          break;

        case "import_complete":
          {
            if (lease && !isProjectWorkAccepted()) break;
            const task = runPostProcessing(stagingRoot, projectRoot, allSubjects, false, lease);
            if (lease) {
              try {
                void registerProjectTask(task);
              } catch {
                // Transition admission closed before post-processing started.
              }
            } else {
              void task;
            }
          }
          break;

        case "dcm2nii_status":
          // Currently informational — no store action needed
          break;
      }
    },
  );
  if (!acceptListener(unlistenStructured)) return () => {};

  // 2. import-raw-event (batched)
  const unlistenRaw = await listen<ImportRawEventPayload>("import-raw-event", (event) => {
    if (!isCurrent()) return;
    logBatcher.push(event.payload.line);
  });
  if (!acceptListener(unlistenRaw)) return () => {};

  // 3. ImportPrepareComplete
  const unlistenPrepare = await listen<Record<string, never>>("ImportPrepareComplete", () => {
    if (!isCurrent()) return;
    setImportPhase("running");
  });
  if (!acceptListener(unlistenPrepare)) return () => {};

  // 4. MatlabExitError
  const unlistenExitError = await listen<MatlabExitErrorPayload>("MatlabExitError", (_event) => {
    if (!isCurrent()) return;
    // Mark all currently-running or pending subjects as failed
    const { importProgress } = useImportStore.getState();
    for (const [subject, progress] of Object.entries(importProgress)) {
      if (progress.status === "running" || progress.status === "pending") {
        markSubjectFailed(subject, "DCM2NII", "MATLAB process exited unexpectedly");
      }
    }

    if (lease && !isProjectWorkAccepted()) return;
    const task = runPostProcessing(stagingRoot, projectRoot, allSubjects, true, lease);
    if (lease) {
      try {
        void registerProjectTask(task);
      } catch {
        // Transition admission closed before post-processing started.
      }
    } else {
      void task;
    }
  });
  if (!acceptListener(unlistenExitError)) return () => {};

  // Return cleanup function
  const cleanup = () => {
    logBatcher.flush();
    unlistenStructured();
    unlistenRaw();
    unlistenPrepare();
    unlistenExitError();
    if (typeof window !== "undefined" && window.__IMPORT_CLEANUP__ === cleanup) {
      window.__IMPORT_CLEANUP__ = undefined;
    }
  };

  if (typeof window !== "undefined") {
    window.__IMPORT_CLEANUP__ = cleanup;
  }

  return cleanup;
}

/**
 * Invoke the Rust `run_import_pipeline` command.
 *
 * Returns the PID of the spawned MATLAB process.
 */
export async function runImportPipeline(params: {
  projectRoot: string;
  stagingEntries: StagingEntry[];
  sourcestructureJson: Record<string, unknown>;
  studyparJson: Record<string, unknown>;
  executionProfile: ExecutionProfile;
  subjectList: string[];
  subjectsToPreserve?: string[];
}): Promise<number> {
  const stagingRoot = `${params.projectRoot}/.easl_staging`;

  const pid = await invoke<number>("run_import_pipeline", {
    stagingRoot,
    stagingEntries: params.stagingEntries,
    sourcestructureJson: params.sourcestructureJson,
    studyparJson: params.studyparJson,
    executionProfile: params.executionProfile,
    subjectList: params.subjectList,
    subjectsToPreserve: params.subjectsToPreserve ?? null,
  });

  return pid;
}

/**
 * Invoke the Rust `stop_import` command to kill the MATLAB process.
 */
export async function stopImportProcess(pid: number): Promise<void> {
  await invoke("stop_import", { pid });
}

/**
 * Copy succeeded subjects' lock files from project root back into staging before retry.
 */
export async function copyLockFilesForRetry(params: {
  projectRoot: string;
  stagingRoot: string;
  subjects: string[];
}): Promise<void> {
  if (params.subjects.length === 0) {
    return;
  }

  await invoke("copy_lock_files", {
    projectRoot: params.projectRoot,
    stagingRoot: params.stagingRoot,
    subjects: params.subjects,
  });
}

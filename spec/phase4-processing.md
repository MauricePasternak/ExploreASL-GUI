# Phase 4: Processing (Execution Dashboard)

## Overview

Dashboard for executing the ExploreASL processing pipeline (Structural, ASL, Population modules). Provides subject selection, MATLAB version selection, real-time progress monitoring via lock file watcher, error handling with rollback support, and background execution with cross-route state persistence.

## User Flow

### 4.1 Subject Selection (Dataset Parameters)
1. Arrive at `/project/:id/processing`.
2. First section: "Select Subjects." A tree or multi-select list of all subjects/sessions discovered during import or from existing `rawdata/` directory.
3. User selects which subjects to process (all by default). Selection includes session-level granularity.
4. This generates `x.dataset.subjectRegexp` and optionally `x.dataset.exclusion` or `x.dataset.ForceInclusionList` for the execution.

### 4.2 Pipeline Configuration
1. **MATLAB Version:** Dropdown populated from global settings (`matlabInstallations`). Required.
2. **Modules:** Checkboxes for Structural, ASL, Population. At least one must be selected.
3. **Worker Count:** Number input with safe default and hard cap. Frontend queries `@tauri-apps/plugin-os`:
   - `cpu()` → physical cores = hard ceiling (cannot exceed)
   - `availableMemory()` → safe limit = 1 worker per 4 GB available RAM
   - Default: `Math.min(ceil(availableMemory / 4GB), cores, 4)` — caps at 4, floor-reduced by RAM.
   Each worker spawns a separate MATLAB subprocess with unique `iWorker` (1..n) and shared `nWorkers`.
   ExploreASL parallelizes subjects across workers.
4. Pre-flight check: validates that required paths (MATLAB, ExploreASL, dataPar.json) exist and are configured.

### 4.3 Execution Dashboard
1. "Start Processing" button triggers Rust backend.
2. Rust spawns MATLAB: `ExploreASL(<project_root>, 0, <processModules>, 0, <iWorker>, <nWorkers>)`.
3. Dashboard shows a data grid: one row per subject/session combination.
   - Columns: Subject, Session, Module (Structural/ASL/Population), Status (icon), Current Step, Elapsed Time.
   - Expandable row: step timeline showing individual processing steps (e.g., Realign, Register, Resample, Quantification) with status: pending (gray), running (spinner), completed (green), failed (red).
4. Overall progress bar at top.
5. Processing runs in background. User can navigate to other routes; the status bar in Layout shows active processing. Returning to `/project/:id/processing` restores the live dashboard.
6. Log output section: scrollable area showing MATLAB stdout/stderr (secondary — primary progress from lock files).
7. Control buttons: Pause (SIGTERM, graceful attempt), Kill (SIGKILL after timeout), Resume.

### 4.4 Rollback
1. On a completed subject's expandable step timeline, user right-clicks a completed step.
2. Context menu: "Rollback to here."
3. Confirmation dialog: "This will mark [step name] onwards as incomplete for [subject]. ExploreASL will re-execute from this step."
4. On confirm: Rust deletes the `.status` file for the chosen step and ALL subsequent `.status` files for the same module/subject, including `999_ready.status`. **Only status files are deleted** — ExploreASL detects missing status files on re-run and re-executes those steps (overwriting outputs as needed).
5. Subject returns to "pending" state for that step. User can re-run processing.

### 4.5 Crash / Interrupt Recovery
1. If processing is killed or crashes, incomplete subjects show as "Interrupted" in the dashboard.
2. "Resume" button appears. On click:
   - Rust scans lock directory for incomplete subjects (missing `999_ready.status`).
   - Deletes the status file of the last attempted step (to force re-execution of that step).
   - Re-invokes MATLAB for those subjects only.
3. "Clean Interrupted" button: deletes ALL partial outputs for interrupted subjects (more aggressive).

### 4.6 Results Summary
1. On full completion: summary displaying X succeeded, Y failed, Z skipped.
2. Links to open output directories in file manager (via `@tauri-apps/plugin-opener`).
3. Failed subject details: which step failed, error derived from log file.

## Component Tree

```
Phase4Processing (route: /project/:id/processing)
├── SubjectSelection
│   ├── SubjectTree (Mantine Tree or MultiSelect — subjects with nested sessions)
│   ├── SelectAllCheckbox
│   └── SelectionSummary ("13 of 20 subjects selected")
├── PipelineConfig
│   ├── MatlabVersionSelect (Mantine Select)
│   ├── ModuleCheckboxes (Structural, ASL, Population)
│   ├── WorkerCountInput (Mantine NumberInput)
│   └── PreflightCheckResult (validation summary before start)
├── ExecutionDashboard
│   ├── OverallProgress (Mantine Progress bar)
│   ├── ControlButtons (Start, Pause, Kill, Resume)
│   ├── SubjectGrid (Mantine DataTable)
│   │   ├── SubjectRow (collapsible)
│   │   │   ├── StatusIcon
│   │   │   └── ExpandedTimeline (step-level Mantine Stepper or timeline)
│   │   │       └── StepItem (right-click → rollback menu)
│   ├── LogOutput (scrollable Mantine Code or Textarea, read-only)
│   └── ResultsSummary (post-execution)
│       ├── SuccessCount / FailCount
│       ├── OpenOutputButton
│       └── FailedSubjectDetails (accordion per failed subject)
└── ProcessingStatusBar (global, in Layout — shows active processing state across routes)
```

## Data Model (Zod Schemas)

```typescript
const ProcessConfig = z.object({
  subjects: z.array(z.string()),              // selected subject IDs
  sessions: z.array(z.string()).optional(),   // selected session IDs per subject
  matlabPath: z.string(),                     // from global settings
  exploreAslPath: z.string(),                 // from global settings
  modules: z.array(z.enum(["structural", "asl", "population"])).min(1),
  workers: z.number().int().positive().default(1),
  // Derived dataset params:
  subjectRegexp: z.string().optional(),       // generated from selection
  exclusion: z.array(z.string()).default([]),
  forceInclusionList: z.array(z.string()).optional(),
});

const StepStatus = z.object({
  stepCode: z.string(),         // e.g. "020_RealignASL"
  stepName: z.string(),         // human-readable: "Realign ASL"
  status: z.enum(["pending", "running", "completed", "failed"]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const SubjectStatus = z.object({
  subject: z.string(),
  session: z.string(),
  module: z.enum(["structural", "asl", "population"]),
  overallStatus: z.enum(["pending", "running", "completed", "failed", "interrupted"]),
  steps: z.array(StepStatus),
  errorMessage: z.string().optional(),
  pid: z.number().optional(),   // MATLAB process ID for this subject
});

const ProcessingState = z.enum(["idle", "running", "paused", "completed", "failed"]);
```

## State Shape (Zustand Slices)

```typescript
interface ProcessingState {
  // Configuration
  config: ProcessConfig | null;
  availableSubjects: { subject: string; sessions: string[] }[];  // from import/rawdata

  // Execution state
  processingState: "idle" | "running" | "paused" | "completed" | "failed";
  subjectStatuses: SubjectStatus[];
  overallProgress: number;             // 0–100
  startTime: string | null;
  elapsedTime: number | null;
  workerPids: number[];               // main MATLAB process IDs

  // Logs
  logLines: string[];                  // recent stdout/stderr lines (capped at 500)

  // Actions
  setConfig: (config: ProcessConfig) => void;
  startProcessing: () => Promise<void>;
  pauseProcessing: () => Promise<void>;
  killProcessing: () => Promise<void>;
  resumeProcessing: () => Promise<void>;
  rollbackStep: (subject: string, session: string, module: string, stepCode: string) => Promise<void>;
  cleanInterrupted: (subject: string, session: string) => Promise<void>;
  updateSubjectStatus: (status: SubjectStatus) => void;
  appendLog: (line: string) => void;
  scanAvailableSubjects: () => Promise<void>;   // reads rawdata/ or derivatives/
  loadLockFileStatus: () => Promise<void>;      // reads existing lock files on page load
}
```

## Tauri Commands (Rust API)

```
run_pipeline(project_root: String, matlab_path: String, exploreasl_path: String, process_modules: Vec<bool>, workers: u32, dataset_params: DatasetParams) -> Vec<u32>
  Before spawning MATLAB, reads existing dataPar.json (written by Phase 3), merges in DatasetParams
  (x.dataset.subjectRegexp, x.dataset.exclusion, x.dataset.ForceInclusionList) from subject selection,
  and writes back.
  Spawns N = workers separate MATLAB subprocesses, each with a unique iWorker (1..n):
    cd(exploreasl_path); ExploreASL(project_root, 0, processModules, 0, i, n)
  Returns list of N process IDs. The frontend tracks each worker's progress independently.

kill_pipeline(pids: Vec<u32>, graceful: bool) -> ()
  Sends SIGTERM (graceful) or SIGKILL (force). Waits for process exit.

watch_lock_dir(project_root: String) -> ()
  Starts notify watcher on <project_root>/derivatives/ExploreASL/lock/.
  Emits LockFileEvent { subject: String, module: String, step: String, action: "created" | "deleted" } on .status file changes.
  This is the same command as in Phase 2, shared implementation.

rollback_step(project_root: String, subject: String, session: String, module: String, step_code: String) -> ()
  Deletes the .status file for the given step and ALL subsequent step .status files in the same module/subject directory.
  Also deletes 999_ready.status if present. Does NOT delete derivative NIfTI files — ExploreASL overwrites them on re-execution.

clean_subject_output(project_root: String, subject: String, session: String) -> ()
  Deletes all output files and lock files for a given subject/session combination.
  Used for interrupted subject cleanup.

list_subjects(project_root: String) -> SubjectList
  Scans <project_root>/rawdata/ and/or <project_root>/derivatives/ExploreASL/ for available subjects and sessions.
  Returns: { subjects: [{ name: String, sessions: Vec<String> }] }.

read_lock_status(project_root: String) -> Vec<SubjectStatus>
  Reads existing lock files from derivatives/ExploreASL/lock/ and returns current status for all subjects.
  Used on page load to restore dashboard state.
```

## Step Code Mapping

ExploreASL writes `.status` files with numeric prefixes indicating execution order. The frontend maps these to human-readable names. `TODO: obtain complete listing of all status file codes per module.`

Known step codes for ASL module (from Brainstorming notes):
```
020_RealignASL.status
030_RegisterASL.status
040_ResampleASL.status
050_PreparePV.status
060_ProcessM0.status
070_CreateAnalysisMask.status
080_Quantification.status
090_VisualQC_ASL.status
999_ready.status
```

Similar structure exists for Structural and Population modules. The complete mapping will be hardcoded in the frontend.

## Validation Rules

| Rule | Context |
|---|---|
| At least one subject selected | Before start |
| At least one module selected (Structural, ASL, or Population) | Before start |
| MATLAB path configured and executable exists | Before start |
| ExploreASL path exists and contains ExploreASL.m | Before start |
| `dataPar.json` must exist in derivatives/ExploreASL/ | Warning only (ExploreASL uses defaults if missing) |
| Worker count cannot exceed available cores or subject count | Soft warning |
| Cannot start while another process is running | Button disabled |
| Rollback only available for completed steps | Right-click menu logic |

## Error Handling

- **MATLAB not found:** "MATLAB executable not found at [path]. Check Settings."
- **ExploreASL not found:** "ExploreASL not found at [path]. Check Settings."
- **Subprocess crash:** "Processing stopped unexpectedly for [subject]. Check logs for details. You can resume from the failure point or clean and restart."
- **Lock file parse error:** Fallback to showing raw status file name. Log warning.
- **Rollback failure:** "Unable to rollback [subject]. Some files may be locked. Close any external viewers and retry."
- **Kill timeout:** "Process did not respond to graceful stop. Force killing..." → Mantine notification with yellow then red severity.
- **Interrupted state detected on startup:** Warning banner: "Processing was interrupted. Select subjects and click Resume to continue, or Clean to start fresh."

## Out of Scope

- Auto-resume after GUI crash (manual Resume button only)
- WebGL CBF volume viewer (reserved route `/project/:id/viewer`)
- Population module statistical result display (tables, charts) — just run + status
- Performance profiling (time-per-step analytics)
- Email/slack notifications on completion
- Scheduled/queued batch processing across multiple projects
- Editing dataPar.json during processing (must stop first)

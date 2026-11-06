# processing-backend Specification

## Purpose

Define backend execution and monitoring of ExploreASL processing.

## Requirements

### Requirement: Module Log File Cleanup

During preparation, `run_pipeline` SHALL quarantine existing selected ExploreASL module log files under the durable pre-execution journal from `<project_root>/derivatives/ExploreASL/log/` for each enabled module matching the subject regexp filter. Log files follow the naming pattern `{module_name}_sub-{Subject}_{Session}[_...].log`. The subject/session SHALL be extracted from the filename using the pattern `sub-[^_]+_[^_.]+` and tested against `subject_regexp`. The Population module SHALL have its log file quarantined regardless of subject regexp match (no per-subject granularity). Non-log files (`.json`, `.csv`) in the log directory SHALL NOT be affected. If the log directory does not exist, the cleanup SHALL succeed silently.

#### Scenario: Structural log deleted for matching subject

- **WHEN** `run_pipeline` launches a reservation selecting only Structural for `sub-001_01`
- **THEN** `xASL_module_Structural_sub-001_01.log` SHALL be absent from the active log directory after quarantine; `xASL_module_Structural_sub-002_01.log` SHALL be preserved

#### Scenario: All ASL run logs deleted for matching subject

- **WHEN** `run_pipeline` launches a reservation selecting only ASL for `sub-001_01`
- **THEN** ALL log files starting with `xASL_module_ASL_sub-001_01_` SHALL be absent from the active log directory after quarantine regardless of run number; logs for `sub-002_01` SHALL be preserved

#### Scenario: Disabled module logs preserved

- **WHEN** `run_pipeline` launches a reservation selecting only Structural
- **THEN** ASL and Population log files SHALL remain untouched

#### Scenario: Population log always deleted when module enabled

- **WHEN** `run_pipeline` launches a reservation selecting only Population
- **THEN** `xASL_module_Population.log` SHALL be absent from the active log directory after quarantine regardless of `subject_regexp` value

#### Scenario: Non-log files preserved

- **WHEN** the log directory contains `bids_report_*.json` and `import_summary_*.csv` files
- **THEN** those files SHALL remain untouched by the log cleanup

### Requirement: read_lock_status Command

The `read_lock_status` Tauri command SHALL accept `project_root: String` and return `Vec<SubjectModuleStatus>`. It SHALL scan all lock directories under `<project_root>/derivatives/ExploreASL/lock/` and determine per-subject per-module status. If the lock directory does not exist, it SHALL return an empty array.

#### Scenario: Empty lock directory

- **WHEN** `derivatives/ExploreASL/lock/` does not exist
- **THEN** `read_lock_status` SHALL return an empty array

#### Scenario: Complete subject

- **WHEN** `999_ready.status` exists under `xASL_module_Structural/sub-X_01/xASL_module_Structural/`
- **THEN** the matching `SubjectModuleStatus` SHALL have `status: "complete"`

#### Scenario: Incomplete subject

- **WHEN** some `.status` files exist but no `999_ready.status` under a module/subject
- **THEN** `status` SHALL be `"incomplete"` and `completedSteps` SHALL list all existing step codes

### Requirement: list_subjects Command

The `list_subjects(project_root: String, data_source: Option<String>)` command SHALL delegate to `bids::scan::parse_bids_structure` on:

- `project_root.join("rawdata")` when `data_source` is `"dicom"` or omitted (existing DICOM-import contract)
- `project_root` when `data_source` is `"bids"` (BIDS-direct subjects live at project root)

The function maps `Vec<BidsSubject>` to `Vec<SubjectInfo>` preserving the existing frontend contract:

| Old `SubjectInfo` field | Mapping from `BidsSubject`/`BidsSession`                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject_session`       | `format!("sub-{}_{}", subject_label, session_label)`                                                                                                                                            |
| `subject`               | `subject_label`                                                                                                                                                                                 |
| `session`               | `session_label`                                                                                                                                                                                 |
| `has_structural`        | nonempty `anat_files`                                                                                                                                                                           |
| `has_asl`               | nonempty `asl_files`                                                                                                                                                                            |
| `asl_runs`              | parsed from `asl_files` (numeric run IDs normalized, sorted ascending, deduplicated; absent run defaults to `"1"`); also defaults to `["1"]` when `has_perf` is true but no ASL files are found |

Cross-sectional handling: missing `ses-*` directories default to session `"1"` per D2.

Availability SHALL reflect filename-based discovery of ASL NIfTI entries (`_asl.nii` or `_asl.nii.gz`) and anatomical NIfTI entries (T1w, T2w or FLAIR), including subject-level anatomical fallback. Directory existence alone SHALL NOT establish module availability, and these flags SHALL NOT constitute scientific validation of image contents.

The command SHALL remain registered for Tauri IPC.

#### Scenario: DICOM project list_subjects unchanged output shape

- **WHEN** `list_subjects` runs on a DICOM-import project with `rawdata/sub-001/ses-01/perf/sub-001_asl.nii.gz`
- **THEN** returns `SubjectInfo { subject_session: "sub-001_01", subject: "001", session: "01", has_structural: ..., has_asl: true, asl_runs: ["1"] }`

#### Scenario: Cross-sectional session defaults to "1" in SubjectInfo

- **WHEN** `parse_bids_structure` scans ds000240 with `sub-01/perf/sub-01_asl.nii.gz` (no `ses-*`)
- **THEN** returns `SubjectInfo { subject_session: "sub-01_1", subject: "01", session: "1", ... }`

#### Scenario: BIDS-direct list_subjects scans project root

- **WHEN** `list_subjects` runs on a BIDS-direct project with subjects at root and empty `rawdata/`
- **THEN** returns subjects from project root, not empty list

#### Scenario: Empty perf directory does not establish ASL availability

- **WHEN** a discovered SubjectSession has a `perf/` directory but no discovered ASL NIfTI entries
- **THEN** `has_asl` SHALL be false even though `asl_runs` SHALL default to `["1"]`

### Requirement: Module Name Mapping

The `b_process` vector SHALL map to ExploreASL lock directory names: index 0 → `xASL_module_Structural`, index 1 → `xASL_module_ASL`, index 2 → `xASL_module_Population`. This mapping SHALL be used by `run_pipeline` for status file deletion, log file cleanup, and by `read_lock_status` for directory traversal.

#### Scenario: Delete status files for structural module only

- **WHEN** `run_pipeline` launches a reservation selecting only Structural, corresponding to `b_process = [true, false, false]`
- **THEN** individual `.status` quarantine targets SHALL be limited to matching subjects under `xASL_module_Structural/*/xASL_module_Structural/`; project-wide stale `locked` directory quarantine SHALL remain independent of that module filter

### Requirement: Module Ordering Handled by ExploreASL

The GUI SHALL NOT orchestrate module execution order. It passes the `bProcess` vector directly to ExploreASL, which handles the internal ordering (Structural before ASL per subject session, etc.). The GUI treats modules as a selection, not a sequence.

#### Scenario: User selects Structural and ASL

- **WHEN** the user checks Structural and ASL checkboxes
- **THEN** the immutable request SHALL select both modules and native launch SHALL pass `b_process = [true, true, false]` to ExploreASL without any GUI ordering logic

### Requirement: BIDS2Legacy Transparency

BIDS2Legacy runs as part of each ExploreASL invocation before the selected processing modules. The GUI SHALL NOT display BIDS2Legacy progress separately. Its lock files (`xASL_module_BIDS2Legacy/`) are not tracked by the processing dashboard.

#### Scenario: BIDS2Legacy runs before Structural

- **WHEN** ExploreASL runs Structural module on a subject
- **THEN** BIDS2Legacy executes first as part of the same MATLAB invocation; the dashboard SHALL only show lock file events for the selected module(s)

### Requirement: ExploreASL Version Detection

The `detect_exploreasl_version` Tauri command SHALL remain unchanged. Its usage SHALL shift from being called with the global `exploreAslPath` to being called with the `exploreAslPath` from the selected execution profile. The version SHALL be detected:

1. **On app startup and profile save**: profile validation SHALL re-detect `exploreAslVersion` and persist it if changed. Profile save SHALL reuse its single validation result as defined in `execution-profiles`.
2. **During preparation phase of `run_pipeline`**: the version SHALL be extracted from the reserved profile's `exploreAslVersion` field (or re-detected from `exploreAslPath`) and logged.
3. **At pipeline runtime**: native preparation captures actual on-disk versions through managed probes. Accepted native provenance is saved to `lastRun` alongside `profileId`; the renderer does not launch processing-time probes.

The Settings modal SHALL display the detected version on each profile's ExploreASL path input, rather than as a single global indicator.

#### Scenario: Version detected from profile on startup validation

- **WHEN** startup validation runs and a `MatlabProfile` has `exploreAslPath` pointing to a directory containing `VERSION_1.11.0`
- **THEN** `profile.exploreAslVersion` SHALL be set to `"1.11.0"` and persisted if changed from the stored value

#### Scenario: Version logged during preparation from profile

- **WHEN** `run_pipeline` launches an immutable reservation whose `MatlabProfile` has `exploreAslVersion: "1.11.0"`
- **THEN** the version `"1.11.0"` SHALL be logged via `log::info!` before any destructive operations

### Requirement: Command Execution for Apptainer Profiles

The Tauri commands `launch_import_run` and `run_pipeline` SHALL support execution using the `apptainer` profile type. Import launch SHALL use its exact reservation and typed profile; processing launch SHALL use only the run ID of an immutable request containing that profile.

1. **Import execution (`launch_import_run`)**:
   Instead of running MATLAB directly on the host, the backend SHALL construct and spawn the following command line:

   ```
   <profile.apptainerPath> exec --cleanenv --writable-tmpfs --bind <staging_root>:/data <profile.sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "[1,1,0]" "0"
   ```
   - `<staging_root>` is the absolute host path of the staging directory.
   - The staging directory on the host is bound to `/data` inside the container.
   - The `--cleanenv` flag SHALL be included to isolate the container environment and prevent host MATLAB environment variables from causing conflicts.
   - The compiled script is executed with `/data` as the dataset root, running the import module (arguments `"[1,1,0]" "0"`).

2. **Processing execution (`run_pipeline`) & Import execution (`launch_import_run`)**:
   Before spawning any worker or running import, the backend SHALL check for a pre-flight MCR cache.
   - The MCR cache directory is determined by checking the environment variable `$MCR_CACHE_ROOT` on the host system. If not set, it defaults to `$HOME/.mcrCache9.7/`; if neither variable is set, it falls back to the relative path `.mcrCache9.7`.
   - If that directory does not exist, the backend SHALL perform a warmup run synchronously by executing:
     ```
     <profile.apptainerPath> exec --cleanenv --writable-tmpfs --bind <dataset_root>:/data --bind <cache_dir>:<cache_dir> --env MCR_CACHE_ROOT=<cache_dir> <profile.sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/
     ```
     `<dataset_root>` SHALL be the owned staging root for import or current project root for processing. The backend SHALL create the cache directory before warmup, bind it into the container, and set its container `MCR_CACHE_ROOT` explicitly. Warmup SHALL use a cancellable bounded native probe and preserve shared cache bytes on failure. Once warmup completes successfully, the actual pipeline runs are executed as warm starts.

   Once warmed up, for each worker `i` from `1` to `N` (workers) in `run_pipeline`, the backend SHALL construct and spawn:

   ```
   <profile.apptainerPath> exec --cleanenv --writable-tmpfs --bind <project_root>:/data <profile.sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "<b_process_string>" "0" "<i>" "<N>"
   ```
   - `<project_root>` is the absolute host path of the project root.
   - The project root directory on the host is bound to `/data` inside the container.
   - The `--cleanenv` flag SHALL be included to prevent host environment pollution.
   - `<b_process_string>` is the string representation of `b_process` vector (e.g. `"[1,1,0]"` for Structural + ASL).
   - `i` is the current worker ID.
   - `N` is the total number of workers.
   - **Staggered Launch**: The backend SHALL stagger the spawning of parallel workers by at least 2 seconds (instead of the 1 second used for MATLAB) to allow container namespace initialization to settle and prevent SQLite/file access races.

#### Scenario: Running import with Apptainer execution profile

- **WHEN** `launch_import_run` launches an exact reservation with an Apptainer profile having `sifPath: "/path/to/image.sif"` and `apptainerPath: "apptainer"`
- **THEN** the backend SHALL spawn the command `apptainer exec --cleanenv --writable-tmpfs --bind <staging_root>:/data /path/to/image.sif /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "[1,1,0]" "0"`

#### Scenario: Running processing with Apptainer execution profile and 2 workers

- **WHEN** `run_pipeline` launches a reservation with `workers = 2`, Structural and ASL selected, and an Apptainer profile having `sifPath: "/path/to/image.sif"`
- **THEN** the backend SHALL perform a warmup run if MCR is not cached, and then spawn 2 parallel worker processes:
  1. `apptainer exec --cleanenv --writable-tmpfs --bind <project_root>:/data /path/to/image.sif /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "[1,1,0]" "0" "1" "2"`
  2. `apptainer exec --cleanenv --writable-tmpfs --bind <project_root>:/data /path/to/image.sif /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "[1,1,0]" "0" "2" "2"`

### Requirement: Immutable durable processing request

Native reservation SHALL validate the active project and an immutable request containing selected work, execution profile, configuration, and participant-generation inputs. It SHALL assign a UUID, persist the request and expected target inventory, and reject empty effective work before destructive mutation. Repeating a request identity with identical canonical content SHALL return the same reservation identity; reuse with different content SHALL reject. Current-root admission metadata SHALL be validated separately and SHALL NOT become persistent request identity. Project-internal path fields SHALL compare portably; external execution/source paths SHALL remain request content. Launch SHALL use only the exact reserved request, not replacement renderer arguments.

For Structural and ASL, native reservation SHALL interpret an empty `selectedSubjectSessions` list as all discovered SubjectSessions, not as empty work. A nonempty list SHALL restrict inventory to those entries and SHALL reject entries absent from native discovery. Expected targets SHALL omit unavailable modules per SubjectSession; Population SHALL contribute one dataset-level target independently of subject selection. This native contract SHALL remain distinct from the renderer's empty-selection and missing-ASL hard blocks. Preparation SHALL rederive the effective targets and reject changed target inventory rather than silently alter the reserved set.

After existing exact-request replay lookup and before fresh reservation, processing filesystem mutation or worker launch, native admission SHALL require all 25 scalar switch choices in accepted configuration and correctly typed submitted values equal to those choices at their operative destinations, including `participants.correction` for metadata grouping correction. Missing accepted choices SHALL direct the user to review and confirm Parameters. Missing, wrong-typed or mismatching submitted values SHALL reject without backfilling. Historical sparse records, exact retries, recovery, digests and acknowledgements SHALL retain their existing compatibility; fresh completeness enforcement SHALL NOT be added to shared record validation.

#### Scenario: Native empty selection includes all discovered eligible work

- **WHEN** `reserve_processing_run` receives an otherwise valid Structural or ASL request with an empty selected-subject list and eligible native inventory
- **THEN** it SHALL reserve targets for all discovered SubjectSessions eligible for the selected modules, while preserving the empty list in the immutable request

#### Scenario: No effective native targets

- **WHEN** selected subject modules have no eligible targets and Population is not selected
- **THEN** native reservation SHALL reject before destructive preparation, including when the selected-subject list is empty

#### Scenario: Effective inventory changes after reservation

- **WHEN** preparation derives a target set different from the persisted expected targets
- **THEN** it SHALL fail before artifact installation and require a new reservation

#### Scenario: Lost reservation response

- **WHEN** the caller retries the same request after losing its response
- **THEN** native admission SHALL return the existing run without creating a second launch

#### Scenario: Changed launch request

- **WHEN** a caller supplies a stale run or reuses a request identity with changed content
- **THEN** admission SHALL reject before mutation or worker creation

#### Scenario: Delayed request replay after acknowledgement

- **WHEN** an acknowledged request is repeated after a different request becomes current
- **THEN** native admission SHALL return a compact historical replay envelope identifying the original reservation without replacing current execution
- **AND** changed content under the old request identity SHALL still reject

### Requirement: Native processing preparation

Native processing SHALL verify BIDS compatibility before mutation and own participant merging, configuration installation, environment capture, historical selected-status/log quarantine, project-wide stale-lock quarantine, and watcher startup. Participant generation SHALL preserve existing root-authored site values, extra columns, ASL run normalization, and correction rules. Root `participants.tsv` and `participants.json` SHALL be read-only inputs, excluded from journal mutation, backup, quarantine and restore targets. Only derivative participant files SHALL be installed. BIDS root TSV site values SHALL take precedence over group fallback, including when correction is disabled; DICOM SHALL preserve its existing no-root-read behavior. BIDS compatibility verification SHALL require existing valid setup and offer separate explicit repair preflight on conflict, never processing-time repair. BIDS configuration SHALL use the current root in the executor's filesystem namespace in `x.opts.subjectFolder`: the absolute host root for MATLAB, or the existing `/data` binding for Apptainer; DICOM SHALL omit that field for either profile. Assembly SHALL replace or remove any supplied value without mutating the reserved configuration or host project identity. Native version capture SHALL preserve `unknown` fallback when a failed probe has settled, overlap independent preparation, and settle before scientific launch. A timed-out or otherwise unsettled probe SHALL fail preparation and settle its in-process process scope before terminal publication; it SHALL NOT permit scientific launch with unresolved probe ownership. Renderer subscriptions SHALL NOT be a prerequisite for safe launch or completion.

#### Scenario: BIDS verification fails

- **WHEN** BIDS compatibility verification fails for an admitted run
- **THEN** native state SHALL expose structured failure before modifying configuration, participants, selected statuses, or Population metadata

#### Scenario: Root participant mutation target is rejected

- **WHEN** a malformed launch manifest proposes root `participants.tsv` or `participants.json` as an owned destination
- **THEN** native validation SHALL reject before mutation while allowing read-only BIDS root site lookup

#### Scenario: Participant installation fails

- **WHEN** installing participant artifacts fails before the execution boundary
- **THEN** native rollback SHALL restore prior GUI-owned files and prior absence after resources settle

### Requirement: Durable processing execution boundary

Processing SHALL persist validated destination-to-backup mappings before destructive mutation and persist execution commit before a worker can execute. Before execution commit, recovery SHALL restore the exact prior GUI-owned artifact state after current in-process settlement or explicit interrupted-run confirmation. After execution commit, failure or cancellation SHALL stop owned process scopes and preserve current ExploreASL artifacts without restoring historical statuses or configuration. Scientific outputs SHALL never be deleted or restored by launch recovery. Malformed records and unmapped legacy quarantine SHALL block affected launch without inferred destination mapping. Native preparation SHALL retain selected module/subject scope for individual historical `.status` files and module logs, optional BIDS2Legacy rerun behavior, unchanged non-log files in the log directory, and unchanged scientific module ordering. Stale `locked` directories SHALL be collected across the entire project's ExploreASL lock root before module/subject filters; safe allowlisted destinations SHALL be quarantined through the same validated journal mappings and pre/post-commit recovery policy. Unsupported destinations and `locked` entries that are symbolic links or not directories SHALL reject preparation. Native launch SHALL validate the profile and require a positive `u32` worker count; it SHALL NOT impose a CPU-core maximum or Population-only single-worker rule. Those worker limits SHALL remain renderer preflight rules. Native launch SHALL invoke MATLAB/Apptainer using the reserved worker count, existing profile arguments, worker numbering and staggering; live process identity SHALL remain private to in-process supervision.

#### Scenario: Structural launch quarantines an unselected ASL stale lock

- **WHEN** Structural alone is selected for `sub-001_01` and an ASL `locked` directory remains for `sub-002_01`
- **THEN** preparation SHALL quarantine that stale directory as well as selected Structural statuses, without selecting the unrelated ASL statuses or logs outside that directory
- **AND** a pre-commit failure SHALL restore the quarantined directory through its durable mapping after settlement

#### Scenario: Native worker count differs from renderer limits

- **WHEN** an otherwise valid native request specifies a positive worker count above detected cores or more than one worker for Population
- **THEN** native worker validation SHALL NOT reject on those grounds, and launch SHALL use the reserved count without a native CPU or Population clamp

#### Scenario: Crash during preparation rename

- **WHEN** interruption occurs between durable rename intent and completion recording
- **THEN** recovery SHALL inspect owned source/destination evidence and idempotently restore the pre-execution artifact state

#### Scenario: Later worker fails to spawn

- **WHEN** worker creation fails after execution commit and earlier workers have started
- **THEN** native supervision SHALL stop and reap the supported process scopes, retain current artifacts, and report Failed only after settlement

#### Scenario: First worker fails to spawn after commit

- **WHEN** the first worker cannot be created after durable execution commit
- **THEN** recovery SHALL preserve the committed prepared artifact state and SHALL NOT reactivate historical statuses

#### Scenario: Unknown legacy quarantine

- **WHEN** a previous launch left numbered backups without a durable manifest
- **THEN** native preparation SHALL preserve those files and reject affected execution with actionable recovery information

### Requirement: Expected-target native processing completion

Native completion SHALL use the immutable target set: Structural per Subject/Session, ASL per Subject/Session/Run, and Population per dataset. It SHALL require safe fresh regular `999_ready.status` files for every expected target and successful exit evidence for every requested worker. Selected historical statuses SHALL be quarantined before execution. Unrelated historical or extra targets SHALL NOT determine current outcome. Watcher notifications SHALL provide progress only; the final filesystem audit SHALL determine target evidence.

#### Scenario: Missing selected target

- **WHEN** workers exit successfully but an expected fresh ready file is absent
- **THEN** the run SHALL fail with the missing target identified

#### Scenario: Nonzero worker exit with ready files

- **WHEN** every expected ready file exists but a worker exits unsuccessfully
- **THEN** the run SHALL fail with worker evidence retained

#### Scenario: Unrelated historical incompletion

- **WHEN** all current targets and workers succeed but an unrelated historical module remains incomplete
- **THEN** that historical module SHALL NOT prevent current-run completion

### Requirement: Compact acknowledged request replay

Admission, discovery and exact acknowledgement SHALL use one fixed full current-run record and direct historical request/run lookup without scanning historical run payloads. Reservation SHALL durably publish that complete fixed record before returning success or journal mutation. No separate current pointer or full historical request payload SHALL be required to discover an interrupted reservation. Unresolved-journal validation SHALL still apply when the current record is absent. Before acknowledgement the full terminal snapshot SHALL remain durable and replayable. After acknowledgement each request SHALL retain an indefinitely preserved binding no larger than 4 KiB plus small direct-lookup entries, containing canonical payload digest, project/request/run identity, exact terminal revision, outcome, fixed-field bounded summary and acknowledgement. It SHALL NOT retain full profiles, configuration, participant inputs, per-target arrays or full worker history. Storage therefore grows by at most 4 KiB logical binding bytes plus lookup/filesystem overhead per acknowledged request; total lifetime storage SHALL NOT be described as constant or fully bounded.

Reservation responses SHALL distinguish current/unacknowledged snapshots from `historicalReplay: true` envelopes. A historical envelope SHALL return the original run identity, exact terminal revision/outcome/summary and acknowledgement without becoming current or launching again. Changed content SHALL still reject. There SHALL be no TTL or AlreadyCompleted replacement for original-identity replay. Exact acknowledgement of that historical run/revision SHALL remain idempotent after another run becomes current; a mismatched revision SHALL reject.

Compaction SHALL durably acknowledge the fixed terminal current record, publish the binding and direct run locator, and complete owned journal cleanup before removing that matching full current record. There SHALL be no guardian retirement receipt and no redundant full payload left undiscoverable after removal. Creation, replacement and removal SHALL synchronize affected parents where supported. Failure or uncertain publication/removal durability SHALL prevent durable success and replacement admission until reconciled under active-project ownership. The fixed acknowledged current record SHALL remain the recovery anchor until preceding cleanup and historical publication are durable. Discovery SHALL expose current or unacknowledged state, never acknowledged historical envelopes as active work.

#### Scenario: Reservation publication is interrupted

- **WHEN** interruption occurs around initial current-record publication before the reservation response
- **THEN** recovery SHALL read the fixed key and either recover that exact reservation or establish that none was durably admitted, without a history scan or duplicate execution
- **AND** no worker admission or destructive preparation SHALL precede durable publication

#### Scenario: Acknowledgement crashes during compaction

- **WHEN** interruption occurs after durable acknowledgement but before compact binding publication completes
- **THEN** recovery SHALL finish from the retained current record without scanning history, losing exact acknowledgement, or admitting replacement prematurely

#### Scenario: Historical acknowledgement repeats while another run is active

- **WHEN** the caller acknowledges a compacted old run with its exact terminal revision
- **THEN** acknowledgement SHALL succeed idempotently without modifying the new run or requiring the old full launch payload

### Requirement: Durable processing terminal replay

Native processing SHALL persist lifecycle revision, logical worker exits, target outcomes, structured error, recovery action, and terminal summary. Completed, Failed, and Cancelled snapshots SHALL follow supported process-scope and watcher settlement. Interrupted snapshots discovered after native restart SHALL instead disclose absent in-process ownership and require external-stop confirmation before cleanup, acknowledgement, or replacement execution. Discovery SHALL return active or unacknowledged terminal state. Exact run/revision acknowledgement SHALL be durable and idempotent, and SHALL occur only after corresponding project metadata is saved. Cleanup failures SHALL retain ownership with retryCleanup. Admitted operational failures SHALL return structured snapshots; storage failures SHALL NOT be disguised as persisted terminal success. Only native lifecycle ownership SHALL transition Preparing, Running, Finalizing and Cancelling; terminal lifecycle outcomes SHALL be immutable. Exact stale callbacks SHALL NOT mutate another run. Stop SHALL persist cancellation intent and publish Cancelling before waiting; admitted user cancellation SHALL take precedence over completion. Project shutdown with no owned resources SHALL succeed; failed settlement SHALL retain actionable ownership and block transition. Snapshots SHALL include accepted Population execution-commit/completion and native version/ready-mtime provenance, without requiring renderer filesystem probes.

#### Scenario: Renderer disappears during finalization

- **WHEN** all workers exit while the renderer is unavailable
- **THEN** native supervision SHALL verify targets and persist the terminal result independently

#### Scenario: Restart with durable finalization evidence

- **WHEN** external-stop confirmation has been accepted and recovery finds complete durable worker exits for an unacknowledged run
- **THEN** it SHALL resume idempotent target verification or replay the existing terminal result

#### Scenario: Restart without complete exits

- **WHEN** execution committed but complete worker-exit evidence is unavailable after external-stop confirmation
- **THEN** recovery SHALL preserve current artifacts and persist Interrupted

#### Scenario: Save or acknowledgement fails

- **WHEN** project metadata save or exact terminal acknowledgement fails
- **THEN** native terminal authority SHALL remain available for replay

### Requirement: Exact interrupted-run confirmation

When activation finds a nonterminal processing record without its matching in-process supervisor, native processing SHALL persist Interrupted with `availableAction: confirmStopped`. It SHALL preserve the launch journal and all current ExploreASL/scientific artifacts, allow project viewing, and block import/processing admission. `confirm_processing_workers_stopped` SHALL accept only the exact current run and revision, SHALL NOT accept or signal a PID/PGID, and SHALL reject stale or foreign confirmation.

After exact confirmation, native recovery SHALL restore proven GUI-owned artifacts only when execution was not committed. When execution was committed, it SHALL preserve current artifacts and clean only proven GUI-owned residue. It SHALL then publish an increasing snapshot with `availableAction: acknowledge`; project metadata save and exact acknowledgement SHALL retain their existing order.

#### Scenario: Interrupted run discovered after native crash

- **WHEN** activation finds a nonterminal current record without a matching in-process supervisor
- **THEN** it SHALL expose `confirmStopped`, preserve files, and block replacement execution

#### Scenario: Exact confirmation accepted

- **WHEN** the user confirms the current interrupted run and revision after checking operating-system process tools
- **THEN** native recovery SHALL apply the pre/post-commit artifact policy without signaling remembered process identities and SHALL expose acknowledgement

#### Scenario: Stale confirmation arrives

- **WHEN** confirmation names an obsolete run, project, or revision
- **THEN** it SHALL reject without changing current lifecycle, files, or execution admission

### Requirement: QC measures contain data rather than display labels

The `get_subject_session_qc` command SHALL return per-measure objects containing `key` and string `value` without display labels. Native extraction SHALL retain Structural and ASL-run selection, value formatting, error handling, and deterministic key ordering. Display-label resolution SHALL belong to the renderer.

#### Scenario: QC measures are returned for report viewing

- **WHEN** a valid subject-session QC collection is requested for a supported module and run
- **THEN** the native response SHALL contain sorted key/value measures and SHALL NOT compute or transmit human-readable metric labels

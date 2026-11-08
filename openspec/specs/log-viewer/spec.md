# log-viewer Specification

## Purpose

In-app viewing of ExploreASL module log files from the Subject Selector, with error detection and multi-run navigation.

## Requirements

### Requirement: List Module Logs Command

Native log discovery SHALL merge project and staging module logs with project precedence, exposing normalized subject/run metadata and bounded tail-error detection without treating mutex-only lines as errors.

#### Scenario: Module logs are discovered for a project

- **WHEN** `list_module_logs` scans available log directories
- **THEN** prefixes, identifiers, deduplication, error detection, and missing-file handling SHALL follow these rules:

The Rust backend SHALL provide a `list_module_logs` Tauri command that accepts a `project_root: String` parameter and returns a `Vec<LogFileInfo>` where each entry contains: `filename`, `module` (lowercase: "structural", "asl", "import", or "population"), `subject_session` (e.g., "sub-001Philips_01"), `run` (Option<String>, normalized numeric ASL run ID or None for other modules), and `has_error`. Error detection SHALL read at most the last 2048 bytes and check for a case-insensitive "error" substring on lines that do not contain case-insensitive "mutex is locked". The command SHALL scan `<project_root>/derivatives/ExploreASL/log/` and `<project_root>/.easl_staging/derivatives/ExploreASL/log/` for the corresponding `xASL_module_Structural`, `xASL_module_ASL`, `xASL_module_Import`, and `xASL_module_Population` prefixes. Identical filenames SHALL be deduplicated with the project log directory taking precedence. Structural and ASL `subject_session` SHALL be extracted using `sub-[^_]+_\d+`; Import SHALL use the subject-only match `sub-[^_\s.]+`, and Population SHALL use an empty identifier. If neither log directory exists, the command SHALL return an empty vector without error. If a file cannot be tail-read, `has_error` SHALL default to `false`.

#### Scenario: Multiple ASL runs discovered

- **WHEN** `list_module_logs` is called with a project root containing `xASL_module_ASL_sub-001_01_ASL_1.log` and `xASL_module_ASL_sub-001_01_ASL_2.log`
- **THEN** the result SHALL contain two entries with `module: "asl"`, `subject_session: "sub-001_01"`, `run: Some("1")` and `run: Some("2")` respectively

#### Scenario: Structural log with error

- **WHEN** `list_module_logs` is called and a Structural log file's last 2KB contains "ERROR:" on a non-mutex-related line
- **THEN** the corresponding entry SHALL have `has_error: true`

#### Scenario: Mutex-only error is ignored for error flags

- **WHEN** a log tail contains "ERROR: mutex is locked" and no other error line
- **THEN** the corresponding entry SHALL have `has_error: false`
- **AND** adding a separate "ERROR: file not found" line in the tail SHALL make `has_error` true

#### Scenario: Log directory absent

- **WHEN** `list_module_logs` is called and neither the project nor staging log directory exists
- **THEN** the command SHALL return an empty `Vec<LogFileInfo>` without error

### Requirement: Read Module Logs Command

Native log reading SHALL return matching module contents from project and staging directories with project precedence, lossy UTF-8 decoding, and the documented missing-directory and unknown-module behavior.

#### Scenario: A caller requests module log contents

- **WHEN** `read_module_logs` receives project, subject/session, and module arguments
- **THEN** filename selection, decoding, precedence, and validation SHALL follow these rules:

The Rust backend SHALL provide a `read_module_logs` Tauri command that accepts `project_root: String`, `subject_session: String`, and `module: String` parameters and returns a `HashMap<String, String>` mapping filenames to their full UTF-8 content. The command SHALL read matching filename prefixes from the same project and staging log directories used by discovery, with project-directory precedence for duplicate filenames. Structural, ASL, and Import SHALL use `xASL_module_{Module}_{subject_session}`; Population SHALL use `xASL_module_Population` without a subject/session suffix. If at least one log directory exists, unknown modules SHALL be rejected. Non-UTF8 content SHALL be converted lossily. If neither directory exists, the command SHALL return an empty HashMap before validating the module, including for unknown modules.

#### Scenario: Read Structural log for a subject

- **WHEN** `read_module_logs` is called with `subject_session: "sub-001_01"` and `module: "structural"`
- **THEN** the command SHALL return a HashMap containing the content of `xASL_module_Structural_sub-001_01.log`

#### Scenario: Read ASL logs with multiple runs

- **WHEN** `read_module_logs` is called with `subject_session: "sub-001_01"` and `module: "asl"` and there are two run files
- **THEN** the command SHALL return a HashMap with two entries: keys `xASL_module_ASL_sub-001_01_ASL_1.log` and `xASL_module_ASL_sub-001_01_ASL_2.log`, values being their respective file contents

### Requirement: Log Viewer Modal

The log modal SHALL display independently classified monospace lines in a wide scrollable view with module-specific titles and standard backdrop or close-button dismissal.

#### Scenario: Module log contents are displayed in a modal

- **WHEN** a supported module's log viewer opens
- **THEN** layout, line highlighting, title construction, and dismissal SHALL follow these rules:

The `LogViewerModal` component SHALL display ExploreASL module log content in a wide (85% viewport width) Mantine Modal with a backdrop. The modal SHALL render log content in a monospace `<pre>` block with horizontal scrolling and no line wrapping. Each line SHALL be individually rendered. Red highlighting SHALL require the case-sensitive substring "ERROR" or "Error"; lowercase "error" alone SHALL NOT receive red highlighting. Otherwise, a case-insensitive "warning" match SHALL receive yellow highlighting. This line classifier SHALL remain distinct from native tail-error detection and SHALL NOT suppress mutex-related lines. Structural and ASL titles SHALL include the module name and subject/session identifier; ASL titles SHALL NOT include the selected run number. Population SHALL use "Population Log" without a subject/session suffix. The modal SHALL close on backdrop click or X button click.

#### Scenario: Structural log with error lines

- **WHEN** a Structural log is opened that contains the line "ERROR: ASL module terminated for subject 1"
- **THEN** that line SHALL be rendered with a red-tinted background

#### Scenario: Warning lines highlighted

- **WHEN** a log contains the line "WARNING: M0 not found"
- **THEN** that line SHALL be rendered with a yellow-tinted background

#### Scenario: Lowercase error is not highlighted

- **WHEN** a log contains "lowercase error in text" without "ERROR", "Error", or a warning match
- **THEN** that line SHALL retain default styling, even if the file's native error flag is true

#### Scenario: ASL title does not track selected run

- **WHEN** the user views Run 2 for `sub-001_01`
- **THEN** the title SHALL read "ASL Log — sub-001 / ses-01", with an error badge if flagged, but without "Run 2"

### Requirement: ASL Run Selector

Multiple ASL log files SHALL expose a selector using supplied filename error flags, preferring the first flagged file and retaining selected-file display and scroll behavior.

#### Scenario: The log modal receives multiple ASL files

- **WHEN** log entries arrive or the user selects another run
- **THEN** selector visibility, ordering, icons, and scrolling SHALL follow these rules:

When an ASL module log has multiple files, the LogViewerModal SHALL display a Mantine `Select` component allowing the user to switch between runs. Each option SHALL display an alert icon next to the run label when its filename has a true flag in the supplied `runErrorMap`, using Mantine's `renderOption` prop; the modal SHALL NOT derive this flag by rescanning full content. The Select SHALL be hidden for zero or one file and for non-ASL modules. When the user switches runs, the modal SHALL display the selected file's content and auto-scroll to the bottom if that file is flagged. On receiving log entries and error flags, initial selection SHALL prefer the first flagged file in filename order, otherwise the first file.

#### Scenario: Multi-run ASL with one errored run

- **WHEN** an ASL log modal is opened with 3 runs, where only Run 2 is flagged in `runErrorMap`
- **THEN** the Select SHALL show "Run 1", "Run 2", and "Run 3", with an alert icon on Run 2, and Run 2 SHALL be initially selected

#### Scenario: Auto-scroll on run switch to errored run

- **WHEN** the user switches the Select from Run 1 to Run 2 (which has a true error flag)
- **THEN** the modal SHALL auto-scroll to the bottom of Run 2's content

#### Scenario: Single run Select hidden

- **WHEN** an ASL subject/session has only one run
- **THEN** the Select component SHALL NOT be rendered

### Requirement: Auto-scroll on Error Detection

The selected filename's supplied error flag SHALL control log error badges and conditional auto-scroll without overriding subsequent manual scrolling while selection and flag remain unchanged.

#### Scenario: Selected log identity or supplied error flag changes

- **WHEN** the modal evaluates error feedback for any supported module
- **THEN** flag ownership, incomplete-status fallback, and scroll behavior SHALL follow these rules:

The LogViewerModal SHALL automatically scroll to the bottom when the selected filename or its supplied error flag changes and that flag is true. The same flag SHALL control the title's "ERRORS DETECTED" badge. SubjectSelection SHALL supply `hasError || moduleIncomplete` for discovered files; native mutex filtering SHALL NOT suppress this caller's incomplete-status fallback. Full-content highlighting SHALL NOT determine auto-scroll or the badge. This SHALL apply to all supported modules. Subsequent manual scrolling SHALL NOT be overridden while the selection and error flag remain unchanged.

#### Scenario: Structural log with error opens at bottom

- **WHEN** a Structural log modal is opened with a true `runErrorMap` flag for the displayed file
- **THEN** the modal SHALL scroll to the bottom of the log content immediately

#### Scenario: Error-free log opens at top

- **WHEN** a newly opened log has no true error flag
- **THEN** the modal SHALL display from the top of the log content

#### Scenario: Highlighted mutex line with false supplied flag

- **WHEN** the displayed log contains "ERROR: mutex is locked" and its supplied `runErrorMap` flag is false, without an incomplete-status override
- **THEN** the line SHALL be highlighted red without an "ERRORS DETECTED" badge or error-triggered auto-scroll

### Requirement: Log Viewer Data Flow

Log callers SHALL own discovery, fetches, content, and error flags locally, passing them to a rendering-only modal rather than storing log state in `processingStore`.

#### Scenario: Subject or Population controls open and close module logs

- **WHEN** callers discover logs or handle a log-view action
- **THEN** fetch ownership, refresh triggers, modal inputs, and cleanup SHALL follow these rules:

The caller SHALL fetch log content on a log-view action by calling `read_module_logs` with the selected subject/session and module, then pass content, loading/error state, and a filename-keyed `runErrorMap` to `LogViewerModal`. The modal SHALL select and render supplied content without invoking the backend. SubjectSelection SHALL retain available files, native error flags, and modal content in component-local state; discovery SHALL run on mount and project-root changes. Closing its modal SHALL clear content, loading, and error state. PopulationSection SHALL likewise own its log data locally and additionally refresh discovery on processing-phase changes. These log data SHALL NOT be stored in `processingStore`.

#### Scenario: Caller fetches content on open

- **WHEN** the user clicks a log viewing button
- **THEN** the caller SHALL call `read_module_logs` and the modal SHALL display the returned content supplied through props

#### Scenario: Content cleared on close

- **WHEN** the user closes the LogViewerModal
- **THEN** the caller's modal content state SHALL be reset to empty

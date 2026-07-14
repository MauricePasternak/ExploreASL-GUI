# log-viewer Specification

## Purpose

In-app viewing of ExploreASL module log files from the Subject Selector, with error detection and multi-run navigation.

## Requirements

### Requirement: List Module Logs Command

The Rust backend SHALL provide a `list_module_logs` Tauri command that accepts a `project_root: String` parameter and returns a `Vec<LogFileInfo>` where each entry contains: `filename`, `module` (lowercase: "structural" or "asl"), `subject_session` (e.g., "sub-001Philips*01"), `run` (Option<String>, e.g., "1" for ASL runs, None for Structural), and `has_error` (bool, determined by reading the last 2KB of each file and checking for a case-insensitive "error" substring). The command SHALL scan the `<project_root>/derivatives/ExploreASL/log/` directory for files matching the prefixes `xASL_module_Structural` and `xASL_module_ASL`. The `subject_session` SHALL be extracted using the regex `sub-[^*]+\_\d+`. If the log directory does not exist, the command SHALL return an empty vector without error. If a file cannot be tail-read, `has_error`SHALL default to`false`.

#### Scenario: Multiple ASL runs discovered

- **WHEN** `list_module_logs` is called with a project root containing `xASL_module_ASL_sub-001_01_ASL_1.log` and `xASL_module_ASL_sub-001_01_ASL_2.log`
- **THEN** the result SHALL contain two entries with `module: "asl"`, `subject_session: "sub-001_01"`, `run: Some("1")` and `run: Some("2")` respectively

#### Scenario: Structural log with error

- **WHEN** `list_module_logs` is called and a Structural log file's last 2KB contains the string "ERROR:"
- **THEN** the corresponding entry SHALL have `has_error: true`

#### Scenario: Log directory absent

- **WHEN** `list_module_logs` is called and `<project_root>/derivatives/ExploreASL/log/` does not exist
- **THEN** the command SHALL return an empty `Vec<LogFileInfo>` without error

### Requirement: Read Module Logs Command

The Rust backend SHALL provide a `read_module_logs` Tauri command that accepts `project_root: String`, `subject_session: String`, and `module: String` parameters and returns a `HashMap<String, String>` mapping filenames to their full UTF-8 content. The command SHALL read all log files in `<project_root>/derivatives/ExploreASL/log/` that match the pattern `xASL_module_{Module}_{subject_session}*.log` where Module is the PascalCase module name derived from the lowercase input. Non-UTF8 content SHALL be converted lossily. If the directory does not exist, the command SHALL return an empty HashMap.

#### Scenario: Read Structural log for a subject

- **WHEN** `read_module_logs` is called with `subject_session: "sub-001_01"` and `module: "structural"`
- **THEN** the command SHALL return a HashMap containing the content of `xASL_module_Structural_sub-001_01.log`

#### Scenario: Read ASL logs with multiple runs

- **WHEN** `read_module_logs` is called with `subject_session: "sub-001_01"` and `module: "asl"` and there are two run files
- **THEN** the command SHALL return a HashMap with two entries: keys `xASL_module_ASL_sub-001_01_ASL_1.log` and `xASL_module_ASL_sub-001_01_ASL_2.log`, values being their respective file contents

### Requirement: Log Viewer Modal

The `LogViewerModal` component SHALL display ExploreASL module log content in a wide (85% viewport width) Mantine Modal with a backdrop. The modal SHALL render log content in a monospace `<pre>` block with horizontal scrolling (`overflow-x: auto`) and no line wrapping. Each line of the log content SHALL be individually rendered. Lines containing a case-insensitive match for "error" SHALL be displayed with a red-tinted background. Lines containing a case-insensitive match for "warning" (but not "error") SHALL be displayed with a yellow-tinted background. The modal title SHALL include the module name, subject/session identifier, and run number (for ASL). The modal SHALL close on backdrop click or X button click.

#### Scenario: Structural log with error lines

- **WHEN** a Structural log is opened that contains the line "ERROR: ASL module terminated for subject 1"
- **THEN** that line SHALL be rendered with a red-tinted background

#### Scenario: Warning lines highlighted

- **WHEN** a log contains the line "WARNING: M0 not found"
- **THEN** that line SHALL be rendered with a yellow-tinted background

### Requirement: ASL Run Selector

When an ASL module log has multiple runs, the LogViewerModal SHALL display a Mantine `Select` component at the top of the modal allowing the user to switch between runs. Each option in the Select SHALL display a ⚠️ icon next to the run label if that run's log contains a case-insensitive "error" match, using Mantine's `renderOption` prop. The Select SHALL be hidden when there is exactly one log file (single run or Structural). When the user switches runs, the modal SHALL display the content of the newly selected run's log file. When switching to a run that has errors, the modal SHALL auto-scroll to the bottom of the log content.

#### Scenario: Multi-run ASL with one errored run

- **WHEN** an ASL log modal is opened with 3 runs, where Run 2 has errors
- **THEN** the Select SHALL show options "Run 1", "Run 2 ⚠️", "Run 3", and Run 2's option SHALL display a ⚠️ indicator

#### Scenario: Auto-scroll on run switch to errored run

- **WHEN** the user switches the Select from Run 1 to Run 2 (which has errors)
- **THEN** the modal SHALL auto-scroll to the bottom of Run 2's content

#### Scenario: Single run Select hidden

- **WHEN** an ASL subject/session has only one run
- **THEN** the Select component SHALL NOT be rendered

### Requirement: Auto-scroll on Error Detection

When the LogViewerModal opens and the displayed log content contains a case-insensitive "error" match, the modal SHALL automatically scroll to the bottom of the log content. This applies to both Structural and ASL logs. Auto-scroll SHALL only trigger on initial open and on run switch — subsequent manual scrolling by the user SHALL NOT be overridden.

#### Scenario: Structural log with error opens at bottom

- **WHEN** a Structural log modal is opened and the log contains "ERROR:"
- **THEN** the modal SHALL scroll to the bottom of the log content immediately

#### Scenario: Error-free log opens at top

- **WHEN** a log with no errors is opened
- **THEN** the modal SHALL display from the top of the log content

### Requirement: Log Viewer Data Flow

The LogViewerModal SHALL fetch log content on open by calling `read_module_logs` with the selected subject_session and module. Content SHALL be stored in modal-local state (`useState`) and cleared on close. The list of available log files and their error status SHALL be stored in component-local state within `SubjectSelection.tsx` and fetched once on mount via `list_module_logs`. The data SHALL NOT be stored in `processingStore`.

#### Scenario: Modal fetches content on open

- **WHEN** the user clicks a log viewing button
- **THEN** the modal SHALL call `read_module_logs` and display the returned content

#### Scenario: Content cleared on close

- **WHEN** the user closes the LogViewerModal
- **THEN** the modal content state SHALL be reset to empty

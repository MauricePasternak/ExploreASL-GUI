# auto-update Specification

## Purpose

Define safe production update checks and user-directed installation behavior.

## Requirements

### Requirement: Production startup check

The application SHALL check for a signed update exactly once after global settings are loaded in a production startup. Development and E2E runs SHALL skip the check. The check SHALL use a 30-second timeout. Failures SHALL be logged without a user notification.

#### Scenario: No release is available

- **WHEN** the startup updater check returns no update
- **THEN** no update notification is shown

#### Scenario: Check fails

- **WHEN** the startup updater check rejects or times out
- **THEN** the failure is logged and the application continues without an error toast

### Requirement: Update availability notification

The application SHALL show an available update as a lower-right Mantine notification with `autoClose: 10000`, a stable notification ID, the available version, and an Update action. Release body text SHALL NOT be rendered.

#### Scenario: Update available

- **WHEN** a newer signed release is found
- **THEN** the notification displays its version and an Update button for ten seconds

### Requirement: Guarded update installation

Update installation SHALL require confirmed, successful settlement of dirty state and active work, with a final eligibility check before installation.

#### Scenario: Update preparation encounters dirty state or active work

- **WHEN** an update is requested or finishes downloading
- **THEN** installation admission and preparation SHALL follow these rules:

The application SHALL install immediately when no project changes are dirty and no processing or import is active. Otherwise it SHALL request confirmation. Active work includes processing and import `preparing`, `running`, `finalizing`, and `cancelling`, plus `importRunning`.

On confirmation the application SHALL stop processing through `killProcessing`, cancel cancellable import through `cancel_import_run` using its exact attached run ID, reconcile its terminal result, save dirty project state, and only then download/install. Import finalization or cancellation still in progress SHALL block update preparation rather than authorize another cancellation. Abort, reconciliation, or save failure SHALL prevent installation and show a persistent actionable error. Cancelling the modal SHALL not alter work or install. The application SHALL recheck for dirty or active work before installation so work started during download is not interrupted.

#### Scenario: Dirty processing project

- **WHEN** a project is dirty while processing is running and the user confirms update
- **THEN** processing is stopped, changes are saved, and installation starts in that order

#### Scenario: Save fails

- **WHEN** saving dirty project state fails while preparing an update
- **THEN** no updater download starts and an actionable error is displayed

#### Scenario: Import is finalizing

- **WHEN** the user confirms an update while import is finalizing
- **THEN** no cancellation or updater download SHALL start and an actionable error SHALL require import finalization to finish

### Requirement: Download, install, and relaunch feedback

The updater SHALL maintain persistent progress feedback, report failures without relaunching, and complete successful installation using the platform-specific handoff.

#### Scenario: Updater reports download and installation events

- **WHEN** download or installation progresses, fails, or completes
- **THEN** notification lifetime and relaunch behavior SHALL follow these rules:

The application SHALL maintain one persistent progress notification from updater Started, Progress, and Finished events. Finished SHALL change the message to "Installing update…", and installation SHALL use that message with `autoClose: false`. Download/install failures SHALL remove the progress notification, show a persistent red error, and SHALL NOT relaunch. After successful installation, Linux and macOS SHALL relaunch through the process plugin. Windows SHALL hand off installation to the updater without an explicit frontend relaunch or progress-notification completion step; notification lifetime SHALL remain subject to the application/installer process lifecycle.

#### Scenario: Installation succeeds on Windows

- **WHEN** the Windows updater installation call returns successfully
- **THEN** the frontend SHALL return without explicitly relaunching or completing/hiding the progress notification, whose last message SHALL be "Installing update…"

### Requirement: Signed release artifacts

Release builds SHALL require updater private key, private-key password, and public key configuration before creating a draft release. The workflow SHALL generate signed updater artifacts and public GitHub Release `latest.json` for Linux x64 AppImage (plus deb), Windows x64 installers, and macOS arm64/Intel. The public updater key SHALL be embedded only by release build configuration; updater signature verification SHALL have no unsigned fallback.

#### Scenario: Release build creates signed updater artifacts

- **WHEN** a release build has the required updater key configuration
- **THEN** it generates signed platform updater artifacts and a public GitHub Release `latest.json`

# auto-update Specification

## ADDED Requirements

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

The application SHALL install immediately when no project changes are dirty and no processing or import is preparing/running. Otherwise it SHALL request confirmation. Active work includes processing `preparing`/`running`, import `preparing`/`running`, and `importRunning`.

On confirmation the application SHALL stop processing through `killProcessing`, stop import through `stop_active_import`, save dirty project state, and only then download/install. Abort or save failure SHALL prevent installation and show a ten-second actionable error. Cancelling the modal SHALL not alter work or install. The application SHALL recheck for dirty or active work before installation so work started during download is not interrupted.

#### Scenario: Dirty processing project

- **WHEN** a project is dirty while processing is running and the user confirms update
- **THEN** processing is stopped, changes are saved, and installation starts in that order

#### Scenario: Save fails

- **WHEN** saving dirty project state fails while preparing an update
- **THEN** no updater download starts and an actionable error is displayed

### Requirement: Download, install, and relaunch feedback

The application SHALL maintain one persistent progress notification from updater Started, Progress, and Finished events. Download/install failures SHALL show a red ten-second error and SHALL NOT relaunch. After successful installation, Linux and macOS SHALL relaunch through the process plugin. Windows SHALL not explicitly relaunch because its installer exits/restarts the app.

#### Scenario: Installation succeeds on Windows

- **WHEN** updater installation finishes successfully on Windows
- **THEN** the persistent progress notification completes and the application does not explicitly relaunch

### Requirement: Signed release artifacts

Release builds SHALL require updater private key, private-key password, and public key configuration before creating a draft release. The workflow SHALL generate signed updater artifacts and public GitHub Release `latest.json` for Linux x64 AppImage (plus deb), Windows x64 installers, and macOS arm64/Intel. The public updater key SHALL be embedded only by release build configuration; updater signature verification SHALL have no unsigned fallback.

#### Scenario: Release build creates signed updater artifacts

- **WHEN** a release build has the required updater key configuration
- **THEN** it generates signed platform updater artifacts and a public GitHub Release `latest.json`

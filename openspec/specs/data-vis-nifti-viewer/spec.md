# data-vis-nifti-viewer Specification

## Purpose

Define NIfTI volume delivery and viewing for population analysis data.

## Requirements

### Requirement: Custom NiiVue Tauri Protocol

The native `niivue://` protocol SHALL resolve qCBF and rT1 images within the active project's Population directory using native filename templates and canonical-path confinement.

#### Scenario: A viewer requests qCBF or structural image data

- **WHEN** a supported `niivue://` URL is resolved
- **THEN** URL compatibility, identifiers, filenames, and root authority SHALL follow these rules:

A custom Tauri protocol `niivue://` SHALL be registered in `tauri::Builder`. It SHALL serve qCBF and rT1 NIfTI files from the active project's Population directory. Existing `niivue://localhost/qCBF/{participant_id}/{run}` URLs SHALL remain supported, with optional `.nii` or `.nii.gz` on Run. `niivue://localhost/rT1/{participant_id}` SHALL resolve `rT1_{participant_id}.nii`, with optional `.nii` or `.nii.gz` on the identifier and no Run segment. Raw participant identifiers SHALL be preserved: GUI Session is ExploreASL Visit; GUI Run is ExploreASL Session (TSV `session`). Rust SHALL own filename templates and SHALL try `.nii` before `.nii.gz`. The existing active-project root registry and canonical-path confinement SHALL remain authoritative.

#### Scenario: qCBF volume served with run

- **WHEN** NiiVue fetches `niivue://localhost/qCBF/sub-001Philips_01/ASL_1`
- **THEN** Rust SHALL resolve `<root>/derivatives/ExploreASL/Population/qCBF_sub-001Philips_01_ASL_1.nii` and return raw bytes

#### Scenario: Gzip fallback

- **WHEN** the requested qCBF or rT1 `.nii` file is absent and the corresponding `.nii.gz` exists
- **THEN** the protocol SHALL serve the compressed file without changing voxel data

#### Scenario: Unknown volume type returns 404

- **WHEN** NiiVue fetches `niivue://localhost/unknownType/sub-X_01/ASL_1`
- **THEN** the protocol SHALL return a 404 response

#### Scenario: Path traversal rejected

- **WHEN** a resolved volume path is outside the canonical project root
- **THEN** the protocol SHALL reject the request with 403; unresolved paths SHALL return 404

#### Scenario: Session-specific anatomy

- **WHEN** NiiVue fetches `niivue://localhost/rT1/sub-01_1`
- **THEN** Rust SHALL serve `Population/rT1_sub-01_1.nii` or its gzip alternative, not anatomy from another Session or Run

#### Scenario: Malformed structural request

- **WHEN** an rT1 request has an empty participant identifier or an additional Run segment
- **THEN** the protocol SHALL return 400 without serving a file

### Requirement: AppState Project Root Registry

The AppState SHALL maintain a `Mutex<Option<PathBuf>>` storing the active project root path. A `set_active_project(rootPath: String)` command SHALL set the registry when a project opens. The registry SHALL be cleared (set to `None`) when the project closes. The custom protocol handler SHALL read from this registry for path resolution. If the registry is empty when a protocol request arrives, the handler SHALL return a 404.

#### Scenario: Project root set on open

- **WHEN** a project is opened and `set_active_project` is called with the project root path
- **THEN** the AppState registry SHALL store the path

#### Scenario: Project root cleared on close

- **WHEN** the project is closed
- **THEN** the AppState registry SHALL be set to `None`

#### Scenario: Protocol request with no active project

- **WHEN** a `niivue://` request is made but the registry is `None`
- **THEN** the protocol SHALL return a 404 response

### Requirement: Viewer Panel States

Viewer panes SHALL independently expose idle, loading, loaded, and error states, discarding replaced images without affecting other panes and retaining the specified selection and pin behavior.

#### Scenario: Selection changes or an image load fails

- **WHEN** a viewer pane has no selection or loads a replacement image
- **THEN** skeletons, visibility, errors, and pane independence SHALL follow these rules:

The primary pane SHALL always be visible. With WebGL2 available and no selected point it SHALL show header/image skeletons and "Click on a datapoint to load in its respective qCBF image." with its canvas hidden. Each pane SHALL have independent idle/loading/loaded/error presentation. Replacement SHALL remove that pane's old image before loading begins; failure SHALL NOT restore it or affect the other pane. qCBF failures SHALL retain "Failed to load image for {participantId}_{run}."; rT1 failures SHALL show "Failed to load structural image for {participantId}." Missing and unreadable files SHALL use the same modality-specific message. An existing pin SHALL remain visible in Pinned mode when primary selection clears.

#### Scenario: Placeholder before first click

- **WHEN** Visualize is entered without selection or a pin and WebGL2 is available
- **THEN** primary SHALL show the existing skeleton/message state with its canvas hidden

#### Scenario: Loading overlay on image fetch

- **WHEN** a pane begins loading an image
- **THEN** that pane SHALL display a loading overlay independently of the other pane

#### Scenario: Previous volume removed during replacement

- **WHEN** a pane replaces its displayed scan
- **THEN** its previous volume SHALL be removed before awaiting replacement, regardless of eventual success

#### Scenario: Image loaded successfully

- **WHEN** a current image finishes loading
- **THEN** its pane SHALL dismiss loading and apply the modality's layout and colormap

#### Scenario: Image file exists but fails to load

- **WHEN** a qCBF load rejects because the file is corrupt or unreadable
- **THEN** that pane SHALL display "Failed to load image for {participantId}_{run}." without restoring its previous volume

#### Scenario: Structural image unavailable

- **WHEN** Structural mode cannot load the selected participant's rT1
- **THEN** companion SHALL show "Failed to load structural image for {participantId}." while primary qCBF remains usable

### Requirement: WebGL2 Error Handling

Each pane SHALL check WebGL2 availability before creating its viewer. An unavailable pane SHALL show "WebGL2 not available. Cannot render NIfTI images." A pane losing its context SHALL show "WebGL context lost. Restart the application to restore the viewer." Failed panes SHALL be disconnected from synchronization. The chart and any healthy pane SHALL remain functional.

#### Scenario: WebGL2 unavailable on mount

- **WHEN** a pane cannot obtain WebGL2
- **THEN** it SHALL show the unavailable message without creating its viewer

#### Scenario: Chart functional without WebGL2

- **WHEN** WebGL2 is unavailable
- **THEN** chart hover, click, axis assignment, and filters SHALL remain functional

#### Scenario: WebGL context loss during session

- **WHEN** one pane loses its WebGL context
- **THEN** it SHALL show the context-loss message while chart and healthy pane remain interactive

### Requirement: qCBF Image Path Resolution

qCBF lookup SHALL preserve raw participant and Run values, prefer `.nii` before `.nii.gz`, and present one load-failure message for missing or unreadable images.

#### Scenario: A datapoint selects its qCBF image

- **WHEN** the viewer resolves an image from a clicked datapoint
- **THEN** filename construction, fallback, and error presentation SHALL follow these rules:

The qCBF filename SHALL be constructed as `qCBF_{participant_id}_{run}.nii` using the raw `participant_id` and `run` (TSV `session` column value) from the clicked datapoint. No Subject/Session splitting is needed — the `participant_id` is used verbatim. The protocol SHALL try `.nii` first, then fall back to `.nii.gz`. If neither resolves, the protocol SHALL return 404. The frontend SHALL use the generic "Failed to load image for {participantId}_{run}." when the image load rejects; it SHALL NOT distinguish missing files from unreadable images in that message.

#### Scenario: NIfTI file found

- **WHEN** the clicked point has participant_id="sub-001Philips_01" and run="ASL_1"
- **THEN** the protocol SHALL serve `qCBF_sub-001Philips_01_ASL_1.nii`

#### Scenario: Gzip fallback

- **WHEN** `qCBF_sub-001Philips_01_ASL_1.nii` does not exist but `.nii.gz` does
- **THEN** the protocol SHALL serve the `.nii.gz` file

#### Scenario: Both formats missing

- **WHEN** neither `.nii` nor `.nii.gz` exists for the clicked point
- **THEN** the protocol SHALL return 404 and a rejected viewer load SHALL show "Failed to load image for sub-001Philips_01_ASL_1." without restoring the previous volume

#### Scenario: Image file exists but fails to load

- **WHEN** the qCBF file exists but its image load rejects
- **THEN** the viewer panel SHALL show "Failed to load image for {participantId}_{run}." and dismiss the loading overlay without restoring the previous volume

### Requirement: NiiVue Background Preference

NiiVue's rendered background SHALL follow persisted `nvBackColor` (`black`, `gray`, or `white`), defaulting to black, independently of the Mantine color scheme. The canvas element's CSS background SHALL remain black. The viewer header and loading/error overlays SHALL adapt to Mantine's color scheme without changing the saved NiiVue background preference.

#### Scenario: Default background

- **WHEN** no NiiVue background preference is saved
- **THEN** NiiVue SHALL use a black background in either Mantine color scheme

#### Scenario: White background preference

- **WHEN** the user selects the white background in Visualization Settings
- **THEN** `nvBackColor` SHALL persist as `white` and NiiVue SHALL use a white rendered background while the canvas CSS background remains black

#### Scenario: Theme switch preserves viewer preference

- **WHEN** the user switches the theme from dark to light while the viewer is open
- **THEN** the rendered background SHALL continue to follow `nvBackColor`, and the canvas CSS background SHALL remain black

### Requirement: NiiVue Package Integration

The `@niivue/niivue` npm package SHALL be used as the NIfTI viewer. It SHALL be installed as a runtime dependency (in `dependencies`, not `devDependencies`). NiiVue SHALL load volumes via the custom `niivue://` protocol URL, not via direct file paths.

#### Scenario: NiiVue loaded from npm

- **WHEN** the viewer component imports NiiVue
- **THEN** it SHALL import from `@niivue/niivue` (npm package), not from CDN or script tag

#### Scenario: Volume loaded via custom protocol

- **WHEN** NiiVue loads a qCBF volume
- **THEN** it SHALL fetch from a `niivue://` URL, not a filesystem path

### Requirement: Independent pane rendering preferences

Each pane SHALL retain one viewer across image changes and release it on unmount. Existing saved layout, background, orientation, crosshair, and colorbar preferences SHALL apply to both panes; qCBF SHALL use saved `nvColormap` (default gray), rT1 grayscale. Automatic windowing SHALL ignore stale header limits without altering voxels or NIfTI scaling, unless explicit shared CBF limits apply.

#### Scenario: Apply existing preferences

- **WHEN** an existing project opens with axial layout and viridis selected
- **THEN** qCBF panes SHALL use axial/viridis and Structural SHALL use axial/grayscale without changing saved preferences

#### Scenario: Existing layouts remain available

- **WHEN** a saved layout is applied
- **THEN** panes SHALL support multiplanar with orthogonal slices and 3D rendering, axial, coronal, sagittal, and render layouts

#### Scenario: Spatial continuity

- **WHEN** primary qCBF loads for the first time or a linked image is replaced
- **THEN** first primary load SHALL center its crosshair and subsequent linked loads SHALL preserve the current world-space position

#### Scenario: Preserve robust windowing and voxel scaling

- **WHEN** a qCBF image has stale header display limits and shared windowing is off
- **THEN** automatic limits SHALL reflect voxel intensities while stored voxels and NIfTI scaling remain unchanged

#### Scenario: Stale display limits inside the voxel range

- **WHEN** qCBF or rT1 has stale header display limits that fall inside its voxel intensity range
- **THEN** automatic windowing SHALL ignore those limits, including after a colormap change, without changing source files, voxel values, geometry, or slope/intercept scaling
- **AND** explicit shared qCBF limits SHALL take precedence over automatic windowing and remain independent of structural contrast

#### Scenario: Reuse and release viewers

- **WHEN** a mounted pane changes scan, then unmounts
- **THEN** scan replacement SHALL reuse its viewer and unmount SHALL release its viewer, listeners, and synchronization references

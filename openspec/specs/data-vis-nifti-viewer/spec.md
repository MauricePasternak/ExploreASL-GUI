# data-vis-nifti-viewer Specification

## Purpose

Define NIfTI volume delivery and viewing for population analysis data.

## Requirements

### Requirement: Custom NiiVue Tauri Protocol

A custom Tauri protocol `niivue://` SHALL be registered in `tauri::Builder`. The protocol SHALL serve qCBF NIfTI files from the project's Population directory. The URL format SHALL be `niivue://localhost/qCBF/{participant_id}/{run}`, optionally with a `.nii` or `.nii.gz` suffix on the run. Run corresponds to the TSV `session` column value (e.g. `ASL_1`). Rust SHALL own the filename template. The AppState SHALL maintain a project root registry for path resolution, set via a `set_active_project` command when a project opens, and cleared when the project closes.

#### Scenario: qCBF volume served with run

- **WHEN** NiiVue fetches `niivue://localhost/qCBF/sub-001Philips_01/ASL_1`
- **THEN** Rust SHALL resolve `<root>/derivatives/ExploreASL/Population/qCBF_sub-001Philips_01_ASL_1.nii` and return raw bytes

#### Scenario: Gzip fallback

- **WHEN** the `.nii` file does not exist but `qCBF_sub-001Philips_01_ASL_1.nii.gz` does
- **THEN** Rust SHALL serve the `.nii.gz` file

#### Scenario: Unknown volume type returns 404

- **WHEN** NiiVue fetches `niivue://localhost/unknownType/sub-X_01/ASL_1`
- **THEN** the protocol SHALL return a 404 response

#### Scenario: Path traversal rejected

- **WHEN** a resolved volume path is outside the canonical project root
- **THEN** the protocol SHALL reject the request with a 403 response; paths that cannot be resolved SHALL return 404

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

### Requirement: NiiVue Rendering Preferences

The viewer panel SHALL use a single NiiVue instance on one canvas, created after the mount-time WebGL2 availability check and cleaned up on component unmount. Layout SHALL follow persisted `nvSliceType`: `multiplanar` (default), `axial`, `coronal`, `sagittal`, or `render`. Multiplanar mode SHALL configure a grid with axial, sagittal, coronal, and 3D rendering. Colormap SHALL follow persisted `nvColormap`, defaulting to `gray`. Settings changes SHALL update the existing instance. Volume swaps SHALL remove the old volume before awaiting `loadVolumes` for the replacement, without destroying the instance. The crosshair SHALL initialize at the center of volume.

#### Scenario: Tri-planar grid renders on load

- **WHEN** a qCBF volume is loaded with `nvSliceType` set to `multiplanar`
- **THEN** the canvas SHALL use the multiplanar grid layout with orthogonal slices and 3D rendering

#### Scenario: Configured colormap

- **WHEN** a qCBF volume is rendered with `nvColormap` set to `viridis`
- **THEN** NiiVue SHALL apply `viridis`; without a saved preference, it SHALL use `gray`

#### Scenario: Stale qCBF header display limits

- **WHEN** a qCBF volume has header display limits outside its actual voxel intensity range
- **THEN** the NiiVue instance SHALL be configured with `trustCalMinMax: false` so `loadVolumes` uses its robust intensity window instead of those stale limits, without changing voxel values or NIfTI slope/intercept scaling

#### Scenario: Single-plane preference

- **WHEN** the user sets `nvSliceType` to `axial` in Visualization Settings
- **THEN** the preference SHALL persist and the existing NiiVue instance SHALL switch to axial layout

#### Scenario: Crosshair starts at volume center

- **WHEN** a qCBF volume is loaded
- **THEN** the crosshair SHALL be positioned at the geometric center of the image volume

#### Scenario: Volume swap preserves instance

- **WHEN** a new qCBF volume is loaded after clicking a different datapoint
- **THEN** the NiiVue instance SHALL NOT be destroyed and recreated; its existing volume SHALL be removed before `loadVolumes` loads the replacement

#### Scenario: Instance destroyed on unmount

- **WHEN** the viewer component unmounts (user leaves the visualization phase)
- **THEN** the NiiVue instance SHALL be destroyed and WebGL resources released

### Requirement: Viewer Panel States

The viewer panel SHALL always be visible (not toggled on first click). With WebGL2 available and no selected point, it SHALL show header/image skeletons and "Click on a datapoint to load in its respective qCBF image." while hiding the canvas. When a point is clicked, the panel SHALL show a loading overlay while the image loads. The current volume SHALL be removed before the replacement load begins. If loading rejects, the panel SHALL show an error overlay with "Failed to load image for {participantId}_{run}." and SHALL NOT restore the removed volume. Missing files and other image load failures SHALL use this same frontend message rather than distinct missing/unreadable messages.

#### Scenario: Placeholder before first click

- **WHEN** the Visualize step is entered and no point has been clicked
- **THEN** with WebGL2 available, the viewer panel SHALL show skeleton placeholders and "Click on a datapoint to load in its respective qCBF image." with the canvas hidden

#### Scenario: Loading overlay on image fetch

- **WHEN** a point is clicked and the qCBF image is being fetched
- **THEN** a loading indicator SHALL be displayed over the viewer panel

#### Scenario: Previous volume removed during replacement

- **WHEN** a point is clicked while a previous image is displayed
- **THEN** the previous volume SHALL be removed from NiiVue before awaiting the replacement load; successful replacement SHALL NOT be required before removal

#### Scenario: Image loaded successfully

- **WHEN** the qCBF image finishes loading
- **THEN** the loading overlay SHALL be dismissed and the configured layout/colormap SHALL be applied to the new image

#### Scenario: Image file exists but fails to load

- **WHEN** a qCBF load rejects because the file is corrupt or unreadable by NiiVue
- **THEN** the loading overlay SHALL be replaced by "Failed to load image for {participantId}_{run}." without restoring the previous volume

### Requirement: WebGL2 Error Handling

On NiiVue component mount, the viewer SHALL check WebGL2 context availability. If WebGL2 is unavailable, the viewer panel SHALL show: "WebGL2 not available. Cannot render NIfTI images." and the NiiVue instance SHALL NOT be created. The chart panel SHALL remain fully functional. If a WebGL context loss event occurs during a session, the viewer SHALL show: "WebGL context lost. Restart the application to restore the viewer." and the chart SHALL remain functional.

#### Scenario: WebGL2 unavailable on mount

- **WHEN** the viewer component mounts and WebGL2 is not available in the WebView
- **THEN** the panel SHALL show "WebGL2 not available. Cannot render NIfTI images." and no NiiVue instance SHALL be created

#### Scenario: Chart functional without WebGL2

- **WHEN** WebGL2 is unavailable
- **THEN** the chart panel SHALL remain fully interactive (hover, click, axis assignment, filters)

#### Scenario: WebGL context loss during session

- **WHEN** a WebGL context loss event fires while viewing an image
- **THEN** the viewer panel SHALL show "WebGL context lost. Restart the application to restore the viewer." and the chart SHALL remain functional

### Requirement: qCBF Image Path Resolution

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

### Requirement: Single Volume Rendering

The viewer SHALL render exactly one qCBF volume at a time. No overlay volumes (brain masks, PV maps, etc.) SHALL be loaded. Future volume type support is via the protocol's volume type segment, not via overlay UI.

#### Scenario: No overlay support

- **WHEN** a qCBF volume is displayed
- **THEN** no overlay volume SHALL be loaded or rendered

### Requirement: NiiVue Package Integration

The `@niivue/niivue` npm package SHALL be used as the NIfTI viewer. It SHALL be installed as a runtime dependency (in `dependencies`, not `devDependencies`). NiiVue SHALL load volumes via the custom `niivue://` protocol URL, not via direct file paths.

#### Scenario: NiiVue loaded from npm

- **WHEN** the viewer component imports NiiVue
- **THEN** it SHALL import from `@niivue/niivue` (npm package), not from CDN or script tag

#### Scenario: Volume loaded via custom protocol

- **WHEN** NiiVue loads a qCBF volume
- **THEN** it SHALL fetch from a `niivue://` URL, not a filesystem path

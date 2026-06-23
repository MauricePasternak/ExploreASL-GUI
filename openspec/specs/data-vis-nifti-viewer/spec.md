# data-vis-nifti-viewer Specification

## ADDED Requirements

### Requirement: Custom NiiVue Tauri Protocol

A custom Tauri protocol `niivue://` SHALL be registered in `tauri::Builder`. The protocol SHALL serve NIfTI files from the project's Population directory. The URL format SHALL be `niivue://localhost/{volumeType}/{participant_id}/{run?}` where `run` is optional (present for qCBF, absent for PV volumes) and corresponds to the TSV `session` column value (e.g. `ASL_1`). Rust SHALL own the filename template per volume type. The AppState SHALL maintain a project root registry for path resolution, set via a `set_active_project` command when a project opens, and cleared when the project closes.

#### Scenario: qCBF volume served with run

- **WHEN** NiiVue fetches `niivue://localhost/qCBF/sub-C9ORF007Philips_01/ASL_1`
- **THEN** Rust SHALL resolve `<root>/derivatives/ExploreASL/Population/qCBF_sub-C9ORF007Philips_01_ASL_1.nii` and return raw bytes

#### Scenario: Gzip fallback

- **WHEN** the `.nii` file does not exist but `qCBF_sub-C9ORF007Philips_01_ASL_1.nii.gz` does
- **THEN** Rust SHALL serve the `.nii.gz` file

#### Scenario: Unknown volume type returns 404

- **WHEN** NiiVue fetches `niivue://localhost/unknownType/sub-X_01/ASL_1`
- **THEN** the protocol SHALL return a 404 response

#### Scenario: Path traversal rejected

- **WHEN** the participant_id contains path traversal characters (e.g. `../`)
- **THEN** the protocol SHALL reject the request and return a 403 response

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

### Requirement: NiiVue Tri-Planar Rendering

The viewer panel SHALL use a single NiiVue instance with tri-planar grid rendering (axial, sagittal, coronal) on one canvas. The NiiVue instance SHALL be created on component mount (after WebGL2 availability check) and destroyed on component unmount. Volume swaps (loading a new qCBF on point click) SHALL replace the current volume in-place without destroying the instance. The colormap SHALL be grayscale. The crosshair SHALL initialize at the center of volume.

#### Scenario: Tri-planar grid renders on load

- **WHEN** a qCBF volume is loaded into NiiVue
- **THEN** the canvas SHALL display three orthogonal views (axial, sagittal, coronal) in a grid layout with linked crosshair navigation

#### Scenario: Grayscale colormap

- **WHEN** a qCBF volume is rendered
- **THEN** the NiiVue colormap SHALL be grayscale

#### Scenario: Crosshair starts at volume center

- **WHEN** a qCBF volume is loaded
- **THEN** the crosshair SHALL be positioned at the geometric center of the image volume

#### Scenario: Volume swap preserves instance

- **WHEN** a new qCBF volume is loaded after clicking a different datapoint
- **THEN** the NiiVue instance SHALL NOT be destroyed and recreated; `loadVolume` SHALL replace the current volume in-place

#### Scenario: Instance destroyed on unmount

- **WHEN** the viewer component unmounts (user leaves the visualization phase)
- **THEN** the NiiVue instance SHALL be destroyed and WebGL resources released

### Requirement: Viewer Panel States

The viewer panel SHALL always be visible (not toggled on first click). Before any point is clicked, the panel SHALL show a placeholder: "Click a datapoint to load its qCBF image." with an empty canvas. When a point is clicked, the panel SHALL show a loading overlay while the image loads. The previous image SHALL remain visible until the new image loads. If the image fails to load, the panel SHALL show an error message and the previous image SHALL remain visible.

#### Scenario: Placeholder before first click

- **WHEN** the Visualize step is entered and no point has been clicked
- **THEN** the viewer panel SHALL show "Click a datapoint to load its qCBF image." with an empty canvas

#### Scenario: Loading overlay on image fetch

- **WHEN** a point is clicked and the qCBF image is being fetched
- **THEN** a loading indicator SHALL be displayed over the viewer panel

#### Scenario: Previous image persists during loading

- **WHEN** a point is clicked while a previous image is displayed
- **THEN** the previous image SHALL remain visible until the new image finishes loading

#### Scenario: Image loaded successfully

- **WHEN** the qCBF image finishes loading
- **THEN** the loading overlay SHALL be dismissed and the tri-planar view SHALL display the new image

#### Scenario: Image file exists but fails to load

- **WHEN** the qCBF file exists but is corrupt or unreadable by NiiVue
- **THEN** the viewer panel SHALL show "Failed to load image for {participant*id}*{session}." and the loading overlay SHALL be dismissed and the previous image (if any) SHALL remain visible

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

The qCBF filename SHALL be constructed as `qCBF_{participant_id}_{run}.nii` using the raw `participant_id` and `run` (TSV `session` column value) from the clicked datapoint. No Subject/Session splitting is needed — the `participant_id` is used verbatim. The protocol SHALL try `.nii` first, then fall back to `.nii.gz`. If neither exists, the viewer panel SHALL show: "qCBF image not found for {participant*id}*{run}."

#### Scenario: NIfTI file found

- **WHEN** the clicked point has participant_id="sub-C9ORF007Philips_01" and run="ASL_1"
- **THEN** the protocol SHALL serve `qCBF_sub-C9ORF007Philips_01_ASL_1.nii`

#### Scenario: Gzip fallback

- **WHEN** `qCBF_sub-C9ORF007Philips_01_ASL_1.nii` does not exist but `.nii.gz` does
- **THEN** the protocol SHALL serve the `.nii.gz` file

#### Scenario: Both formats missing

- **WHEN** neither `.nii` nor `.nii.gz` exists for the clicked point
- **THEN** the viewer panel SHALL show "qCBF image not found for sub-C9ORF007Philips_01_ASL_1." and the previous image (if any) SHALL remain visible

#### Scenario: Image file exists but fails to load

- **WHEN** the qCBF file exists but is corrupt or unreadable by NiiVue
- **THEN** the viewer panel SHALL show "Failed to load image for {participant*id}*{run}." and the loading overlay SHALL be dismissed and the previous image (if any) SHALL remain visible

### Requirement: NiiVue Theme Integration

The NiiVue canvas background SHALL be black in dark mode and white in light mode, matching the active Mantine color scheme. The background color SHALL update when the theme changes.

#### Scenario: Dark mode background

- **WHEN** the Mantine color scheme is "dark"
- **THEN** the NiiVue canvas background SHALL be black

#### Scenario: Light mode background

- **WHEN** the Mantine color scheme is "light"
- **THEN** the NiiVue canvas background SHALL be white

#### Scenario: Background updates on theme switch

- **WHEN** the user switches the theme from dark to light while the viewer is open
- **THEN** the NiiVue canvas background SHALL update to white

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

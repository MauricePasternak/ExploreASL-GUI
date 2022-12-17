# Change Log

All notable changes to this project will be documented in this file.

Versions are in format: `[MAJOR.MINOR.BUGFIX]`

Dates are in format: `YYYY-MM-DD`

## [0.4.0] - 2022-12-12

Change of the Import Module to support ExploreASL's approach and syntax of multiple import contexts. Significant
refactoring of the project structure.

### Fixed

- Fixed a bug where the Terminate button was disabled in Process Studies module when in a paused state.

- Fixed a bug where the snackbar message at the end of the import process displayed the ExploreASL path instead of the
  study path.

- Fixed a bug where some error messages would not display for the `RHFTextField` component. This was the return of
  react-hook-forms' `fieldState.error` variable sometimes being an `Array<null | FieldError>` instead of the expected
  `FieldError` type. A workaround was implemented to handle this case.

- Fixed a bug with the field `x.GUI.SUBJECTS` in the Define Data Parameters module where the field would not start
  validation on a fresh ExploreASL-GUI startup if its related field of x.GUI.StudyRoot was filled in first. This was
  fixed by adding a `trigger` call to its own field, which is a hacky solution, but the only one available at the time.


### Added

- Added app version information in the lower left corner of the sidebar.

- Added the ability for the Import Module to short circuit generating the `ASLContext` field when it is a control-label
  or label-control sequence without any embedded M0 scan or dummy scan. ExploreASL itself will be able to expand the
  field to its full form when it processes an ASL timeseries. This solution allows for more similar ASL contexts to be
  grouped together, assuming the only differentiating factor was the number of volumes output in an ASL timeseries.

- Added BIDS validation to BIDSDataGrid module. Validation will now be run in the following manners:
  - All rows will be validated when:
    - The data is loaded in.
    - A column (BIDS field) is added.
    - A column (BIDS field) is removed.
  - Only a single row of interest will be validated when:
    - A cell is edited.
    - A cell's value is made undefined via Delete key.

- Added the ability for the GUI to export the current plot & MRI slice views to a PNG file.

- Added multiple new fields to defining each import context, particularly when it comes to PASL sequences. The following
  fields were added:
  - `PulseSequenceType`
  - `MRAcquisitionType` (indirectly, via `PulseSequenceType`)
  - `BolusCutOffFlag`
  - `BolusCutOffTechnique`
  - `BolusCutOffDelayTime`
  - `M0Type`
  - `M0Estimate`

- With the above, validation rules were added to comply with BIDS and ExploreASL's requirements.

### Changed

- Bumped non-developer dependencies to their latest versions.

- Increased size of the sidebar icons to 3rem.

- Changed the About page main picture to be the ExploreASL GUI logo instead of the ExploreASL logo.

- Changed the name of the BIDSDataGrid module in the sidebar to "Verify BIDS Sidecars". Its position is now also second
  after the Import module to entice its immediate use after an import.

- Updated the Define Parameters module to remove several fields in and add/change others, including:
  - `x.SESSIONS` - Removed
  - `x.session.options` - Removed
  - `x.Q.M0` - Removed; this is now a field in the import module (M0Type)
  - `x.Q.BackgroundSuppressionNumberPulses` - Removed; this is now a field in the import module (BackgroundSuppressionNumberPulses)
  - `x.Q.BackgroundSuppressionPulseTime` - Removed; this is now a field in the import module (BackgroundSuppressionPulseTime)
  - `x.Q.readoutDim` - Removed; this is now inferred in the import module (MRAcquisitionType)
  - `x.Q.Vendor` - Removed; this is now a field in the import module (Manufacturer)
  - `x.Q.Sequence` - Removed; this is now a field in the import module (PulseSequenceType)
  - `x.Q.LabelingType` - Removed; this is now a field in the import module (ArterialSpinLabelingType)
  - `x.Q.Initial_PLD` - Removed; this is now a field in the import module (PostLabelingDelay)
  - `x.Q.LabelingDuration` - Removed; this is now a field in the import module (LabelingDuration)
  - `x.modules.asl.M0PositionInASL4D` - Removed; this is now a field in the import module (M0PositionInASL4D)
  - `x.modules.asl.DummyScanPositionInASL4D` - Removed

- Renamed github and this project's names:
    - (this project) **ExploreASLJS --> ExploreASL-GUI**.
    - (previous project) **ExploreASL_GUI --> ExploreASL_PyGUI**

- Changed the import module to support ExploreASL's approach and syntax of multiple import contexts. There is no longer
  a need to launch the import module multiple times for different import contexts nor the need to generate multiple
  import settings files. The import module now supports multiple import contexts in a single run.

- Major change to the BIDSDataGrid module. It is now based on Material UI's DataGrid instead of React-Data-Grid. This
  change comes with benefits and caveats alike:
  - Benefits:
    - MUI is a more well-supported library than R-Data-Grid.
    - There a more features available, including sorting, filtering, hiding, resizing rows, etc.
    - The implementation of validation rules is much more scalable for the foreseeable future.
    - The UI is generally more aesthetically pleasing.
  - Caveats:
    - Frozen columns are not supported in the community version of MUI's DataGrid. As this project is not for profit,
      there is no way to practical way to obtain the enterprise version of MUI's DataGrid.

- Gave a significant refactoring overhaul to the setup of the project, particularly when it comes to imports/exports.
  Several schemas, components, and pages are appropriately allocated into subfolders and re-exported using index.ts(x).

- Changed several react-hook-form components to use the `useController` hook instead of the `Controller` wrapper
  component. This was done to improve code readability and to reduce the amount of code needed to implement additional
  feature.

- Changed several react-hook-form components to also incorporate optional use of the `useWatch` and `trigger`
  functionality offered by react-hook-form. The former allows the field to conditionally render based on the value of
  another field(s), while the latter allows the field to trigger a validation check on another field(s).

---

## [0.3.0] - 2022-08-21

Introduction of the BIDSDataGrid Module (#4) and multiple MacOS Fixes (#5)

### Fixed

- Fixed a bug where indicating excluded subjects resulted errors when trying to run ExploreASL as well as when loading
  in dataPar.json in Define Parameters. Excluded subjects are now handled back and forth between states where the "\_#"
  is present versus absent.

- Fixed a bug in the Define Parameters Module where, after loading invalid values from a dataPar.json file, validations
  would not occur until the user submitted. This has been fixed by programatically putting the form into a submitted
  state, which forces RHF to enter its reValidate mode (onChange basis).

- Improved the compatibility of loading dataframe in the DataVisualization steps to account for the switch from
  "SUBJECT" to "participant_id" as the main subject column between ExploreASL versions. Helper section has been updated
  to reflect this change as well.

- Fixed a bug on MacOS where `stats` was not provided in path watcher events. Switching to the `PathWatcher` class
  maintained backward compatibility without the need of a stats class.

- Event docstrings were not updated in MappingIPCRendererEvents.ts , MappingIPCMainEventsToHanders.ts , and preload.ts

- Fixed the event names `NIFTI:Load` and `Dataframe:Load` to be title case for both parts of the name.

- Fixed a naming bug in `calculateASLWorkload` where studies having multiple sessions did not correctly anticipate the
  naming of .status files that should be created for the study.

### Added

- Added the ability for users to export the DataVisualization plot result into a PNG file.

- Added progressbar/text/error feedback for running ExploreASL's DARTEL module.

- Added the option for renaming X and Y axis labels for both scatterplots and swarmplots within the Data Visualization
  Module.

- Added the new BIDSDataGrid Module.

- Added the `Shortcut:Register` and `Shortcut:Unregister` IPCMain events in order to have components register/unregister
  keyboard shortcuts. The corresponding frontend channel is called `shortcutTriggered`.

- Added the `App:NotificationSound` IPCMain event. Some implementations added when running Process Studies section of
  the application.

### Changed

- Removed the osxSign and osxNotarize fields from package.json for the time being until a proper workflow/credentials
  is established for distributing this on MacOSX.

- Improved the communication of errors by red color for the Import and Define Parameters moduels; namely that the
  steeper and tabs components reflect the particular step where errored fields are found.

- Changed the handling of `MATLABGithubArgs` in the running of the Import & other ExploreASL modules. Command-line
  arguments are now handled based on pre-vs-post 2019 MATLAB as well as the operating system.

- Changed IPCQuill's ending feedback to be a little more user-friendly (i.e. stating PIDs directly may have been
  confusing for non-developers).

- Form fields involving comma-delimited numbers had their debounce timers increased to 2 seconds before forcing an
  update. Also added some logic for encountering null values in their handleFieldToInner.

- In the Data Visualization module, certain ExploreASL dataframe columns are coerced into the appropriate categorical
  type and are not allowed to be changed to continuous.

- Moved the `Regex` class to its own module. Changed it to be more sensitive to optional capture groups.

- The Import Module now gives some info feedback when a study finishes import, as long as the user did not terminate
  the process.

- Prior to the running of Structural or ASL modules, the BIDS2Legacy lock folders are deleted for each subject that is
  present in the anticipated filepaths.

- Minor removal of unnecessary imports and other sorts of code refactoring.

- Moved the logic of determining ExploreASL version to its own functions `getExploreASLVersion` and
  `rendererGetEASLVersion` for the backend and frontend, respectively.

---

## [0.2.3] - 2022-08-20

Improvements to the handling of finding a MATLAB executable (#3) as well as quality-of-life improvements to the Import
Module.

### Fixed

- Fixed a bug where not having MATLAB on PATH resulted in crashes when trying the OS-specific `which matlab` command

### Added

- In the Import Module, the presence of an `ImportPar.json` file at the study's root filepath will be tested for.
  If present, the step where the user defines multiple import contexts will auto-populate if the contents of
  `ImportPar.json` are valid.

### Changed

- Significantly improved the fallback behavior of finding the path to the matlab executable when MATLAB is not on PATH.

- Improved the general `console.log` output of the Import Module's steps, to assist with debugging future issues.

---

## [0.2.2] - 2022-08-10

Various improvements to the logic of the Data Visualization module and Dialog-based form components.

### Fixed

- Fixed a typo in calculateWorkload which caused string values to be concatenated to the numerical value of the
  anticipated workload.

- Fixed a bug where multiple dialog windows could be opened for dialog-based components. A useRef was used to track
  the dialog's open state to prevent this.

- Fixed a bug in Data Visualization where changing between plots did not reset all the plotting variables.

- Fixed a bug where additional hover data permitted the selection of variables that were already dedicated to X/Y axis,
  causing a doubling effect to occur. This has been fixed twofold:

  - Variables that are already dedicated to X/Y are disabled in the "additional hover data" section.
  - Selecting a variable for X/Y that is already in "additional hover data" will cause it to be removed from the latter.

- Fixed a bug in Data Visualization Swarmplot where changing the orientation field did not change said orientation.

### Added

- Help sections have been added for the first two steps in the Data Visualization module. The main plotting page itself
  hasn't been given any help buttons for the time being.

- The main plotting page's typography has been wrapped in a CardHeader component for a more aesthetically-pleasing look
  and consistency with the previous steps.

### Changed

- Removed BackgroundSuppression from Import-related schemas, as it can be automatically derived from the number of
  suppressions

- Hovering over datapoints in Data Visualization now has several changes:

  - Subject and session are explicitly stated in the hoverdata instead of the previous ambiguous "ID" label
  - Instead of X and Y, the variable names are now explicitly stated in the hoverlabel

- Swarmplot's continuous var axis is now better scaled so that the maximum/minimum values do not appear at the edges.

---

## [0.2.1] - 2022-08-08

Additional information added to README and reformatted RunImportModule visuals.

### Fixed

- Fixed a bug where saving a DataPar.json file in Define Parameters resulting in snackbar feedback that did not respect
  OS-specific filepath delimiters

- Fixed a bug in MRIViewSettings where the maximum value exceeded the possible indexable value of MRI slices by 1 due
  to Javascript's zero-based indexing vs MNI space indexing discrepancy, causing crashes.

- Fixed a bug in StructureByParts where selecting a new value in the Select components did not trigger validation for
  that field. Changing any of the selects now forces validation.

### Added

- Added some initial RHFInterDep components to begin addressing the issues of interdependent fields w.r.t validation.

- Started adding some configuration for the auto-update feature in `package.json`.

- Modules that fail to complete will now give some feedback to the particular subjects/visits/sessions and the step
  where they did not complete.

### Changed

- Reformatted the RunImportModule aesthetic to be more in line with the previous steps (i.e card header).

---

## [0.2.0] - 2022-08-07

Important bugfixes and successful deployment on Windows 10.

### Fixed

- Fixed bugs in DataVisualization where previous graphical settings would not be reset if the user backtracked to load
  a new dataframe

- Fixed `calculateASLWorkload` to anticipate proper lock paths. Previously, it would early-exit due to issues with the session regex and a ES6 parsing error involving an if statement.

- Fixed `calculateStructuralWorkload` which made the mistake of using an async forEach loop, causing early return of
  the function. This has been fixed to use a traditional for-loop.

- Fixed a bug in which the StepRunImportModule component did not communicate the channel name when pausing/resuming/terminating

- Fixed the README.md to properly link to repository properties (i.e. stars, contributors, etc.)

### Added

- Added scripts for generating an Inno wizard installer for the program on Windows as an alternative to Squirrel

- Added a compiled node mode `win32-x64_lib.node` to backend. This should allow for circumventing the ntsuspend
  optional dep.

- Added legend settings to Scatterplot. Users can now alter legend symbol size, label fontsize, item spacing, etc.

### Changed

- Change the DrawerItems in GUIFrame such that the parent item of a nested structure will now be a ListItemButton
  which, when clicked, will expand/collapse the nested structure

---

## [0.1.0] - 2022-08-06

Initial Release. Successful deployment on Ubuntu20.04.

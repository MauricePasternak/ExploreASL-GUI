# Change Log

All notable changes to this project will be documented in this file.

Versions are in format: `[MAJOR.MINOR.BUGFIX]`

Dates are in format: `YYYY-MM-DD`

---

## [0.3.0] - 2022-08-21

Introduction of the BIDSDataGrid Module (#4) and multiple MacOS Fixes (#5)

### Fixed

- Fixed a bug where indicating excluded subjects resulted errors when trying to run ExploreASL as well as when loading
  in dataPar.json in Define Parameters. Excluded subjects are now handled back and forth between states where the "_#"
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

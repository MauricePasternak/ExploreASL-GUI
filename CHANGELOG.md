# Change Log

All notable changes to this project will be documented in this file.

Versions are in format: `[MAJOR.MINOR.BUGFIX]`

Dates are in format: `YYYY-MM-DD`

---

## [0.2.1] - 2022-08-08

Additional information added to README and reformatted RunImportModule visuals.

### Fixed

- Fixed a bug where saving a DataPar.json file in Define Parameters resulting in snackbar feedback that did not respect OS-specific filepath delimiters

### Added

- Added some initial RHFInterDep components to begin addressing the issues of interdependent fields w.r.t validation.
- Started adding some configuration for the auto-update feature in `package.json`.

### Changed

- Reformatted the RunImportModule aesthetic to be more in line with the previous steps (i.e card header).

---

## [0.2.0] - 2022-08-07

Important bugfixes and successful deployment on Windows 10.

### Fixed

- Fixed bugs in DataVisualization where previous graphical settings would not be reset if the user backtracked to load a new dataframe

- Fixed `calculateASLWorkload` to anticipate proper lock paths. Previously, it would early-exit due to issues with the session regex and a ES6 parsing error involving an if statement.

- Fixed `calculateStructuralWorkload` which made the mistake of using an async forEach loop, causing early return of the function. This has been fixed to use a traditional for-loop.

- Fixed a bug in which the StepRunImportModule component did not communicate the channel name when pausing/resuming/terminating

- Fixed the README.md to properly link to repository properties (i.e. stars, contributors, etc.)

### Added

- Added scripts for generating an Inno wizard installer for the program on Windows as an alternative to Squirrel

- Added a compiled node mode `win32-x64_lib.node` to backend. This should allow for circumventing the ntsuspend optional dep.

- Added legend settings to Scatterplot. Users can now alter legend symbol size, label fontsize, item spacing, etc.

### Changed

- Change the DrawerItems in GUIFrame such that the parent item of a nested structure will now be a ListItemButton which, when clicked, will expand/collapse the nested structure

---

## [0.1.0] - 2022-08-06

Initial Release. Successful deployment on Ubuntu20.04.

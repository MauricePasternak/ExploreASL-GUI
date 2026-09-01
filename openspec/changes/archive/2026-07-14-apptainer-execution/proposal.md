## Why

Currently, the ExploreASL GUI only supports running the pipeline via local MATLAB execution profiles. This requires the user to have a licensed local MATLAB installation. We need to introduce support for containerized Apptainer/Singularity execution profiles (e.g., to run the pre-built `exploreasl-1-11-0.sif` image) to enable running ExploreASL without local MATLAB dependencies, using the free MATLAB Compiler Runtime (MCR) embedded in the image.

## What Changes

- **Add Apptainer Profile Type**: Extend the `ExecutionProfileSchema` (and Rust equivalent `ExecutionProfile` enum) to support a new `"apptainer"` variant with fields `sifPath` and `apptainerPath`.
- **Apptainer-Specific Validation**: Add Rust-side validation logic for Apptainer profiles, verifying SIF image and executable existence, and auto-detecting the ExploreASL version via the internal `VERSION_*` file inside the image.
- **Explicit Directory Binding**: Ensure all execution commands (`run_import_pipeline` and `run_pipeline`) explicitly mount the host project directory to a standard `/data` path inside the container via `--bind <project_root>:/data`, making the container execution robust and independent of host path auto-mounting configurations.
- **Direct Script Execution**: Spawn workers by running `/opt/xasl/xASL_latest/run_xASL_latest.sh` via `apptainer exec` directly on the `/data` mount, bypassing the container's internal entrypoint `/opt/run.sh` to avoid memory/tmpfs limits and enable real-time progress tracking by the host lock watcher.

## Capabilities

### New Capabilities

_(None)_

### Modified Capabilities

- `execution-profiles`: Add the Zod/Rust schema definition, validation logic, and frontend Settings UI for the new `apptainer` profile type.
- `processing-backend`: Update the Tauri commands `run_import_pipeline` and `run_pipeline` to construct and execute `apptainer exec` command lines with explicit `--bind` mapping and parameter translation.

## Impact

- **Frontend**: Settings Modal (profile creation form), Profile Selector (import and processing pages), and Zod execution profile schemas.
- **Backend (Rust)**: `ExecutionProfile` data structure, validation routines in `execution_profile.rs`, and execution command spawning in `import.rs` and `processing.rs`.
- **System Dependencies**: Requires `apptainer` (or singularity) to be installed and available on the system PATH or configured path.

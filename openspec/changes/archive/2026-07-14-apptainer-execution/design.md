## Context

The ExploreASL GUI currently manages execution using a local MATLAB engine profile. To support researchers without local MATLAB licenses, we must support running containerized ExploreASL images (such as `exploreasl-1-11-0.sif`) using the Apptainer container engine. This design document establishes the execution and integration strategies.

## Goals / Non-Goals

**Goals:**

- Add support for the new `"apptainer"` profile type on both frontend and backend.
- Define a robust path-mounting strategy that works on any Linux directory.
- Support real-time progress monitoring via lock files written to the host directory.
- Support multi-worker parallel execution for Apptainer-based processing.

**Non-Goals:**

- Supporting Windows/macOS containers (Apptainer is Linux-only).
- Managing or downloading SIF images within the GUI (the user must provide a pre-built SIF image).

## Decisions

### Decision 1: Direct Execution (`apptainer exec`) vs Default Entrypoint (`apptainer run`)

**Chosen Option**: Execute the compiled `/opt/xasl/xASL_latest/run_xASL_latest.sh` script directly via `apptainer exec` with explicit directory bindings.

- **Alternative 1 (Default Entrypoint)**: Running the container via `apptainer run`. This executes the internal `/opt/run.sh` script, which copies the entire dataset into the container's tmpfs. This was rejected because the default `writable-tmpfs` is only 64MB, causing `No space left on device` errors when duplicating large datasets (like the 4.4GB GENFI dataset). It also prevents real-time lock/log file tracking on the host.
- **Alternative 2 (Docker)**: Running a Docker container. This was rejected because Docker requires root or sudo group permissions, which are typically blocked on multi-user HPC systems where ExploreASL is most frequently used.

### Decision 2: Directory Mount Mapping

**Chosen Option**: Standardized mount binding `--bind <project_root>:/data`.

- **Alternative 1 (Bind to self)**: Mount to `--bind <project_root>:<project_root>`. This was rejected because if the host directory path contains spaces, special characters, or is deeply nested, passing it directly as a parameter inside MATLAB can cause command parsing failures.
- **Alternative 2 (Automatic mounts)**: Relying on Apptainer's automatic mount system. This was rejected because it is non-portable; Apptainer by default only binds home, tmp, and current working directories, failing when the dataset is stored on a separate storage partition or drive (e.g. `/mnt/`).

### Decision 3: Version Detection Mechanism

**Chosen Option**: Check SIF file existence, then execute a fast `ls /opt/xasl/xASL_latest/` command inside the container via `apptainer exec` to parse the `VERSION_<version>` filename.

- **Alternative 1 (Inspect metadata)**: Parsing metadata labels using `apptainer inspect`. This was rejected because it depends on specific metadata labels being set correctly during the image build, which is not guaranteed for custom or repackaged SIF images.
- **Alternative 2 (Spawning MCR)**: Running a short MATLAB command to print version. This was rejected because starting the MATLAB Compiler Runtime (MCR) is slow (~10 seconds), causing unacceptable lag during settings validation.

### Decision 4: MCR Warmup Timing & Location

**Chosen Option**: Run MCR warmup synchronously as a pre-flight step in `run_pipeline` and `run_import_pipeline` (if the cache does not exist) rather than during validation.

- **Alternative 1 (Validation warmup)**: Running warmup during `validate_execution_profile`. Rejected because starting MCR cold takes 30-60 seconds, which would freeze/block the settings validation UI for a long time.
- **Cache Path**: The warmup check and extraction will target the default host directory `~/.mcrCache9.7/` (or the folder defined by the environment variable `$MCR_CACHE_ROOT`).

### Decision 5: Version Detection Timeout & Failure Handling

**Chosen Option**: Impose a strict 5-second timeout on the version detection command (`ls` inside the container via `apptainer exec`). If the command fails or times out, validation fails.

- **Alternative 1 (Allow null version)**: Allow validation to succeed with version set to null. Rejected because a failure/timeout indicates a broken container runtime or incompatible image, which should be caught immediately.

### Decision 6: File Browser Filters for SIF Paths

**Chosen Option**: Show `*.sif` files by default in the file browser dialog, but allow the user to select any file (`*.*`).

### Decision 7: Process Termination

**Chosen Option**: Use standard host process signals (SIGTERM, then SIGKILL if it doesn't exit). Apptainer naturally propagates these signals to containerized processes.

## Risks / Trade-offs

### [Risk 1] Missing Apptainer installation on host system

- **Mitigation**: The validation command `validate_execution_profile` will run `<apptainerPath> --version` to check its availability. If missing, it will return a specific error ("Apptainer executable not found") to block saving the profile.

### [Risk 2] MCR first-run extraction delay

- **Mitigation**: The first run of compiled MATLAB in a container takes up to a minute because MCR extracts its library cache to the host's `~/.mcrCache9.7/` directory. The UI progress state will display a loading spinner and message indicating a "First-run MCR initialization may take up to a minute" when starting.

### [Risk 3] Permissions mismatch on files written by container

- **Mitigation**: Unlike Docker, Apptainer processes run under the host user's UID and GID by default. The host folder permissions must have write permissions for the executing user, which automatically maps into the container.

### [Risk 4] Host MATLAB Startup Script Interference

- **Issue**: By default, Apptainer mounts the host's `$HOME` directory. If the host environment has a custom script at `$HOME/matlab/startup.m`, it will execute when the compiled MATLAB binary launches inside the container. This can override paths or raise errors.
- **Mitigation**: We run the container commands with the `--cleanenv` flag in Apptainer to isolate the environment and prevent environment variable interference.

### [Risk 5] Concurrent MCR Cache Extraction Races

- **Issue**: The MCR extracts components to a shared cache directory on the host (defaults to `~/.mcrCache9.7/`). If multiple parallel workers are spawned concurrently on a system running compiled ExploreASL for the first time, they will conflict during extraction, leading to exit code 1.
- **Mitigation**: Pre-warm the MCR cache with a single synchronous execution before spawning parallel workers.

### [Risk 6] System RAM exhaustion by parallel workers

- **Issue**: Each MCR worker process requires 1-2 GB of RAM. Spawning more workers than the system can support causes OS Out-Of-Memory (OOM) termination.
- **Mitigation**: Add a UI tooltip or note advising the user to set total workers below `Host RAM (GB) / 2`.

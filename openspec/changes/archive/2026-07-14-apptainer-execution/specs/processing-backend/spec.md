## ADDED Requirements

### Requirement: Command Execution for Apptainer Profiles

The Tauri commands `run_import_pipeline` and `run_pipeline` SHALL support execution using the `apptainer` profile type.

1. **Import execution (`run_import_pipeline`)**:
   Instead of running MATLAB directly on the host, the backend SHALL construct and spawn the following command line:

   ```
   <profile.apptainerPath> exec --cleanenv --writable-tmpfs --bind <staging_root>:/data <profile.sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "[1,1,0]" "0"
   ```
   - `<staging_root>` is the absolute host path of the staging directory.
   - The staging directory on the host is bound to `/data` inside the container.
   - The `--cleanenv` flag SHALL be included to isolate the container environment and prevent host MATLAB environment variables from causing conflicts.
   - The compiled script is executed with `/data` as the dataset root, running the import module (arguments `"[1,1,0]" "0"`).

2. **Processing execution (`run_pipeline`) & Import execution (`run_import_pipeline`)**:
   Before spawning any worker or running import, the backend SHALL check for a pre-flight MCR cache.
   - The MCR cache directory is determined by checking the environment variable `$MCR_CACHE_ROOT` on the host system. If not set, it defaults to `$HOME/.mcrCache9.7/` (where `$HOME` is derived from the environment variable `$HOME`).
   - If that directory does not exist, the backend SHALL perform a warmup run synchronously by executing:
     ```
     <profile.apptainerPath> exec --cleanenv --writable-tmpfs <profile.sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/
     ```
     This command extracts the runtime libraries to the host cache directory. Once this warmup run completes successfully, the actual pipeline runs are executed as warm starts.

   Once warmed up, for each worker `i` from `1` to `N` (workers) in `run_pipeline`, the backend SHALL construct and spawn:

   ```
   <profile.apptainerPath> exec --cleanenv --writable-tmpfs --bind <project_root>:/data <profile.sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "<b_process_string>" "0" "<i>" "<N>"
   ```
   - `<project_root>` is the absolute host path of the project root.
   - The project root directory on the host is bound to `/data` inside the container.
   - The `--cleanenv` flag SHALL be included to prevent host environment pollution.
   - `<b_process_string>` is the string representation of `b_process` vector (e.g. `"[1,1,0]"` for Structural + ASL).
   - `i` is the current worker ID.
   - `N` is the total number of workers.
   - **Staggered Launch**: The backend SHALL stagger the spawning of parallel workers by at least 2 seconds (instead of the 1 second used for MATLAB) to allow container namespace initialization to settle and prevent SQLite/file access races.

#### Pseudocode: Rust Command Construction

```rust
// Warmup Check & Run
fn check_and_warmup_mcr(apptainer_path: &str, sif_path: &str) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    let cache_dir = std::env::var("MCR_CACHE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(home).join(".mcrCache9.7"));

    if !cache_dir.exists() {
        let mut cmd = Command::new(apptainer_path);
        cmd.args(&[
            "exec",
            "--cleanenv",
            "--writable-tmpfs",
            sif_path,
            "/bin/bash",
            "/opt/xasl/xASL_latest/run_xASL_latest.sh",
            "/opt/mcr/v97/",
        ]);
        let status = cmd.status().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("MCR Warmup failed".to_string());
        }
    }
    Ok(())
}

// Spawning Worker
fn spawn_apptainer_worker(
    apptainer_path: &str,
    sif_path: &str,
    project_root: &str,
    b_process_str: &str,
    i: usize,
    n: usize,
) -> Result<Child, std::io::Error> {
    let mut cmd = Command::new(apptainer_path);
    cmd.args(&[
        "exec",
        "--cleanenv",
        "--writable-tmpfs",
        "--bind",
        &format!("{}:/data", project_root),
        sif_path,
        "/bin/bash",
        "/opt/xasl/xASL_latest/run_xASL_latest.sh",
        "/opt/mcr/v97/",
        "/data",
        "0",
        b_process_str,
        "0",
        &i.to_string(),
        &n.to_string(),
    ]);
    cmd.spawn()
}
```

#### Scenario: Running import with Apptainer execution profile

- **WHEN** `run_import_pipeline` is called with an Apptainer profile having `sifPath: "/path/to/image.sif"` and `apptainerPath: "apptainer"`
- **THEN** the backend SHALL spawn the command `apptainer exec --cleanenv --writable-tmpfs --bind <staging_root>:/data /path/to/image.sif /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "[1,1,0]" "0"`

#### Scenario: Running processing with Apptainer execution profile and 2 workers

- **WHEN** `run_pipeline` is called with `workers = 2`, `b_process = [true, true, false]`, and an Apptainer profile having `sifPath: "/path/to/image.sif"`
- **THEN** the backend SHALL perform a warmup run if MCR is not cached, and then spawn 2 parallel worker processes:
  1. `apptainer exec --cleanenv --writable-tmpfs --bind <project_root>:/data /path/to/image.sif /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "[1,1,0]" "0" "1" "2"`
  2. `apptainer exec --cleanenv --writable-tmpfs --bind <project_root>:/data /path/to/image.sif /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "[1,1,0]" "0" "2" "2"`

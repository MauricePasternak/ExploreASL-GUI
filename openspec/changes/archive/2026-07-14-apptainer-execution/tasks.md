# Apptainer Execution Profile Implementation Tasks & Pseudocode

Goal: Implement support for containerized Apptainer/Singularity execution profiles in ExploreASL GUI.

---

## 1. Schema Integration (Frontend & Backend)

### Task 1.1: Extend Zod Schema in `src/schemas/executionProfile.ts`

- **Pseudocode**:
  ```typescript
  import { z } from "zod";

  export const ExecutionProfileBaseSchema = z.object({
    id: z.uuid(),
    label: z.string().min(1, "Label is required"),
    exploreAslVersion: z.string().optional(),
  });

  export const MatlabProfileSchema = ExecutionProfileBaseSchema.extend({
    type: z.literal("matlab"),
    matlabPath: z.string().min(1, "MATLAB path is required"),
    exploreAslPath: z.string().min(1, "ExploreASL path is required"),
  });

  export const ApptainerProfileSchema = ExecutionProfileBaseSchema.extend({
    type: z.literal("apptainer"),
    sifPath: z.string().min(1, "SIF path is required"),
    apptainerPath: z.string().min(1, "Apptainer executable path is required").default("apptainer"),
  });

  export const ExecutionProfileSchema = z.discriminatedUnion("type", [
    MatlabProfileSchema,
    ApptainerProfileSchema,
  ]);

  export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
  export type MatlabProfile = z.infer<typeof MatlabProfileSchema>;
  export type ApptainerProfile = z.infer<typeof ApptainerProfileSchema>;
  ```

### Task 1.2: Extend Rust Struct in `src-tauri/src/execution_profile.rs`

- **Pseudocode**:
  ```rust
  #[derive(Debug, Clone, Serialize, Deserialize)]
  #[serde(tag = "type", rename_all = "camelCase")]
  pub enum ExecutionProfile {
      #[serde(rename = "matlab")]
      Matlab {
          id: String,
          label: String,
          #[serde(rename = "matlabPath")]
          matlab_path: String,
          #[serde(rename = "exploreAslPath")]
          explore_asl_path: String,
          #[serde(rename = "exploreAslVersion", default, skip_serializing_if = "Option::is_none")]
          explore_asl_version: Option<String>,
      },
      #[serde(rename = "apptainer")]
      Apptainer {
          id: String,
          label: String,
          #[serde(rename = "sifPath")]
          sif_path: String,
          #[serde(rename = "apptainerPath")]
          apptainer_path: String,
          #[serde(rename = "exploreAslVersion", default, skip_serializing_if = "Option::is_none")]
          explore_asl_version: Option<String>,
      },
  }
  ```

---

## 2. Backend Validation Implementation

### Task 2.1: Implement Apptainer validation in `ExecutionProfile::validate` (`src-tauri/src/execution_profile.rs`)

- Add support for the `Apptainer` variant in validation logic:
  - Check that the SIF path exists and is a file.
  - Locate/verify the apptainer executable (with fallback to `"singularity"` if the user specified `"apptainer"` and it is not found on host `PATH`).
  - Run `<executable> exec <sifPath> ls /opt/xasl/xASL_latest/` with a strict 5-second timeout to extract the `VERSION_*` file name for version detection.
- **Pseudocode**:
  ```rust
  fn validate_apptainer_profile(sif_path: &str, apptainer_path: &str) -> InternalValidation {
      let mut errors = Vec::new();
      let mut validated_sif_path = None;
      let mut validated_apptainer_path = None;
      let mut explore_asl_version = None;

      // 1. Verify SIF path exists on disk
      let sif = PathBuf::from(sif_path.trim());
      if !sif.exists() || !sif.is_file() {
          errors.push(format!("SIF image not found at this path: {}", sif.display()));
      } else {
          validated_sif_path = Some(sif);
      }

      // 2. Verify Apptainer executable existence with fallback
      let mut exec_to_try = apptainer_path.trim().to_string();
      if exec_to_try == "apptainer" {
          // If default not found, try singularity fallback
          if which::which("apptainer").is_err() {
              if which::which("singularity").is_ok() {
                  exec_to_try = "singularity".to_string();
              }
          }
      }

      // Perform a check that the executable is run-able or exists
      if which::which(&exec_to_try).is_err() {
          errors.push(format!("Apptainer executable not found on system PATH: {}", exec_to_try));
      } else {
          validated_apptainer_path = Some(exec_to_try);
      }

      // 3. Detect version from inside image with 5-second timeout
      if let (Some(ref bin), Some(ref sif_p)) = (&validated_apptainer_path, &validated_sif_path) {
          use std::process::Command;
          use std::os::unix::process::ExitStatusExt;
          // Spawn command
          let mut cmd = Command::new(bin);
          cmd.args(&["exec", &sif_p.to_string_lossy(), "ls", "/opt/xasl/xASL_latest/"]);

          // Execute with timeout check (using wait_timeout or simple thread channels if needed)
          match run_cmd_with_timeout(cmd, std::time::Duration::from_secs(5)) {
              Ok((status, stdout)) if status.success() => {
                  // Parse lines of stdout to find VERSION_*
                  for line in stdout.lines() {
                      if let Some(ver) = line.trim().strip_prefix("VERSION_") {
                          if !ver.is_empty() {
                              explore_asl_version = Some(ver.to_string());
                              break;
                          }
                      }
                  }
                  if explore_asl_version.is_none() {
                      errors.push("Could not find VERSION_* file in container /opt/xasl/xASL_latest/".to_string());
                  }
              }
              Ok((status, _)) => {
                  errors.push(format!("Failed to run apptainer exec inside SIF: exit status {:?}", status));
              }
              Err(err) => {
                  errors.push(format!("Version detection timed out or failed: {}", err));
              }
          }
      }

      InternalValidation {
          valid: errors.is_empty(),
          errors,
          explore_asl_version,
          // Store validated options
          matlab_path: validated_apptainer_path, // hijack this field or extend struct
          explore_asl_path: validated_sif_path,  // hijack this field or extend struct
      }
  }
  ```

---

## 3. Pipeline Command Spawning (Rust)

### Task 3.1: Pre-flight MCR cache check & warmup

- Add an MCR warmup invocation prior to worker creation if `~/.mcrCache9.7/` (or directory pointed by environment `$MCR_CACHE_ROOT`) does not exist on the host.
- **Pseudocode**:
  ```rust
  fn check_and_warmup_mcr_cache(apptainer_path: &str, sif_path: &str) -> Result<(), String> {
      let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
      let cache_dir = std::env::var("MCR_CACHE_ROOT")
          .map(PathBuf::from)
          .unwrap_or_else(|_| PathBuf::from(home).join(".mcrCache9.7"));

      if !cache_dir.exists() {
          log::info!("MCR cache not found at {}. Performing warm-up...", cache_dir.display());
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
          let status = cmd.status().map_err(|e| format!("Failed to spawn warmup command: {}", e))?;
          if !status.success() {
              return Err("MCR Warmup run failed. Check container permissions and MCR path.".to_string());
          }
      }
      Ok(())
  }
  ```

### Task 3.2: Spawning Import Pipeline in `src-tauri/src/import.rs`

- If execution profile is `Apptainer`, perform warmup run, then construct:
  ```
  <apptainer> exec --cleanenv --writable-tmpfs --bind <staging_root>:/data <sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "[1,1,0]" "0"
  ```

### Task 3.3: Spawning processing pipeline in `src-tauri/src/processing.rs`

- Warmup first.
- Stagger loop by 2 seconds.
- Spawns workers with command line parameters:
  ```
  <apptainer> exec --cleanenv --writable-tmpfs --bind <project_root>:/data <sifPath> /bin/bash /opt/xasl/xASL_latest/run_xASL_latest.sh /opt/mcr/v97/ /data "0" "<b_process_string>" "0" "<i>" "<N>"
  ```

---

## 4. Frontend UI Integration

### Task 4.1: Extend Settings Modal Profile Manager Form (`src/components/settings/ProfileManager.tsx`)

- Add support in `ProfileDraft` and `EMPTY_DRAFT` for `sifPath` and `apptainerPath`.
- Conditionally render fields when type is `"apptainer"`:
  - Display "SIF path" and "Apptainer path" inputs.
  - Hide Matlab Path, ExploreASL path, and "Detect MATLAB" buttons.
  - Implement browsing for `.sif` files with `*.sif` filters by default.

### Task 4.2: Update Profile Selector Component (`src/components/common/ProfileSelector.tsx`)

- Update rendering options to label Apptainer profiles with `"Apptainer"` badge and properly extract versions.

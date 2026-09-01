## ADDED Requirements

### Requirement: Apptainer Execution Profile schema

The system SHALL define an `ApptainerProfileSchema` as a Zod object extending `ExecutionProfileBaseSchema`. It SHALL contain:

- `type`: z.literal("apptainer")
- `sifPath`: z.string().min(1, "SIF path is required")
- `apptainerPath`: z.string().min(1, "Apptainer executable path is required").default("apptainer")

The Zod parser for `ExecutionProfileSchema` SHALL be updated to support the discriminated union of both `MatlabProfileSchema` and `ApptainerProfileSchema` on the `type` field.

#### Pseudocode: Zod Schema Definition

```typescript
export const ApptainerProfileSchema = ExecutionProfileBaseSchema.extend({
  type: z.literal("apptainer"),
  sifPath: z.string().min(1, "SIF path is required"),
  apptainerPath: z.string().min(1, "Apptainer executable path is required").default("apptainer"),
});

export const ExecutionProfileSchema = z.discriminatedUnion("type", [
  MatlabProfileSchema,
  ApptainerProfileSchema,
]);
```

#### Pseudocode: Rust Struct Definition

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExecutionProfile {
    #[serde(rename = "matlab")]
    Matlab { ... },
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

#### Scenario: Valid Apptainer profile parses successfully

- **WHEN** `ExecutionProfileSchema.parse()` is called with `{ id: "550e8400-...", label: "My Apptainer", type: "apptainer", sifPath: "/path/to/image.sif", apptainerPath: "apptainer" }`
- **THEN** the parse SHALL succeed and return a typed `ApptainerProfile` object

#### Scenario: Missing SIF path fails validation

- **WHEN** `ExecutionProfileSchema.parse()` is called with `{ id: "...", label: "Test", type: "apptainer", sifPath: "", apptainerPath: "apptainer" }`
- **THEN** the parse SHALL throw a Zod validation error for `sifPath` (min length 1)

### Requirement: Apptainer profile validation

Apptainer profile validation SHALL occur at the same lifecycle points as Matlab validation. The Rust validation command `validate_execution_profile` and `validate_all_execution_profiles` SHALL handle the `Apptainer` variant:

1. Verify that `sifPath` exists on disk and is a file.
2. Verify that `apptainerPath` is executable on the host system. If the user-supplied `apptainerPath` is the default `"apptainer"` and is not found on the system PATH, the validation routine SHALL automatically attempt to fall back to `"singularity"` as the default executable.
3. Detect the ExploreASL version by checking if the SIF image contains a file matching `VERSION_*` inside `/opt/xasl/xASL_latest/` (by running `<apptainerPath> exec <sifPath> ls /opt/xasl/xASL_latest/` and extracting the version suffix).
   - This command SHALL run with a strict 5-second timeout.
   - If the version detection command fails or times out, validation SHALL fail with an error.
4. **MCR Warmup**: The validation routine itself SHALL NOT perform the MCR warmup cache extraction, keeping validation fast and responsive. Instead, the MCR warmup check and execution is deferred to a pre-flight step inside the pipeline running commands (`run_import_pipeline` / `run_pipeline`).

#### Scenario: Valid Apptainer profile passes validation

- **WHEN** the validation command is called with a SIF path pointing to a valid ExploreASL v1.11.0 image and `apptainerPath` points to a valid apptainer executable
- **THEN** the validation result SHALL return `valid: true`, `errors: []`, and `exploreAslVersion: "1.11.0"`

#### Scenario: Invalid SIF path fails validation

- **WHEN** the validation command is called with a non-existent SIF path
- **THEN** the validation result SHALL return `valid: false`, `errors` containing "SIF image not found at this path", and `exploreAslVersion: null`

### Requirement: Apptainer Executable Auto-Detection and Label Inference

The system SHALL support auto-detecting and auto-labeling Apptainer and Singularity installations:

1. **Auto-Detection of Multiple Instances**:
   - The backend command `which_apptainer` SHALL scan all directories listed on the system `PATH` for executable binaries named `apptainer` or `singularity`.
   - Discovered paths SHALL be deduplicated by canonicalizing them (resolving symlinks).
   - For each unique binary path, it SHALL detect its version by running `<binary> --version`.

2. **Auto-Inference of Profile Label**:
   - The system SHALL format a user-friendly label for each candidate:
     - If the binary filename is `singularity` (case-insensitively), the label format is `"Singularity <version>"` (or `"Singularity (<path>)"` if the version is not found).
     - Otherwise, the label format is `"Apptainer <version>"` (or `"Apptainer (<path>)"` if the version is not found).

3. **Form Auto-population**:
   - In the Profile Manager form, when an installation is selected or automatically detected as a fallback, the form's `label` and `apptainerPath` fields SHALL be updated.
   - If the user's current label is empty or whitespace, it SHALL be auto-populated with the inferred label.

#### Scenario: Discovered multiple installations are returned

- **WHEN** `which_apptainer` is called on a system with `/usr/bin/apptainer` (version 1.1.0) and `/usr/local/bin/singularity` (version 3.8.0)
- **THEN** the returned array SHALL contain both candidate records, complete with their auto-inferred labels: `"Apptainer 1.1.0"` and `"Singularity 3.8.0"`.

#### Scenario: Selecting a candidate auto-populates label

- **WHEN** the user has an empty profile label and selects a detected candidate with label `"Apptainer 1.1.0"` and path `/usr/bin/apptainer`
- **THEN** the profile manager form's Label field is populated with `"Apptainer 1.1.0"` and Apptainer Path is populated with `/usr/bin/apptainer`.

## MODIFIED Requirements

### Requirement: Profile management UI in Settings modal

The Settings modal's "Execution Profiles" section SHALL support the creation and editing of Apptainer profiles:

1. When selecting `Apptainer` as the profile type in the add/edit form, the UI SHALL display inputs for `Label`, `SIF Path` (with file browser option), and `Apptainer Path` (with default placeholder "apptainer").
2. The `matlabPath` and `exploreAslPath` inputs SHALL be hidden.
3. The detected ExploreASL version (e.g. "1.11.0") or "not detected" warning SHALL be displayed below the `sifPath` input.
4. The list of existing profiles SHALL show the profile label, type badge (e.g., "MATLAB" or "Apptainer"), a summary of key paths, and a validity indicator (green checkmark for valid, red warning icon for invalid with error tooltip).
5. The "Detect MATLAB" and "Detect Apptainer" buttons SHALL support auto-detecting installations on the system.

#### Scenario: Switching profile type to Apptainer updates form fields

- **WHEN** the user selects "Apptainer" from the Type dropdown in the profile creation form
- **THEN** the MATLAB Path and ExploreASL Path inputs are removed, and SIF Path and Apptainer Path inputs are rendered

#### Scenario: Empty profiles list shows add button

- **WHEN** no profiles exist
- **THEN** the section SHALL display "No execution profiles configured" text and an "Add Profile" button

#### Scenario: Profile list with entries

- **WHEN** 2 profiles exist (e.g., "MATLAB R2024b" and "MATLAB R2023b")
- **THEN** both SHALL be listed with their labels, type badges, path summaries, and validity indicators

#### Scenario: Invalid profile shows warning icon

- **WHEN** a profile failed validation (e.g., MATLAB was uninstalled)
- **THEN** the profile row SHALL show a red warning icon with a tooltip describing the validation error

#### Scenario: Delete profile with confirmation

- **WHEN** the user clicks Delete on a profile
- **THEN** a confirmation dialog SHALL be shown before deletion

#### Scenario: Edit profile opens form

- **WHEN** the user clicks Edit on an existing profile
- **THEN** the inline form SHALL be populated with the profile's current values

#### Scenario: Auto-detect finds MATLAB installations

- **WHEN** the user clicks "Detect MATLAB" and the system has MATLAB installed
- **THEN** a list of detected installations is shown; selecting one populates `matlabPath` and `label`

#### Scenario: Auto-detect finds no MATLAB

- **WHEN** the user clicks "Detect MATLAB" and no MATLAB is found on the system
- **THEN** a message is shown: "No MATLAB installations found. Enter the path manually or use Browse."

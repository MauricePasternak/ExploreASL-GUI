## Context

ExploreASL GUI wraps the ExploreASL MATLAB ASL MRI pipeline. Two data source paths now exist: DICOM import (6-step wizard tokenizing raw DICOMs) and BIDS-direct (reverse-derive `mappingState` from existing BIDS JSON sidecars). Downstream modules (processing, manifest, parameters) consume `metadataGroups[]` and `subjectRows[]` from `mappingState` regardless of source. The GUI's binary model locks a project into one source at creation time; the two paths never mix within a project.

DS000240 (a real openneuro BIDS ASL dataset at `test/ds000240`) serves as the verification target: 25 cross-sectional subjects, Siemens Prisma 3T PCASL 3D, M0Type Included, 110 volumes per aslcontext.tsv (10 m0scan + 50 label/control pairs). Pre-release state — no migration concerns, breaking changes permitted.

The full grilling session (44 questions, all locked) is the source of truth for the following decisions; any ambiguity in specs/tasks should be resolved by re-reading the grill notes in `notes/bids_import_discussion_spec_draft/` plus the amendments below.

## Goals / Non-Goals

**Goals:**

- Provide a BIDS-direct import path that skips the 6-step wizard for users with pre-existing BIDS datasets
- Reverse-derive `metadataGroups[]` and `subjectRows[]` from BIDS sidecars so downstream modules work unchanged
- Maintain the existing DICOM import path with zero behavioral regression
- Keep the binary model strict: `dataSource` is immutable, no hybrid projects
- Make BIDS-direct usable end-to-end on ds000240 as the validation dataset
- Verify against ds000240's real sidecars (cross-sectional, M0Type Included, dcm2niiX-export quirks)
- Support revisiting Import for confirmed BIDS-direct projects, re-scanning the source dataset, and re-confirming regenerated mapping state

**Non-Goals:**

- Hybrid projects (BIDS+DICOM mixing) — explicitly deferred to post-v1
- Group splitting/merging in `BIDSReviewPanel` — deferred
- Editing `bidsParams` in the review panel — read-only in v1
- M0 sidecar (`*_m0scan.json`) integration into fingerprinting — only `*_asl.json` scanned
- Anatomical sidecar (`*_T1w.json`) integration — out of scope for v1
- BIDS validation beyond "does usable ASL data exist?" — ExploreASL is source of truth for BIDS compliance at processing time
- Minimum BIDSVersion check — version rendered as "Unknown" when missing, no enforcement
- Performance work for 1000+ subject datasets — typical studies scan in <500ms; 500-subject datasets 3-5s; virtualization deferred

## Decisions

### D1: Binary model (DICOM XOR BIDS), strict immutability

**Decision:** `projectMeta.dataSource: "dicom" | "bids"` is required at `createProject()`, immutable for project lifetime. No runtime immutability guard — JSDoc documents immutability, callers trust the contract. One test verifies `createProject` sets the value and downstream code doesn't mutate.

**Alternatives considered:**

- **Hybrid with precedence (rejected):** Allow `sourcedata/` in a BIDS project for future DICOM import, unify into one `mappingState`. Rejected because state coupling across two import flows explodes scope.
- **Hybrid BIDS + DICOM growth (rejected):** BIDS project accepts raw DICOM additions and converts them into the existing BIDS tree. Rejected because it mixes import models. Users may still add or fix BIDS files externally and re-scan the BIDS-direct project from Import.

**Why:** Covers >90% of expected use cases per ADR-1. `mappingState` is designed for a single homogeneous dataset. Longitudinal follow-up is handled by adding new BIDS entities (user converts externally if needed) and re-creating the project — acceptable for v1.

### D2: Cross-sectional default session = `"1"` (not `"01"`)

**Decision:** When a subject directory has `perf/` or `anat/` directly (no `ses-*/`), default session to `"1"`. Explicit `ses-XX` preserves the label after stripping `"ses-"` prefix (so `ses-01` → `"01"`, `ses-baseline` → `"baseline"`, `ses-1` → `"1"`).

**Explicitness is stored separately:** `has_explicit_session` is derived from the presence of a `ses-*` directory, NOT from whether `session_label != "1"`. This avoids misclassifying explicit `ses-1` as cross-sectional default.

**Alternatives considered:**

- **Default to `"01"` (rejected per grill Q8):** Original draft. Verified against ExploreASL MATLAB source (`xASL_init_SubjectList.m`): `if isempty(SessionID), SessionID = '1'; else SessionID = SessionID(5:end); end; SubjectSession = [SubjectID '_' SessionID]`. Default `"01"` would produce `sub-01_01` while ExploreASL produces `sub-01_1` — lock file matching, derivatives path resolution, and subject-session ID matching all break by one character.

**Why:** Load-bearing for processing status panel and derivatives path resolution. Without this, cross-sectional BIDS-direct projects show every subject as "pending" forever and never find ExploreASL outputs.

### D3: `dataset_description.json` not required for `is_bids`

**Decision:** `is_bids = asl_subject_count >= 1`. `dataset_description.json` presence is informational; missing → non-fatal warning dialog ("BIDS compliance unverifiable — proceed?"). Corrupt `dataset_description.json` when ASL subjects exist → non-fatal warning dialog. No minimum BIDSVersion check; "Unknown" rendered when `BIDSVersion` missing.

**Alternatives considered:**

- **Require `dataset_description.json` strictly (rejected per grill Q12):** Original draft. Blocks realistic users with ad-hoc BIDS-converted datasets (no `dataset_description.json` but valid ASL files). 15% of real BIDS-direct users estimated to be blocked.
- **Add `has_sourcedata` detection (rejected):** User said only relax `is_bids`, skip sourcedata detection. New-project folders wouldn't have `rawdata/` unless user picked wrong folder — root-only scan is correct for new project creation.

### D4: Sidecar extraction reads top-level keys only

**Decision:** `extract_fingerprint()` reads top-level keys of `*_asl.json`. Nested objects (notably dcm2niiX's `global.const` block) are ignored. Keys absent at top-level → null in fingerprint → matches another subject also null.

**Alternatives considered:**

- **Recursive lookup (rejected per grill Q2):** DS000240's sidecar has conflicting `EchoTime: 0.0029` at top-level vs `EchoTime: 10.03` in `global.const`. Recursive lookup would hit one or the other non-deterministically depending on traversal order. The `global.const` block is a dcm2niiX export artifact that BIDS consumers ignore.

### D5: Number canonicalization for fingerprint hashing

**Decision:** All fingerprint numeric fields are extracted as `f64`, rounded to 3 decimals via `(value * 1000.0).round() / 1000.0`, then serialized for hashing via `format!("{:.3}", value)` — always 3 decimal places, string-form. `serde_json::to_string` is not used for hash serialization to avoid `3` vs `3.0` vs `3.000` rendering differences.

**Alternatives considered:**

- **`serde_json::to_string` directly (rejected per grill Q11):** `serde_json` renders `Value::from(3)` as `"3"` and `Value::from(3.0)` as `"3.0"` — non-deterministic across converters. `3` (integer JSON) and `3.0` (float JSON) for the same MagneticFieldStrength would produce different fingerprint hashes → different groups for what's clinically identical.

### D6: Array canonicalization sorts before hashing

**Decision:** Array fingerprint fields (notably `PostLabelingDelay` in multi-PLD studies) are sorted ascending before hashing. Numbers within arrays: round to 3 decimals. Arrays of strings: sort ascending. Mixed-type arrays: serialize as-is (rare in ASL sidecars).

**Alternatives considered:**

- **Hash arrays in sidecar order (rejected per grill Q5):** Multi-PLD studies have `[1.0, 1.5, 2.0]` vs `[2.0, 1.5, 1.0]` (acquisition order recorded differently by different conversion tools). Same scanner, same sequence → spurious fingerprint groups.

### D7: ASLContext display-only, not in fingerprint hash

**Decision:** `ASLContext` (parsed from `*_aslcontext.tsv`) is injected into group `params` for BIDSReviewPanel display + manifest §1, but excluded from `FINGERPRINT_FIELDS` list. Two subjects with same scanner but different ASLContexts (e.g., 5 m0scan volumes vs 100) → same group; displayed ASLContext is first-subject's value (v1 simplification — per-subject divergence is rare edge case, out of scope).

Raw ASLContext string persists in `mappingState.bidsParams.ASLContext` (preserves data for re-parsing / future tooling); frontend `summarizeAslContext()` renders run-length summary (`"m0scan×10, label×50, control×50"`) in BIDSReviewPanel and manifest §1.

**Alternatives considered:**

- **Include ASLContext in fingerprint (rejected per grill Q3):** Same scanner, different m0scan counts → different groups. Clinically incorrect.
- **Per-subject ASLContext display (rejected per grill Q15):** Rare edge case where subjects in the same fingerprint group have different ASLContexts. User concern: out of scope for now. First-subject value used.

### D8: M0Type derived except sidecar's `"Estimate"` honored

**Decision:** `M0Type` is derived at scan time, with one exception:

1. If sidecar's `M0Type === "Estimate"` → return `"Estimate"` (trust sidecar; literature-derived M0 is not derivable from filesystem/ aslcontext)
2. Else if `perf/` has `*_m0scan.nii.gz` → `"Separate"`
3. Else if `aslcontext.tsv` has `m0scan` volume_type → `"Included"`
4. Else → `"Absent"`

Sidecar's other `M0Type` values (`"Integrated"`, `"Included"`, `"Separate"`, `"Absent"`, missing) are NOT trusted — derived from filesystem + aslcontext. Rationale: converter inconsistency for these values; derivation normalizes. `"Estimate"` is exceptional — it's a manual literature-derived setting with no filesystem/ aslcontext signal. ExploreASL's `080_Quantification` reads `M0Type === "Estimate"` and substitutes a literature value; silently overwriting with `"Absent"` would change quantification behavior.

Cross-field validation (`refineBidsMetadata` superRefine, rules at `importSchemas.ts:249-272`) passes:

- Derived `"Included"` agrees with aslcontext's `m0scan` presence → rule at line 250 passes
- Derived `"Absent"` agrees with aslcontext's m0scan absence → rules at lines 258-263 pass
- Sidecar's `"Estimate"` with no m0scan in aslcontext: schema enum accepts `"Estimate"`, superRefine at line 250 doesn't trigger (`data.M0Type !== "Included"` is true for `"Estimate"`), so it passes. Requires verifying superRefine doesn't reject `"Estimate"` → re-read schema: line 258 rejects when `!data.M0Type` (missing), line 265 rejects when `data.M0Type === "Included"` specifically. `"Estimate"` passes both. ✓

**Alternatives considered:**

- **Trust sidecar's `M0Type` if present (rejected per grill Q4):** Sidecars from various converters use `"Integrated"` / `"Included"` / omit-the-field inconsistently. Trusting the sidecar collapses GENFI's Siemens 3T PASL 3D Separate vs Absent groups together.
- **Drop `"Estimate"` from schema enum (rejected per grill Q45):** Breaks BIDS-spec compliance; legitimate `"Estimate"` datasets would fail schema parse.
- **Drop `M0Type` from fingerprint, display only (rejected per grill Q4):** Loses discrimination on datasets converted with other tools.

### D9: Zod transforms for `PulseSequenceType` and `Manufacturer`

**Decision:** Drop strict zod enums on `PulseSequenceType` and `Manufacturer` in `BidsAslMetadataBaseSchema`. Replace with Zod transforms using substring matching (case-insensitive) + canonical emission + `undefined` fallback for unrecognized values. Mirrors ExploreASL's MATLAB `regexpi(xQ.PulseSequenceType, '(epi|grase|spiral)', 'once')` pattern: match → canonical form, no match → drop field (`rmfield` semantics).

Transform rules:

- `PulseSequenceType`: substring match on `epi` → `"EPI"`, `grase` → `"GRASE"`, `spiral` → `"spiral"`. No match → `undefined`.
- `Manufacturer`: substring match on `siemens` → `"Siemens"`, `philips` → `"Philips"`, `ge` → `"GE_product"`. No match → `undefined`.

Both transforms live in `src/lib/bids/normalize.ts` (or directly in `schema.ts`), consumed by `BidsAslMetadataBaseSchema`. No Rust normalize module needed.

**Alternatives considered:**

- **Strict zod enums, normalize in Rust (rejected per grill Q25):** Adds a Rust normalize module. Symmetric Zod transforms on both sides are cleaner — validation and canonicalization happen at the same layer.
- **Two schemas (strict for DICOM-import, loose for BIDS-direct) (rejected per grill Q25):** Two variants of `BidsAslMetadataBaseSchema` would require consumer code to pick the right one. Transforms unify both paths.

### D10: Use `BidsAslMetadataSchema` (with superRefine) for both DICOM and BIDS-direct paths

**Decision:** One schema, `BidsAslMetadataSchema` (with `refineBidsMetadata` superRefine), validates `metadataGroups[].bidsParams` regardless of source path. Cross-field rules (e.g., `M0Type` ↔ `aslcontext.tsv`) always validate. D8's derivation (with `"Estimate"` exception) guarantees derived `M0Type` agrees with `aslcontext.tsv` for non-Estimate cases, and `"Estimate"` passes superRefine rules trivially. **Verification:** superRefine at `importSchemas.ts:250` rejects non-`"Included"` M0Type when aslcontext has m0scan — `"Estimate"` would fail this if aslcontext has m0scan, but in practice `"Estimate"` datasets have no m0scan in aslcontext (estimated M0 means no M0 acquisition), so line 250's `hasM0Scan` branch is false and `"Estimate"` reaches the `else` branch (line 257+) where it passes (`!=="Included"` and `!== undefined`). Confirmed safe for the realistic `"Estimate"` use case.

**Alternatives considered:**

- **Use `BidsAslMetadataBaseSchema` (no superRefine) for BIDS-direct (rejected per grill Q29):** Initially proposed because sidecar data is machine-written. But contradictions can exist in machine-converted sidecars (e.g., `M0Type: "Separate"` while `aslcontext.tsv` includes `m0scan`). SuperRefine catches these; base schema misses them. With D8's derivation, contradictions are pre-empted — but using the same superRefine guarantees no regression if derivation logic changes later.

### D11: Missing `aslcontext.tsv` → session skipped (not fatal scan error)

**Decision:** If `*_aslcontext.tsv` is missing or unparseable alongside a sidecar, that subject/session is added to `skippedSubjects[]` with format `"sub-XX_<session>"` (per D2 session convention). Scan continues. `BIDSReviewPanel` shows the skipped-subjects warning block. Schema's `ASLContext` field stays `.optional()` because file-presence enforcement lives at the Rust scan layer, not the schema layer.

**Alternatives considered:**

- **Hard error on `scan_bids_sidecars` (rejected per grill Q41):** Whole project can't proceed. Overly strict — one missing aslcontext.tsv shouldn't block the entire dataset.
- **Tighten schema to require `ASLContext` (rejected per grill Q41):** DICOM-import path uses `studyPar.json` which can omit `ASLContext` for some sequences. Schema stays permissive; file-presence enforcement at Rust scan layer.

### D12: `find_asl_sidecars` walks top-level `sub-*/` only

**Decision:** `find_asl_sidecars(bids_root)` iterates `read_dir(bids_root)`, includes entries that start with `sub-` and are directories. Recursively walks into `perf/` (cross-sectional) and `ses-*/perf/` (longitudinal) looking for `*_asl.json`. Excludes `derivatives/`, `sourcedata/`, `.easl_staging/`, and any non-`sub-` top-level paths by virtue of the `sub-` prefix check.

**Alternatives considered:**

- **Recursive walk of entire root (rejected per grill Q42):** Would pick up `derivatives/ExploreASL/sub-XX_asl.json` (from prior processing runs) and double-count subjects. Excluding by path-prefix is fragile; including by `sub-*` prefix at top level is robust.

### D13: Typed `SidecarGroup` payload (Rust → frontend)

**Decision:** Replace draft's `SidecarGroup.params: serde_json::Value` with typed fields:

```rust
pub struct SidecarGroup {
    pub fingerprint_hash: String,
    pub label: String,                    // auto-suggested per label algorithm, computed by Rust
    pub vendor: String,                   // derive_vendor() output
    pub sequence: String,                 // derive_sequence() output
    pub labeling_type: String,            // derive_labeling_type() output
    pub bids_params: BidsAslMetadata,     // typed struct mirroring TS BidsAslMetadataBaseSchema
    pub subjects: Vec<GroupSubject>,
}
```

`BidsAslMetadata` Rust struct mirrors TS `BidsAslMetadataBaseSchema` with `serde(rename_all = "camelCase")` for JSON wire compatibility. Label auto-suggestion (`06-label-algorithm.md` pattern) runs in Rust; frontend edits the label but doesn't regenerate the algorithm.

Frontend `DerivedMetadataGroupSchema` (TS) extends `MetadataGroupSchema` with display-only `vendor`, `sequence`, `labelingType`, `subjects` fields. On confirm, project down to `MetadataGroup` (pick `id`, `label`, `bidsParams`) + `SubjectRow[]` (flatten `subjects[]`).

**Alternatives considered:**

- **Keep `params` as raw `serde_json::Value`, derive in frontend (rejected per grill Q18):** Frontend would repeat field-access boilerplate in every renderer (`BIDSReviewPanel`, manifest §1, label suggestion). Label algorithm would need to live in two places. Rust already has `derive_vendor`/`derive_sequence`/`derive_labeling_type`; computing the label alongside those is one more step. Typed values mean the frontend gets canonical forms, not raw sidecar strings.

### D14: `parse_bids_structure` is path-agnostic; callers pass appropriate path

**Decision:** `parse_bids_structure(bids_root: &Path)` scans whatever path it receives for `sub-*/` directories. Two callers:

- `check_bids_dataset(root_path)` and `scan_bids_sidecars(root_path)` pass project root → root-level scan (BIDS-direct).
- `list_subjects(project_root)` passes `project_root.join("rawdata")` → rawdata scan (DICOM-import path, existing contract preserved).

**Alternatives considered:**

- **`parse_bids_structure` auto-detects root vs rawdata (rejected per grill Q38):** Path-detection logic inside the function complicates it. Caller knows the use case; callee stays simple.

### D15: `check_bids_dataset` scs root-level only; `scan_bids_sidecars` does full parse

**Decision:** `check_bids_dataset` calls `parse_bids_structure(root_path)` + sidecar-existence check (does any `*_asl.json` exist in `perf/`?). No JSON parsing. Fast detection at LandingPage.

`scan_bids_sidecars` (called when `BIDSReviewPanel` mounts) calls `parse_bids_structure` + `find_asl_sidecars` + `parse_sidecar` + `extract_fingerprint` + `compute_group_hash` + `group_by_fingerprint` + `derive_vendor`/`sequence`/`labeling_type` + label generation. Full work, happens once.

`parse_bids_structure` (directory walk) may be called twice — cheap (directory entries only).

**Alternatives considered:**

- **One scan, cache result across navigation (rejected per grill Q21):** Pass `BidsSidecarScan` through navigation state. Saves one scan but couples detection and review-panel layers. Clean layering wins.
- **Two scans, both call `scan_bids_sidecars` (rejected per grill Q21):** Detection (`check_bids_dataset`) doesn't need fingerprinting — it just needs to know "are ASL subjects with sidecars present?". Full parse at detection time wastes time on rejected folders.

### D16: Label collision resolution uses sorted subject list (deterministic)

**Decision:** When multiple distinct fingerprint groups produce the same auto-suggested label, suffix `_(2)` is applied to the second group onward. First retains unadorned label. Assignment is deterministic: groups sorted by subject count (descending), tiebreak by sorted subject list head (alphabetical, ignoring directory scan order), tertiary tiebreak by full sorted subject list. `std::fs::read_dir` order is not guaranteed; sorting subject lists before picking "first subject" guarantees cross-platform determinism.

**Alternatives considered:**

- **Tiebreak by first subject in scan order (rejected per grill Q19):** Non-deterministic across runs/platforms. Same dataset on Linux vs Windows could assign different unadorned labels.

### D17: Auto-labels computed once at scan completion; user edits leave other groups' labels alone

**Decision:** Auto-suggested labels + collision suffixes computed once at scan time by Rust. User edits in `BIDSReviewPanel` do not trigger re-collision of other groups — Group B retains `Philips_PCASL_Absent_(2)` even if user edits Group A's label away from `Philips_PCASL_Absent`. Duplicate/empty validation at confirm-time only: if any labels are duplicate (case-insensitive) or empty at `[Confirm]` click, confirmation is blocked with inline errors. User resolves manually.

**Alternatives considered:**

- **Live re-collision on user edit (rejected per grill Q23):** Auto-recolliding other groups while user edits is confusing and destroys user intent mid-edit. Validate at confirm-time; let user resolve duplicates explicitly.

### D18: `scan_bids_sidecars` error retry + back-to-landing

**Decision:** `importStore` BIDS review slice provides two actions: `retryBidsScan()` (re-calls `scan_bids_sidecars`, clears `scanError`) and `backToLanding()` (navigate to `/`, abandons project). `BIDSReviewPanel` error alert has two buttons: `[Retry]` and `[Back to Landing]`. After 2 retries failing, additional hint shown: "Persistent scan failure — check directory permissions or delete project and recreate." (hint only, no counting logic).

For "0 groups found" state: render as error alert with same buttons. No project deletion prompt — user can retry or back out.

**Alternatives considered:**

- **Single `retryBidsScan()` with hard cancel (rejected per grill Q22):** User needs a clean escape hatch if scan persistently fails. "Hard cancel" semantics unclear; `backToLanding` is explicit.

### D19: Single source of truth for `confirmed` state

**Decision:** Drop `BidsReviewState.confirmed` flag from `importStore`. Use `project.uiState.import.bidsReviewConfirmed` (persisted in `.easl`) as the single source of truth. `BIDSReviewState` keeps session-only scan state: `scanComplete`, `scanError`, `detectedGroups`, `skippedSubjects`. `BIDSReviewPanel` reads `confirmed` from project store via hook. Confirm action updates `project.uiState.import.bidsReviewConfirmed` (persisted) — no separate store flag. No sync logic.

**Alternatives considered:**

- **Two flags, sync on store init (rejected per grill Q36):** Two sources of truth for the same concept invite divergence. Single source eliminates sync bugs.

### D20: Persisted `skippedSubjects` across sessions

**Decision:** Add `skippedSubjects: string[]` to `ImportUiStateSchema` (default `[]`, persisted to `.easl`). Format follows D2's session convention (`sub-XX_<session>`). Read-only summary on revisit shows the skipped-subjects warning block identically to the one shown at confirm time.

**Alternatives considered:**

- **Accept data loss, ephemeral only (rejected per grill Q30):** Users who revisit the import page after restart would not see skipped subjects. Persisting is one schema field + one write per confirm — trivially cheap.

### D21: Root-level participants.tsv site column takes precedence

**Decision:** `ensureParticipantsFiles` operates only on `<projectRoot>/derivatives/ExploreASL/participants.tsv`. Root-level user-authored `participants.tsv` is never modified by GUI code. However, in BIDS-direct projects, if the root-level `participants.tsv` contains a `site` column:

- The user's `site` values take precedence. The GUI reads `<projectRoot>/participants.tsv` to extract the `site` values.
- The lookup matches the root-level `participant_id` (e.g. `sub-01`) against the base subject label of the session record (e.g. `sub-01` matches both `sub-01_1` and `sub-01_2`), assuming root-level `participants.tsv` always lists subjects at the subject level.
- These user-defined `site` values are preserved and written to `<projectRoot>/derivatives/ExploreASL/participants.tsv`.
- They are NOT overwritten by metadata group labels (even when `enableMetadataGroupingCorrection = true`), and the column is NOT stripped (even when `enableMetadataGroupingCorrection = false`).
- If `enableMetadataGroupingCorrection = true`, the GUI only fills in group labels for subjects/sessions that do not have a defined `site` value in the root-level file.

No new pre-flight warning is required.

The `BIDSReviewPanel` persisted banner reframes to reflect actual behavior: "Your existing `participants.tsv` (at project root) is not modified by ExploreASL GUI. During processing, ExploreASL generates its own working copy at `derivatives/ExploreASL/participants.tsv` and appends processing-derived columns (`site`, `gm_vol`, `motion`, etc.) there. Your root-level file stays as you authored it."

**Alternatives considered:**

- **Pre-flight warning for missing `site` column in root-level `participants.tsv` (rejected per grill Q47/Q48):** Function targets derivatives path, not root. Warning was based on a misread of the code. ExploreASL adds columns to derivatives, not root. Warning false-positives a non-issue.

### D22: `ensure_rawdata_dir` adds `.bidsignore` + warns if non-empty

**Decision:** `ensure_rawdata_dir(root_path)` algorithm:

1. Create `<root>/rawdata/` if missing (idempotent).
2. Write `<root>/rawdata/README.md` (idempotent, overwrite). Content documents purpose: "Required by ExploreASL. Subjects live at root level."
3. Write/append `<root>/.bidsignore`:
   - If `.bidsignore` doesn't exist → create with content `"rawdata/\n"`.
   - If exists but lacks `rawdata/` line → append `"rawdata/\n"`.
   - If exists with `rawdata/` line → no-op.
4. If `rawdata/` exists AND is non-empty (contains any `sub-*/` entry): return warning payload to frontend. Frontend shows confirmation dialog: "`rawdata/` at `<root>/rawdata/` already contains `<N>` sub-directories. `subjectFolder` override scans root-level subjects only; files in `rawdata/` will be ignored. Proceed?" Confirm/Cancel.

Detection dialog (LandingPage) mentions `rawdata/` creation: "Note: A `rawdata/` directory will be created in this folder during processing (required for ExploreASL compatibility)."

**Alternatives considered:**

- **Silent `rawdata/` creation + no `.bidsignore` (rejected per grill Q31/Q32):** User's original folder gets a new directory they didn't expect. If under version control, `rawdata/` shows up as untracked. `.bidsignore` documents intent. Detection dialog pre-warns.

### D23: `subjectFolder` override verified against ExploreASL MATLAB source

**Decision:** ExploreASL's `BIDS2Legacy` module (verified via prior agent investigation of MATLAB source): `xASL_init_DataLoading.m` checks `xASL_exist(<root>/rawdata, 'dir')` before loading; `xASL_init_SubjectList.m` uses `x.opts.subjectFolder` (when set) to override `bids.layout()`'s scan path. Empty `rawdata/` + `subjectFolder = rootPath` redirects scans to root-level `sub-*/` directly. Cross-platform (no symlinks). Verified mechanism.

**Alternatives considered:**

- **Symlinks from `rawdata/sub-*` to root-level `sub-*` (rejected per ADR-10):** Symlinks do not work reliably on Windows. Empty dir + override is safe and simple.
- **Custom loader bypassing `BIDS2Legacy` (rejected):** Couples GUI to ExploreASL internals too tightly. `subjectFolder` is a documented extension point.

### D24: Fingerprint field set (15 fields)

**Decision:** `FINGERPRINT_FIELDS` contains exactly: `ArterialSpinLabelingType`, `PostLabelingDelay`, `MRAcquisitionType`, `MagneticFieldStrength`, `Manufacturer`, `ManufacturersModelName`, `M0Type`, `BackgroundSuppression`, `BolusCutOffDelayTime`, `BolusCutOffTechnique`, `LabelingDuration`, `BackgroundSuppressionNumberPulses`, `RepetitionTimePreparation`, `PulseSequenceType`, `EchoTime`. `ASLContext` is display-only (D7) — not in fingerprint.

Documented known-variance sources: `PulseSequenceType` and `ManufacturersModelName` are free-form string fields with variance across converter versions. Auto-detected grouping assumes consistent upstream conversion within a single dataset. Cross-converter mixing is the edge case, not the common case. Manual merge (deferred to v1.5) handles cross-converter explosions.

**Alternatives considered:**

- **Drop `PulseSequenceType` from fingerprint (rejected per grill Q16):** Within a single BIDS dataset (one project), upstream conversion is typically consistent. Cross-converter mixing is an edge case; user manually merges in v1.5 once feedback shows groups exploding on weird datasets.

### D25: Frontend `src/lib/bids/` folder module

**Decision:** New frontend folder module `src/lib/bids/` organized by theme:

- `path.ts` — `isBidsFilename`, `parseBidsEntities`, `isAslSuffix`, `isM0Suffix`, `isSubjectDir`, `isSessionDir`.
- `validation.ts` — `isBidsProject`, `ensureBidsIgnore` (migrated from `bidsUtils.ts`).
- `sidecar.ts` — `validateBidsAslParams`, `extractFingerprint`, `deriveInjectedFields`, `parseAslContext`, `summarizeAslContext`.
- `schema.ts` — re-exports `BidsAslMetadataSchema`, `BidsAslMetadataBaseSchema`, types.
- `normalize.ts` — Zod transforms for `PulseSequenceType` and `Manufacturer` (D9).
- `index.ts` — re-exports.

Existing consumers update imports (`projectStore.ts`: `isBidsProject` → `../lib/bids/validation`).

### D26: Rust `src-tauri/src/bids/` folder module

**Decision:** New Rust folder module `src-tauri/src/bids/`:

- `mod.rs` — module root, re-exports.
- `path.rs` — `parse_bids_filename`, `is_subject_dir`, `is_session_dir`, `resolve_sessions` (returns `vec!["1"]` for cross-sectional per D2).
- `scan.rs` — `parse_bids_structure` (path-agnostic per D14), `BidsSubject`/`BidsSession`/`AslFile` structs.
- `sidecar.rs` — `find_asl_sidecars` (top-level `sub-*/` only per D12), `parse_sidecar`, `find_asl_context_for`, `parse_asl_context`, `inject_asl_context`, `extract_fingerprint` (top-level keys only per D4, number canonicalization per D5, array sorting per D6).
- `group.rs` — `compute_group_hash`, `group_by_fingerprint`, `BidsSidecarScan`/`SidecarGroup`/`GroupSubject` (typed payload per D13).
- `vendor.rs` — `derive_vendor` (case-insensitive substring matching), `derive_sequence`, `derive_labeling_type`, M0Type derivation logic (D8), label auto-suggestion (`06-label-algorithm.md` pattern with collision resolution per D16).

Shared by `processing.rs` (refactored `list_subjects`), new BIDS-direct commands. Register in `lib.rs`.

## Risks / Trade-offs

- **[Risk: ExploreASL's `subjectFolder` mechanism drift] → Mitigation:** Verified against MATLAB source via prior investigation (grill Q1 — user confirmed draft is accurate). GUI tightly couples to this undocumented extension point. If ExploreASL refactors `BIDS2Legacy`, BIDS-direct processing breaks. Test with ds000240 integration (real pipeline invocation) in task #17 / e2e tests. Document dependency in `exploreasl-rawdata-compat` spec.
- **[Risk: Cross-sectional session `"1"` vs `"01"` mismatch] → Mitigation:** D2 fixes this. Verified against MATLAB `SessionID = '1'` default. Lock-file matching and derivatives path resolution depend on this exact string. Test: ds000240 sub-01 produces `subject_session: "sub-01_1"`; lock file search `sub-01_1_asl.lock` resolves to MATLAB's output. Integration test is critical.
- **[Risk: ds000240 sidecar fields violate schema enums (originally)] → Mitigation:** D9 (Zod transforms) + D8 (M0Type derivation) + BIDS spec M0Type `"Included"` (replacing `"Integrated"`). Verified against `test/ds000240/sub-01/perf/sub-01_asl.json`: `PulseSequenceType: "3D_SPIRAL"` → transform → `"spiral"` ✓; `Manufacturer: "Siemens"` → transform → `"Siemens"` ✓; `M0Type: "Included"` → enum match ✓. Test with ds000240 at schema validation unit tests.
- **[Risk: 5000+ subject dataset scan blocks UI for 30+ seconds] → Mitigation:** Documented perfcharacteristics (per grill Q37). v1 acceptable for typical studies. v1.5+ candidate: progress reporting / streaming partial results. No code change v1.
- **[Risk: User picks wrong folder (existing DICOM project) for BIDS-direct] → Mitigation:** D22 step 4 warns when `rawdata/` already non-empty with `sub-*/` entries. Detection dialog explicit choice (Skip Import vs DICOM). User must commit explicitly.
- **[Risk: Pre-existing `participants.tsv` destroyed] → Mitigation:** Misread of code — `ensureParticipantsFiles` operates only on `derivatives/ExploreASL/participants.tsv`, never on root-level (D21). Root-level user-authored files preserved by design. No new code behavior needed; spec clarifies existing architecture.
- **[Risk: Edge case — explicit `ses-1` directory collides with cross-sectional default `"1"`] → Mitigation:** D2 stores `has_explicit_session` separately from `session_label`. Both may be `"1"` but explicitness is preserved for downstream logic. Document in user-facing copy.
- **[Risk: First-subject ASLContext display misleading when subjects in same group have different ASLContexts] → Mitigation:** D7 — rare edge case, out of scope for v1 per user direction (grill Q15). User accepted the trade-off. v1.5 candidate: per-subject ASLContext display.
- **[Risk: Auto-label collision resolution non-deterministic across platforms] → Mitigation:** D16 — sort subject lists before picking "first subject" tiebreak. Deterministic regardless of `std::fs::read_dir` order. Test: same dataset produces same label assignment on Linux + Windows.
- **[Risk: User edits label to collide with another group's label mid-confirmation] → Mitigation:** D17 — validation at confirm-time only, blocks confirmation with inline errors. User resolves manually. No silent auto-recollision.
- **[Risk: BIDS version incompatibility (ds000240 BIDS 1.0.2 vs current 1.10.0)] → Mitigation:** D3 — no minimum BIDSVersion check. ExploreASL is source of truth for compatibility. If user hits failure at processing, error surfaces there. Render "Unknown" when missing. Test: ds000240 (BIDS 1.0.2) processes successfully end-to-end.
- **[Risk: Missing `aslcontext.tsv` blocks legitimate single-volume ASL datasets] → Mitigation:** Per grill Q41 user direction: missing `aslcontext.tsv` is BIDS violation, session skipped. BIDS spec requires the file for ASL modality. If user has legitimate non-BIDS dataset, they fix externally and re-scan (retry button per D18).
- **[Risk: Breaking changes destroy pre-release user data] → Mitigation:** Pre-release state (grill Q28) — no `.easl` files to migrate. Breaking changes permitted. Existing tests updated to set `dataSource` explicitly.

## Migration Plan

Pre-release: no migration. Breaking changes permitted for:

- `ProjectMetaSchema.dataSource` becomes required (no default).
- `ImportUiStateSchema.bidsReviewConfirmed` and `skippedSubjects` become required.
- `BidsAslMetadataBaseSchema.PulseSequenceType` and `Manufacturer` change from enums to transforms.

Rollback strategy: revert to previous commit; existing test fixtures regenerate. No data loss possible at this stage (project has no external users).

## Open Questions

All grill questions Q1-Q44 resolved. Outstanding v1.5+ candidates tracked in `08-open-questions.md` post-v1 list:

- Group splitting/merging in `BIDSReviewPanel`.
- Editing `bidsParams` in review panel.
- M0 sidecar integration into fingerprinting.
- Anatomical sidecar integration.
- Performance: progress reporting for 1000+ subject datasets.
- Per-subject ASLContext display (when divergence within fingerprint group matters).
- User-defined custom label pattern preference.
- Configurable fingerprint field set.

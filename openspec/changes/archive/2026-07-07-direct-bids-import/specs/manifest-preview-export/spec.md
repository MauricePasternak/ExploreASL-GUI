## ADDED Requirements

### Requirement: ManifestPreview uses summarizeAslContext for ASLContext display

`ManifestPreview.tsx` §1 study parameters table SHALL render `summarizeAslContext(group.bidsParams.ASLContext)` instead of the raw ASLContext string when displaying the `ASLContext` field. Raw ASLContext persists in `mappingState.bidsParams.ASLContext` (per `metadata-grouping-ui` spec) — the summary form is display-only.

Existing behavior for other `bidsParams` fields (conditional skipping of `LabelingDuration` for PASL, `BolusCutOffDelayTime` when `BolusCutOffFlag` is false) is preserved.

`ManifestPreview.tsx` continues to iterate `Object.entries(group.bidsParams)` (raw sidecar field rendering). Vendor/Sequence/LabelingType fields are review-panel display-only — NOT persisted in `mappingState.metadataGroups[].bidsParams` (per `project-store` confirmBidsReview spec).

#### Scenario: Manifest §1 shows ASLContext summary

- **WHEN** `ManifestPreview` renders §1 for a group whose `bidsParams.ASLContext` is the ds000240 raw 109-token string
- **THEN** the row displays `"m0scan×10, label×50, control×50"` (summarized form), not the raw comma-separated string

#### Scenario: Manifest §1 hides absent ASLContext

- **WHEN** `ManifestPreview` renders §1 for a group whose `bidsParams.ASLContext` is undefined (no aslcontext.tsv-based context, e.g., a DICOM-import project where `studyPar.json` omitted ASLContext)
- **THEN** the `ASLContext` row is omitted (existing behavior — `val == null` check at `ManifestPreview.tsx:89`)

#### Scenario: Manifest §1 renders raw sidecar fields unmodified

- **WHEN** `ManifestPreview` renders §1 for a BIDS-direct group
- **THEN** fields like `Manufacturer: "Siemens"`, `PulseSequenceType: "spiral"`, `MRAcquisitionType: "3D"`, `ArterialSpinLabelingType: "PCASL"`, `M0Type: "Included"` render directly from `bidsParams` (post-schema transform values). `Vendor`, `Sequence`, `LabelingType` derived fields are NOT rendered (not in `bidsParams`).

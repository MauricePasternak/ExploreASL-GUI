# metadata-grouping-ui Specification

## Purpose

TBD - created by archiving change mutually-exclusive-metadata. Update Purpose after archive.

## Requirements

### Requirement: Dynamic Display of Group Assignments

The `MetadataGrouping` component SHALL dynamically compute the number of subjects and sessions assigned to each group by filtering the current `subjectRows` state array and SHALL display a read-friendly summary string in the "Scope / Target" column.

#### Scenario: Displaying calculated assignments

- **WHEN** a metadata group has 2 unique subjects mapping to 3 total sessions assigned to it in `subjectRows`
- **THEN** the UI list SHALL display "Assigned to 2 subjects (3 sessions)" instead of a regex string.

### Requirement: Override Group Creation Without Regex Fields

When creating an override `MetadataGroup`, the component SHALL create the group object with only `{ id, label, bidsParams }`. The component MUST NOT set `subjectRegExp` or `sessionRegExp` fields, as these have been removed from the schema. Group membership is determined solely by `subjectRows` `groupId` assignments.

#### Scenario: Creating an override group from selected rows

- **WHEN** the user selects rows and creates an override group
- **THEN** the new `MetadataGroup` object SHALL contain `{ id, label, bidsParams }` only, and the selected rows SHALL have their `groupId` updated to point to the new group.

### Requirement: Removal of Static Regex Display

The component SHALL NOT display static `subjectRegExp` and `sessionRegExp` values.

#### Scenario: Ignoring static group regex fields

- **WHEN** the `MetadataGrouping` component renders a metadata group
- **THEN** it SHALL ignore any static `subjectRegExp` and `sessionRegExp` fields, mapping the display to calculated values from `subjectRows` instead.

### Requirement: Removal of Regex Building on Override Creation

The component SHALL NOT build or set regex strings when creating override groups.

#### Scenario: Creating override without building regex

- **WHEN** an override group is created
- **THEN** `buildExactMatchRegex` SHALL NOT be invoked and the resulting group object SHALL NOT have group-level regexes.

### Requirement: MetadataGroupSchema and DerivedMetadataGroupSchema

The existing `MetadataGroupSchema` (`{ id: string, label: string, bidsParams: BidsAslMetadataBaseSchema }`) is preserved unchanged.

`DerivedMetadataGroupSchema` SHALL be added, extending `MetadataGroupSchema`:

```typescript
export const DerivedMetadataGroupSchema = MetadataGroupSchema.extend({
  vendor: z.string(),
  sequence: z.string(),
  labelingType: z.string(),
  subjects: z.array(
    z.object({
      subjectLabel: z.string(),
      sessionLabels: z.array(z.string()),
    }),
  ),
});
export type DerivedMetadataGroup = z.infer<typeof DerivedMetadataGroupSchema>;
```

`DerivedMetadataGroup` is used in the `importStore` BIDS review slice (`detectedGroups: DerivedMetadataGroup[]`) and rendered by `BIDSReviewPanel`. On confirm, the store projects down to `MetadataGroup` (pick `id`, `label`, `bidsParams`) for persistence in `mappingState.metadataGroups`.

#### Scenario: DerivedMetadataGroup roundtrips

- **WHEN** `scan_bids_sidecars` returns a `SidecarGroup` with vendor/sequence/labeling_type/subjects
- **THEN** the frontend receives `DerivedMetadataGroup` with all display-only fields populated; `BIDSReviewPanel` can render vendor badge and subject list

#### Scenario: Confirm projects down

- **WHEN** user confirms BIDS review with 2 `DerivedMetadataGroup` entries
- **THEN** `mappingState.metadataGroups` contains 2 `MetadataGroup` entries with only `id`, `label`, `bidsParams`; `vendor`, `sequence`, `labelingType`, `subjects` are NOT persisted

### Requirement: Zod transforms for PulseSequenceType and Manufacturer

`BidsAslMetadataBaseSchema.PulseSequenceType` SHALL use a Zod transform replacing the strict `z.enum(["spiral", "GRASE", "EPI"])`:

```typescript
PulseSequenceType: z
  .string()
  .transform((val, ctx) => {
    const v = val.toLowerCase();
    if (
      v.includes("epi") ||
      v.includes("ep2d") ||
      v.includes("epfid") ||
      v.includes("pepolar")
    ) {
      return "EPI";
    }
    if (v.includes("grase") || v.includes("tgse")) {
      return "GRASE";
    }
    if (v.includes("spiral")) {
      return "spiral";
    }
    return undefined; // matches ExploreASL's rmfield semantics
  })
  .optional(),
```

`BidsAslMetadataBaseSchema.Manufacturer` SHALL use a Zod transform replacing the strict `z.enum(["GE_product", "Philips", "Siemens"])`:

```typescript
Manufacturer: z
  .string()
  .transform((val, ctx) => {
    const v = val.toLowerCase();
    if (v.includes("siemens")) return "Siemens";
    if (v.includes("philips")) return "Philips";
    if (v.includes("ge"))      return "GE_product";
    return undefined;
  })
  .optional(),
```

Transforms live in `src/lib/bids/normalize.ts` and are consumed by `src/lib/bids/schema.ts` (which re-exports the schemas).

Both are symmetric with ExploreASL's MATLAB `regexpi` pattern: case-insensitive substring match, canonical emission, drop field on no match.

#### Scenario: PulseSequenceType normalization (ds000240)

- **WHEN** schema validates `PulseSequenceType: "3D_SPIRAL"` (ds000240 sidecar value)
- **THEN** transform returns `"spiral"`; downstream `bidsParams.PulseSequenceType === "spiral"`

#### Scenario: PulseSequenceType normalization of Siemens/GE variants

- **WHEN** schema validates `PulseSequenceType` with value `"ep2d"`, `"epfid2d1_64"`, `"pepolar"`, or `"tgse"`
- **THEN** `"ep2d"`, `"epfid2d1_64"`, and `"pepolar"` normalize to `"EPI"`, and `"tgse"` normalizes to `"GRASE"`

#### Scenario: Unrecognized PulseSequenceType dropped

- **WHEN** schema validates `PulseSequenceType: "unknown_readout"`
- **THEN** transform returns `undefined`; field absent from parsed object

#### Scenario: Manufacturer normalization (SIEMENS longhand)

- **WHEN** schema validates `Manufacturer: "SIEMENS TrioTim"`
- **THEN** transform returns `"Siemens"`; downstream `bidsParams.Manufacturer === "Siemens"`

#### Scenario: GE longhand

- **WHEN** schema validates `Manufacturer: "GE MEDICAL SYSTEMS"`
- **THEN** transform returns `"GE_product"`

#### Scenario: Unrecognized manufacturer dropped

- **WHEN** schema validates `Manufacturer: "Canon Medical Systems"`
- **THEN** transform returns `undefined`; field absent from parsed object; downstream `derive_vendor` falls back to `"UnknownVendor"`

### Requirement: summarizeAslContext helper

`src/lib/bids/sidecar.ts` SHALL export `summarizeAslContext(raw: string | undefined): string`:

- undefined / empty → returns `""`
- Else: parse comma-separated tokens; run-length encode identical adjacent runs; format as `"{value}×{count}, {next}×{count}, ..."`

Example: `"m0scan,m0scan,m0scan,...(10x),label,control,...(50x)"` → `"m0scan×10, label×50, control×50"` (assuming the 10 m0scans are first; 50 label/control pairs follow).

Manifest §1 and `BIDSReviewPanel` parameter expansions use this summary form. Raw ASLContext persists in `mappingState.bidsParams.ASLContext` (preserves data for re-parsing / future tooling).

#### Scenario: ds000240 110-volume context summarized

- **WHEN** `summarizeAslContext` receives ds000240 sub-01's raw ASLContext string (`m0scan×10, label×50, control×50`)
- **THEN** returns `"m0scan×10, label×50, control×50"` (or equivalent run-length encoded summary based on actual order)

#### Scenario: Undefined context returns empty

- **WHEN** `summarizeAslContext(undefined)` is called (e.g., skipped subject or missing aslcontext.tsv)
- **THEN** returns `""`

### Requirement: ASLContext persists raw in mappingState

When BIDS review confirms, `mappingState.metadataGroups[].bidsParams.ASLContext` SHALL contain the raw first-subject ASLContext string (109+ tokens for ds000240). The schema's `ASLContext` field stays `.optional()` (file-presence enforcement lives at Rust scan layer; missing `aslcontext.tsv` skips session).

#### Scenario: Raw ASLContext persisted

- **WHEN** user confirms BIDS review for ds000240 with 1 group whose first subject has 109 ASLContext tokens
- **THEN** `mappingState.metadataGroups[0].bidsParams.ASLContext` contains the raw 109-token string (full data preserved); `manifest §1` rendering displays the summarized form via `summarizeAslContext`

### Requirement: schemas updated for BIDS-spec M0Type value

`BidsAslMetadataBaseSchema.M0Type` SHALL use `z.enum(["Separate", "Included", "Absent", "Estimate"])`. The `"Integrated"` value (used in older iterations) is replaced by `"Included"` (BIDS-spec terminology). Files previously using `"Integrated"` must be updated to `"Included"` (pre-release breaking change; no migration).

The `refineBidsMetadata` superRefine is preserved (rules reference `"Included"` instead of `"Integrated"`).

#### Scenario: ds000240 sidecar M0Type validates

- **WHEN** schema validates `M0Type: "Included"` (ds000240 sidecar value)
- **THEN** validation passes (matches enum)

## ADDED Requirements

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

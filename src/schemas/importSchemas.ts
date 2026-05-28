import { z } from "zod";

// =============================================================================
// Step 1: DICOM Ingestion — Path Patterns
// =============================================================================

/**
 * A discovered structural pattern in the DICOM directory tree.
 * Multiple paths share the same "signature" (structural shape).
 */
export const PathPatternSchema = z.object({
  /** Human-readable signature, e.g. "SUBJECT/FIXED_DICOM/VARYING/VARYING" */
  signature: z.string(),
  /** One representative full relative path for display */
  samplePath: z.string(),
  /** Path split by "/" — the folder-level blocks */
  blocks: z.array(z.string()),
  /** block index => unique values found at that depth across all matching paths */
  uniqueNames: z.record(z.array(z.string())),
  /** How many paths match this pattern */
  count: z.number().int().min(1),
  /** The total folder depth of this pattern */
  depth: z.number().int().min(1),
});

export type PathPattern = z.infer<typeof PathPatternSchema>;

// =============================================================================
// Step 2: Visual Path Tokenizer
// =============================================================================

/** Semantic tag for a path block */
export const TOKEN_TAGS = ["Subject", "Session", "Run", "Modality", "Ignore"] as const;
export const TokenTagSchema = z.enum(TOKEN_TAGS);
export type TokenTag = z.infer<typeof TokenTagSchema>;

/**
 * Assignment of a semantic tag to a specific block within a pattern.
 * blockIndex refers to the folder depth level (0-based).
 * When a folder level has sub-blocks (split by _ or -), subBlockIndex
 * identifies which sub-block within that level.
 */
export const TokenAssignmentSchema = z.object({
  /** Which folder depth level (0-based) */
  blockIndex: z.number().int().min(0),
  /** Which sub-block within the folder level (0-based). null = entire level is one token */
  subBlockIndex: z.number().int().min(0).nullable().default(null),
  /** The semantic tag */
  tag: TokenTagSchema,
});

export type TokenAssignment = z.infer<typeof TokenAssignmentSchema>;

/**
 * Complete tokenizer configuration for one pattern.
 * Generates the folderHierarchy regex array and tokenOrdering.
 */
export const TokenizerConfigSchema = z.object({
  /** Pattern signature this config applies to */
  patternSignature: z.string(),
  /** Generated regex array — one entry per folder depth level */
  folderHierarchy: z.array(z.string()),
  /**
   * ExploreASL tokenOrdering: [Subject, Visit, Session, Scan]
   * GUI mapping: Subject=Subject, Session=Visit(1), Run=Session(2), Modality=Scan(3)
   * Values are 0-based capture group indices. -1 means "not captured" (use default).
   */
  tokenOrdering: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Per-block tag assignments */
  assignments: z.array(TokenAssignmentSchema),
});

export type TokenizerConfig = z.infer<typeof TokenizerConfigSchema>;

// =============================================================================
// Step 3: Alias Resolution
// =============================================================================

/** ExploreASL modality names */
export const EXPLOREASL_MODALITIES = [
  "T1w",
  "T2w",
  "ASL4D",
  "M0",
  "FLAIR",
  "WMH_SEGM",
] as const;

export const ModalityAliasSchema = z.object({
  /** Raw captured modality string from folder names */
  captured: z.string(),
  /** Mapped ExploreASL modality, or null for "Ignore" */
  mapped: z.enum(EXPLOREASL_MODALITIES).nullable(),
});

export type ModalityAlias = z.infer<typeof ModalityAliasSchema>;

export const SessionAliasSchema = z.object({
  /** Raw captured session/run string */
  captured: z.string(),
  /** Generated alias, e.g. "ASL_1" */
  alias: z.string(),
  /** Chronological order (1-based) */
  index: z.number().int().min(1),
});

export type SessionAlias = z.infer<typeof SessionAliasSchema>;

export const SubjectRenameSchema = z.object({
  /** Original captured subject name */
  original: z.string(),
  /** Target BIDS-compliant name */
  target: z.string(),
});

export type SubjectRename = z.infer<typeof SubjectRenameSchema>;

// =============================================================================
// Step 4: BIDS ASL Metadata (studyPar.json)
// =============================================================================

/**
 * Full BIDS ASL metadata schema.
 * Uses .passthrough() to allow additional unknown BIDS fields.
 *
 * Conditional rendering rules (implemented in UI via React Hook Form watch()):
 * - ArterialSpinLabelingType = PCASL → show PCASLType, LabelingDuration
 * - ArterialSpinLabelingType = CASL  → show CASLType, LabelingDuration
 * - ArterialSpinLabelingType = PASL  → show BolusCutOffFlag
 * - BolusCutOffFlag = true           → show BolusCutOffDelayTime, BolusCutOffTechnique
 * - BackgroundSuppression = true     → show NumberPulses, PulseTime
 * - MRAcquisitionType = "2D"         → show SliceTiming
 */
export const BidsAslMetadataSchema = z
  .object({
    // === Required for all ASL ===
    ArterialSpinLabelingType: z.enum(["CASL", "PCASL", "PASL"]).optional(),
    PostLabelingDelay: z
      .union([z.number(), z.array(z.number())])
      .optional(),
    MRAcquisitionType: z.enum(["2D", "3D"]).optional(),
    MagneticFieldStrength: z.number().optional(),
    EchoTime: z.number().optional(),

    // === (P)CASL required ===
    LabelingDuration: z
      .union([z.number(), z.array(z.number())])
      .optional(),

    // === (P)CASL recommended (conditional) ===
    PCASLType: z.enum(["balanced", "unbalanced"]).optional(),
    CASLType: z.enum(["single-coil", "double-coil"]).optional(),
    LabelingPulseAverageGradient: z.number().optional(),
    LabelingPulseMaximumGradient: z.number().optional(),
    LabelingPulseAverageB1: z.number().optional(),
    LabelingPulseDuration: z.number().optional(),
    LabelingPulseInterval: z.number().optional(),

    // === PASL required ===
    BolusCutOffFlag: z.boolean().optional(),

    // === PASL conditional (when BolusCutOffFlag=true) ===
    BolusCutOffDelayTime: z
      .union([z.number(), z.array(z.number())])
      .optional(),
    BolusCutOffTechnique: z.string().optional(),

    // === Recommended ===
    BackgroundSuppression: z.boolean().optional(),
    BackgroundSuppressionNumberPulses: z.number().optional(),
    BackgroundSuppressionPulseTime: z.array(z.number()).optional(),
    VascularCrushing: z.boolean().optional(),
    TotalAcquiredPairs: z.number().optional(),
    RepetitionTimePreparation: z.number().optional(),
    FlipAngle: z.union([z.number(), z.array(z.number())]).optional(),
    SliceTiming: z.array(z.number()).optional(),

    // === Vendor (required for ASL quantification) ===
    Vendor: z
      .enum(["Siemens", "Philips", "GE_product", "GE_WIP"])
      .optional(),
    PulseSequenceType: z.enum(["spiral", "GRASE", "EPI"]).optional(),
    Manufacturer: z.string().optional(),

    // === M0 ===
    M0: z.boolean().optional(),
    M0Type: z
      .enum(["separate", "integrated", "absent", "estimate"])
      .optional(),

    // === ExploreASL-specific ===
    ASLContext: z
      .enum(["m0scan,deltam", "control,label", "label,control", "cbf"])
      .optional(),
    DatasetType: z.string().optional(),
    LabelingType: z.enum(["PASL", "CASL"]).optional(),
    DummyScanPositionInASL4D: z.array(z.number()).optional(),
    M0PositionInASL4D: z.array(z.number()).optional(),
    RepetitionTimePreparationM0: z.array(z.number()).optional(),
  })
  .passthrough();

export type BidsAslMetadata = z.infer<typeof BidsAslMetadataSchema>;

/**
 * A single entry in the StudyPars array.
 * The catch-all entry has no SubjectRegExp/SessionRegExp.
 * Override entries have exact-match regex from row selection.
 */
export const StudyParEntrySchema = BidsAslMetadataSchema.extend({
  SubjectRegExp: z.string().optional(),
  VisitRegExp: z.string().optional(),
  SessionRegExp: z.string().optional(),
  RunRegExp: z.string().optional(),
});

export type StudyParEntry = z.infer<typeof StudyParEntrySchema>;

/** studyPar.json top-level structure */
export const StudyParJsonSchema = z.object({
  StudyPars: z.array(StudyParEntrySchema).min(1),
});

export type StudyParJson = z.infer<typeof StudyParJsonSchema>;

// =============================================================================
// Step 5: sourcestructure.json
// =============================================================================

/**
 * sourcestructure.json — always 4-level hierarchy.
 * tokenOrdering maps to ExploreASL's [Subject, Visit, Session, Scan].
 * tokenSessionAliases and tokenScanAliases are flat arrays of alternating
 * [regex, alias] pairs.
 */
export const SourcestructureJsonSchema = z.object({
  folderHierarchy: z.array(z.string()).length(4),
  tokenOrdering: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  tokenSessionAliases: z.array(z.string()),
  tokenScanAliases: z.array(z.string()),
  bMatchDirectories: z.boolean(),
  dcm2nii_version: z.string().optional(),
});

export type SourcestructureJson = z.infer<typeof SourcestructureJsonSchema>;

// =============================================================================
// Import Progress Tracking
// =============================================================================

export const IMPORT_STEPS = ["DCM2NII", "NII2BIDS"] as const;
export const IMPORT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export const ImportProgressSchema = z.object({
  subject: z.string(),
  session: z.string(),
  status: z.enum(IMPORT_STATUSES),
  currentStep: z.enum(IMPORT_STEPS).optional(),
  error: z.string().optional(),
});

export type ImportProgress = z.infer<typeof ImportProgressSchema>;

// =============================================================================
// Metadata Grouping
// =============================================================================

export const MetadataGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  bidsParams: BidsAslMetadataSchema,
  /** Regex matching subjects in this group. Empty string = catch-all. */
  subjectRegExp: z.string().default(""),
  /** Regex matching sessions in this group. Empty string = catch-all. */
  sessionRegExp: z.string().default(""),
  /** Regex matching runs in this group. Empty string = catch-all. */
  runRegExp: z.string().default(""),
});

export type MetadataGroup = z.infer<typeof MetadataGroupSchema>;

/** A row in the subjects DataTable for metadata group assignment */
export const SubjectRowSchema = z.object({
  /** Unique row ID: "subject/session/run" */
  id: z.string(),
  subject: z.string(),
  session: z.string(),
  run: z.string(),
  /** ID of the MetadataGroup this row belongs to */
  groupId: z.string(),
});

export type SubjectRow = z.infer<typeof SubjectRowSchema>;

// =============================================================================
// Staging Entry (for symlink tree creation)
// =============================================================================

/** Maps a raw DICOM path to the normalized 4-level staging path */
export const StagingEntrySchema = z.object({
  subject: z.string(),
  session: z.string(),
  run: z.string(),
  modality: z.string(),
  /** Absolute path to the original DICOM directory or file */
  sourcePath: z.string(),
});

export type StagingEntry = z.infer<typeof StagingEntrySchema>;

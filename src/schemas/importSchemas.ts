import { z } from "zod";
import {
  parseCommaSeparatedNumbers,
  parseNumberOrArray,
} from "../components/import/metadataFormUtils";

const preprocessCommaNumber = (val: unknown) => {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return undefined;
    const result = parseNumberOrArray(trimmed);
    if (result.ok) {
      return result.value;
    }
    return val;
  }
  return val;
};

const preprocessCommaArray = (val: unknown) => {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return undefined;
    const result = parseCommaSeparatedNumbers(trimmed);
    if (result.ok) {
      return result.value;
    }
    return val;
  }
  return val;
};

const CommaNumberSchema = z.preprocess(
  preprocessCommaNumber,
  z.custom<number | number[]>((val) => {
    return typeof val === "number" || (Array.isArray(val) && val.every(item => typeof item === "number" && !Number.isNaN(item)));
  }, {
    message: "Invalid number or list of numbers",
  })
);

const CommaArraySchema = z.preprocess(
  preprocessCommaArray,
  z.custom<number[]>((val) => {
    return Array.isArray(val) && val.every(item => typeof item === "number" && !Number.isNaN(item));
  }, {
    message: "Invalid list of numbers",
  })
);

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
  uniqueNames: z.record(z.number(), z.array(z.string())),
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
function refineBidsMetadata(data: BidsAslMetadata, ctx: z.RefinementCtx) {
  // Required fields validations
  if (!data.ArterialSpinLabelingType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Arterial Spin Labeling Type is required",
      path: ["ArterialSpinLabelingType"],
    });
  }
  if (data.PostLabelingDelay === undefined || data.PostLabelingDelay === null || (Array.isArray(data.PostLabelingDelay) && data.PostLabelingDelay.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Post Labeling Delay is required",
      path: ["PostLabelingDelay"],
    });
  }
  if (!data.MRAcquisitionType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MR Acquisition Type is required",
      path: ["MRAcquisitionType"],
    });
  }
  if (data.MagneticFieldStrength === undefined || data.MagneticFieldStrength === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Magnetic Field Strength is required",
      path: ["MagneticFieldStrength"],
    });
  }
  if (!data.Manufacturer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Manufacturer is required",
      path: ["Manufacturer"],
    });
  }
  if (!data.ASLContext) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ASL Context is required",
      path: ["ASLContext"],
    });
  }

  const aslContextTokens = data.ASLContext
    ? data.ASLContext.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const hasM0Scan = aslContextTokens.includes("m0scan");

  if (hasM0Scan) {
    if (data.M0Type && data.M0Type !== "integrated") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "M0 Type must be 'integrated' when ASL Context contains 'm0scan'",
        path: ["M0Type"],
      });
    }
  } else {
    if (!data.M0Type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "M0 Type is required when ASL Context does not contain 'm0scan'",
        path: ["M0Type"],
      });
    }
    if (data.M0Type === "integrated") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "M0 Type cannot be 'integrated' when ASL Context does not contain 'm0scan'",
        path: ["M0Type"],
      });
    }
  }

  // Conditional validations
  const aslType = data.ArterialSpinLabelingType;
  if (aslType === "PCASL" || aslType === "CASL") {
    if (data.LabelingDuration === undefined || data.LabelingDuration === null || (Array.isArray(data.LabelingDuration) && data.LabelingDuration.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Labeling Duration is required for ${aslType}`,
        path: ["LabelingDuration"],
      });
    }
  }

  if (aslType === "PASL") {
    if (data.BolusCutOffFlag) {
      if (data.BolusCutOffDelayTime === undefined || data.BolusCutOffDelayTime === null || (Array.isArray(data.BolusCutOffDelayTime) && data.BolusCutOffDelayTime.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bolus Cut Off Delay Time is required when Bolus Cut Off Flag is enabled",
          path: ["BolusCutOffDelayTime"],
        });
      }
      if (!data.BolusCutOffTechnique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bolus Cut Off Technique is required when Bolus Cut Off Flag is enabled",
          path: ["BolusCutOffTechnique"],
        });
      }
    }
  }

  if (data.BackgroundSuppression) {
    if (data.BackgroundSuppressionNumberPulses === undefined || data.BackgroundSuppressionNumberPulses === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Background Suppression Number Pulses is required when Background Suppression is enabled",
        path: ["BackgroundSuppressionNumberPulses"],
      });
    }
  }

  if (data.MRAcquisitionType === "2D") {
    if (!data.SliceTiming || data.SliceTiming.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Slice Timing is required when MR Acquisition Type is 2D",
        path: ["SliceTiming"],
      });
    }
  }

  const pld = data.PostLabelingDelay;
  const bcd = data.BolusCutOffDelayTime;

  if (pld !== undefined && pld !== null && bcd !== undefined && bcd !== null) {
    const pldArray = Array.isArray(pld) ? pld : [pld];
    const bcdArray = Array.isArray(bcd) ? bcd : [bcd];

    if (pldArray.length > 1 || bcdArray.length > 1) {
      if (pldArray.length !== bcdArray.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Post Labeling Delay and Bolus Cut Off Delay Time must have the same number of elements",
          path: ["PostLabelingDelay"],
        });
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Post Labeling Delay and Bolus Cut Off Delay Time must have the same number of elements",
          path: ["BolusCutOffDelayTime"],
        });
      } else {
        for (let i = 0; i < pldArray.length; i++) {
          if ((pldArray[i] === 0) !== (bcdArray[i] === 0)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Zeros in Post Labeling Delay and Bolus Cut Off Delay Time must be at the same positions",
              path: ["PostLabelingDelay"],
            });
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Zeros in Post Labeling Delay and Bolus Cut Off Delay Time must be at the same positions",
              path: ["BolusCutOffDelayTime"],
            });
            break;
          }
        }
      }
    }
  }
}

export const BidsAslMetadataBaseSchema = z
  .object({
    // === Required for all ASL ===
    ArterialSpinLabelingType: z.enum(["CASL", "PCASL", "PASL"]).optional(),
    PostLabelingDelay: CommaNumberSchema.optional(),
    MRAcquisitionType: z.enum(["2D", "3D"]).optional(),
    MagneticFieldStrength: z.number().optional(),
    EchoTime: z.number().optional(),

    // === (P)CASL required ===
    LabelingDuration: CommaNumberSchema.optional(),

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
    BolusCutOffDelayTime: CommaNumberSchema.optional(),
    BolusCutOffTechnique: z.enum(["Q2TIPS", "QUIPSS", "QUIPSSII"]).optional(),

    // === Recommended ===
    BackgroundSuppression: z.boolean().optional(),
    BackgroundSuppressionNumberPulses: z.number().optional(),
    BackgroundSuppressionPulseTime: CommaArraySchema.optional(),
    VascularCrushing: z.boolean().optional(),
    
    RepetitionTimePreparation: z.number().optional(),
    FlipAngle: CommaNumberSchema.optional(),
    SliceTiming: CommaArraySchema.optional(),

    PulseSequenceType: z.enum(["spiral", "GRASE", "EPI"]).optional(),
    Manufacturer: z.enum(["GE_product", "Philips", "Siemens"]).optional(),

    // === M0 ===
    M0Type: z
      .enum(["separate", "integrated", "absent", "estimate"])
      .optional(),
    M0_GMScaleFactor: z.number().positive().optional(),

    // === ExploreASL-specific ===
    ASLContext: z
      .string()
      .refine(
        (val) => {
          if (!val) return false;
          const tokens = val.split(",").map((t) => t.trim()).filter(Boolean);
          const valid = new Set(["control", "label", "m0scan", "deltam"]);
          return tokens.length > 0 && tokens.every((t) => valid.has(t));
        },
        { message: "Must contain comma-separated values from: control, label, m0scan, deltam" },
      )
      .optional(),
    DatasetType: z.string().optional(),
    LabelingType: z.enum(["PASL", "CASL"]).optional(),
    DummyScanPositionInASL4D: CommaArraySchema.optional(),
    RepetitionTimePreparationM0: CommaArraySchema.optional(),
  })
  .passthrough();

export const BidsAslMetadataSchema = BidsAslMetadataBaseSchema.superRefine(refineBidsMetadata);

export type BidsAslMetadata = z.infer<typeof BidsAslMetadataSchema>;

/**
 * A single entry in the StudyPars array.
 * The catch-all entry has no SubjectRegExp/SessionRegExp.
 * Override entries have exact-match regex from row selection.
 */
export const StudyParEntrySchema = BidsAslMetadataBaseSchema.extend({
  SubjectRegExp: z.string().optional(),
  VisitRegExp: z.string().optional(),
  SessionRegExp: z.string().optional(),
  RunRegExp: z.string().optional(),
}).superRefine(refineBidsMetadata);

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

/** Aggregated staging mapping for one path pattern */
export interface StagingMappingByPattern {
  /** Pattern signature this mapping belongs to */
  patternSignature: string;
  /** The path pattern */
  pattern: PathPattern;
  /** Token assignments for this pattern */
  assignments: TokenAssignment[];
  /** Staging entries for paths matching this pattern */
  entries: StagingEntry[];
}

/**
 * Validate a BidsAslMetadata object against BIDS / ExploreASL schema requirements and conditional rules.
 * Returns an array of user-friendly validation error messages.
 */
export function validateBidsMetadataGroup(params: BidsAslMetadata): string[] {
  const errors: string[] = [];

  // Required fields for all ASL
  if (!params.ArterialSpinLabelingType) {
    errors.push("Arterial Spin Labeling Type is required.");
  }
  if (params.PostLabelingDelay === undefined || params.PostLabelingDelay === null || (Array.isArray(params.PostLabelingDelay) && params.PostLabelingDelay.length === 0)) {
    errors.push("Post Labeling Delay is required.");
  }
  if (!params.MRAcquisitionType) {
    errors.push("MR Acquisition Type is required.");
  }
  if (params.MagneticFieldStrength === undefined || params.MagneticFieldStrength === null) {
    errors.push("Magnetic Field Strength is required.");
  }
  if (!params.Manufacturer) {
    errors.push("Manufacturer is required.");
  }
  if (!params.ASLContext) {
    errors.push("ASL Context is required.");
  }

  const aslContextTokens = params.ASLContext
    ? params.ASLContext.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const hasM0Scan = aslContextTokens.includes("m0scan");

  if (hasM0Scan) {
    if (params.M0Type && params.M0Type !== "integrated") {
      errors.push("M0 Type must be 'integrated' when ASL Context contains 'm0scan'.");
    }
  } else {
    if (!params.M0Type) {
      errors.push("M0 Type is required when ASL Context does not contain 'm0scan'.");
    }
    if (params.M0Type === "integrated") {
      errors.push("M0 Type cannot be 'integrated' when ASL Context does not contain 'm0scan'.");
    }
  }

  // Conditional rendering / validation rules
  const aslType = params.ArterialSpinLabelingType;
  if (aslType === "PCASL" || aslType === "CASL") {
    if (params.LabelingDuration === undefined || params.LabelingDuration === null || (Array.isArray(params.LabelingDuration) && params.LabelingDuration.length === 0)) {
      errors.push(`Labeling Duration is required for ${aslType}.`);
    }
  }

  if (aslType === "PASL") {
    if (params.BolusCutOffFlag) {
      if (params.BolusCutOffDelayTime === undefined || params.BolusCutOffDelayTime === null || (Array.isArray(params.BolusCutOffDelayTime) && params.BolusCutOffDelayTime.length === 0)) {
        errors.push("Bolus Cut Off Delay Time is required when Bolus Cut Off Flag is enabled.");
      }
      if (!params.BolusCutOffTechnique) {
        errors.push("Bolus Cut Off Technique is required when Bolus Cut Off Flag is enabled.");
      }
    }
  }

  if (params.BackgroundSuppression) {
    if (params.BackgroundSuppressionNumberPulses === undefined || params.BackgroundSuppressionNumberPulses === null) {
      errors.push("Background Suppression Number Pulses is required when Background Suppression is enabled.");
    }
  }

  if (params.MRAcquisitionType === "2D") {
    if (!params.SliceTiming || params.SliceTiming.length === 0) {
      errors.push("Slice Timing is required when MR Acquisition Type is 2D.");
    }
  }

  // PostLabelingDelay & BolusCutOffDelayTime relation checks
  const pld = params.PostLabelingDelay;
  const bcd = params.BolusCutOffDelayTime;
  if (pld !== undefined && pld !== null && bcd !== undefined && bcd !== null) {
    const pldArray = Array.isArray(pld) ? pld : [pld];
    const bcdArray = Array.isArray(bcd) ? bcd : [bcd];
    if (pldArray.length > 1 || bcdArray.length > 1) {
      if (pldArray.length !== bcdArray.length) {
        errors.push("Post Labeling Delay and Bolus Cut Off Delay Time must have the same number of elements.");
      } else {
        for (let i = 0; i < pldArray.length; i++) {
          if ((pldArray[i] === 0) !== (bcdArray[i] === 0)) {
            errors.push("Zeros in Post Labeling Delay and Bolus Cut Off Delay Time must be at the same positions.");
            break;
          }
        }
      }
    }
  }

  return errors;
}

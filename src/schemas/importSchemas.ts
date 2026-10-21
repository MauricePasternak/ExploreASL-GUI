import { z } from "zod";
import {
  parseCommaSeparatedNumbers,
  parseNumberOrArray,
} from "../components/import/metadataFormUtils";
import { normalizePulseSequenceType, normalizeManufacturer } from "../lib/bids/normalize";
import { componentValidationMessage } from "../lib/stagingValidation";

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
  z.custom<number | number[]>(
    (val) => {
      return (
        typeof val === "number" ||
        (Array.isArray(val) && val.every((item) => typeof item === "number" && !Number.isNaN(item)))
      );
    },
    {
      message: "Invalid number or list of numbers",
    },
  ),
);

const CommaArraySchema = z.preprocess(
  preprocessCommaArray,
  z.custom<number[]>(
    (val) => {
      return (
        Array.isArray(val) && val.every((item) => typeof item === "number" && !Number.isNaN(item))
      );
    },
    {
      message: "Invalid list of numbers",
    },
  ),
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
const TokenTagSchema = z.enum(TOKEN_TAGS);
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

// =============================================================================
// Step 3: Alias Resolution
// =============================================================================

/** ExploreASL modality names */
export const EXPLOREASL_MODALITIES = ["T1w", "T2w", "ASL4D", "M0", "FLAIR", "WMH_SEGM"] as const;

export const PortableStagingComponentSchema = z.string().superRefine((value, ctx) => {
  const message = componentValidationMessage(value);
  if (message) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

export const StagingSubjectSchema = PortableStagingComponentSchema.refine(
  (value) => /^[A-Za-z0-9]+$/.test(value) && !value.startsWith("sub-"),
  "Subject must be ASCII alphanumeric and must not include the sub- prefix.",
);

export const StagingModalitySchema = z.enum(EXPLOREASL_MODALITIES);

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

export type { SubjectRename } from "../generated/project/SubjectRename";

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
  if (
    data.PostLabelingDelay === undefined ||
    data.PostLabelingDelay === null ||
    (Array.isArray(data.PostLabelingDelay) && data.PostLabelingDelay.length === 0)
  ) {
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
  if (data.BackgroundSuppression === undefined || data.BackgroundSuppression === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Background Suppression is required",
      path: ["BackgroundSuppression"],
    });
  }

  const aslContextTokens = data.ASLContext
    ? data.ASLContext.split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const hasM0Scan = aslContextTokens.includes("m0scan");

  if (hasM0Scan) {
    if (data.M0Type && data.M0Type !== "Included") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "M0 Type must be 'Included' when ASL Context contains 'm0scan'",
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
    if (data.M0Type === "Included") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "M0 Type cannot be 'Included' when ASL Context does not contain 'm0scan'",
        path: ["M0Type"],
      });
    }
  }

  // Conditional validations
  const aslType = data.ArterialSpinLabelingType;
  if (aslType === "PCASL" || aslType === "CASL") {
    if (
      data.LabelingDuration === undefined ||
      data.LabelingDuration === null ||
      (Array.isArray(data.LabelingDuration) && data.LabelingDuration.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Labeling Duration is required for ${aslType}`,
        path: ["LabelingDuration"],
      });
    }
  }

  if (aslType === "PASL") {
    if (data.BolusCutOffFlag) {
      if (
        data.BolusCutOffDelayTime === undefined ||
        data.BolusCutOffDelayTime === null ||
        (Array.isArray(data.BolusCutOffDelayTime) && data.BolusCutOffDelayTime.length === 0)
      ) {
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

  if (data.MRAcquisitionType === "2D") {
    if (!data.SliceTiming || data.SliceTiming.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Slice Timing is required when MR Acquisition Type is 2D",
        path: ["SliceTiming"],
      });
    }
  }

  const bcd = data.BolusCutOffDelayTime;

  if (bcd !== undefined && bcd !== null) {
    const bcdArray = Array.isArray(bcd) ? bcd : [bcd];
    if (bcdArray.some((value) => !Number.isFinite(value) || value < 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bolus Cut Off Delay Time values must be finite, non-negative numbers",
        path: ["BolusCutOffDelayTime"],
      });
    } else if (bcdArray.some((value, index) => index > 0 && value < bcdArray[index - 1])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bolus Cut Off Delay Time values must be monotonically increasing",
        path: ["BolusCutOffDelayTime"],
      });
    }
  }

  // Background Suppression validations
  const bgSuppression = data.BackgroundSuppression;
  const bgPulses = data.BackgroundSuppressionNumberPulses;
  const bgTimes = data.BackgroundSuppressionPulseTime;

  if (bgSuppression === true && bgPulses !== undefined && bgPulses <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Background Suppression Number Pulses must be greater than 0 when Background Suppression is enabled",
      path: ["BackgroundSuppressionNumberPulses"],
    });
  }

  if ((bgSuppression === false || bgPulses === 0) && bgTimes !== undefined && bgTimes.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Background Suppression Pulse Time should not be set when Background Suppression is disabled or Number of Pulses is 0",
      path: ["BackgroundSuppressionPulseTime"],
    });
  }

  if (bgPulses !== undefined && bgPulses > 0 && bgTimes !== undefined && bgTimes.length > 0) {
    if (bgTimes.length !== bgPulses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Background Suppression Pulse Time count (${bgTimes.length}) must match Background Suppression Number Pulses (${bgPulses})`,
        path: ["BackgroundSuppressionPulseTime"],
      });
    }
  }

  if (bgTimes !== undefined && bgTimes.length > 0) {
    for (const v of bgTimes) {
      if (typeof v === "number" && !Number.isNaN(v) && v <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Background Suppression Pulse Time values must be positive numbers",
          path: ["BackgroundSuppressionPulseTime"],
        });
        break;
      }
    }
  }

  const validateRange = (val: unknown, fieldName: string, label: string) => {
    if (val === undefined || val === null) return;
    const arr = Array.isArray(val) ? val : [val];
    for (const v of arr) {
      if (typeof v === "number" && !Number.isNaN(v)) {
        if (v !== 0 && (v < 0.01 || v > 10)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${label} must be between 0.01 and 10 seconds`,
            path: [fieldName],
          });
          break;
        }
      }
    }
  };

  validateRange(data.PostLabelingDelay, "PostLabelingDelay", "Post Labeling Delay");
  validateRange(data.BolusCutOffDelayTime, "BolusCutOffDelayTime", "Bolus Cut Off Delay Time");
  validateRange(data.LabelingDuration, "LabelingDuration", "Labeling Duration");

  // Validate supported PulseSequenceType + MRAcquisitionType combinations
  const unsupportedCombo =
    (data.PulseSequenceType === "EPI" && data.MRAcquisitionType === "3D") ||
    (data.PulseSequenceType === "GRASE" && data.MRAcquisitionType === "2D") ||
    (data.PulseSequenceType === "spiral" && data.MRAcquisitionType === "2D");

  if (unsupportedCombo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${data.PulseSequenceType} readout with ${data.MRAcquisitionType} acquisition is not supported by ExploreASL.`,
      path: ["PulseSequenceType"],
    });
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
    TotalAcquiredPairs: z.number().int().positive().optional(),

    RepetitionTimePreparation: z.number().optional(),
    FlipAngle: CommaNumberSchema.optional(),
    SliceTiming: CommaArraySchema.optional(),

    PulseSequenceType: z
      .string()
      .transform((val) => normalizePulseSequenceType(val))
      .optional(),
    Manufacturer: z
      .string()
      .transform((val) => normalizeManufacturer(val))
      .optional(),

    // === M0 ===
    M0Type: z.enum(["Separate", "Included", "Absent", "Estimate"]).optional(),
    M0_GMScaleFactor: z.number().positive().optional(),

    // === ExploreASL-specific ===
    // `.nullish()` (not `.optional()`) so legacy sidecars that ship
    // `ASLContext: null` at top level are accepted rather than dropped via
    // `skipped` (Phase 11 / RI2 fix).
    ASLContext: z
      .string()
      .refine(
        (val) => {
          if (!val) return false;
          const tokens = val
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          const valid = new Set(["control", "label", "m0scan", "deltam"]);
          return tokens.length > 0 && tokens.every((t) => valid.has(t));
        },
        { message: "Must contain comma-separated values from: control, label, m0scan, deltam" },
      )
      .nullish(),
    DatasetType: z.string().optional(),
    LabelingType: z.enum(["PASL", "CASL", "PCASL"]).optional(),
    DummyScanPositionInASL4D: CommaArraySchema.optional(),
    RepetitionTimePreparationM0: CommaArraySchema.optional(),
  })
  .passthrough();

export const BidsAslMetadataSchema = BidsAslMetadataBaseSchema.superRefine(refineBidsMetadata);

export type BidsAslMetadata = z.infer<typeof BidsAslMetadataSchema>;

/**
 * A single entry in the StudyPars array.
 * Every entry has explicit SubjectRegExp and VisitRegExp derived
 * from subjectRows group assignments.
 */
export const StudyParEntrySchema = BidsAslMetadataBaseSchema.extend({
  SubjectRegExp: z.string().optional(),
  VisitRegExp: z.string().optional(),
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
 * tokenVisitAliases is a flat array of alternating [folderName, folderName]
 * pairs (simple 1-to-1 mapping, no regex anchors) for backwards compatibility
 * with ExploreASL v1.11.0.
 */
export const SourcestructureJsonSchema = z.object({
  folderHierarchy: z.array(z.string()).length(4),
  tokenOrdering: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  tokenSessionAliases: z.array(z.string()),
  tokenVisitAliases: z.array(z.string()).optional(),
  tokenScanAliases: z.array(z.string()),
  bMatchDirectories: z.boolean(),
  dcm2nii_version: z.string().optional(),
});

export type SourcestructureJson = z.infer<typeof SourcestructureJsonSchema>;

// =============================================================================
// Import Progress Tracking
// =============================================================================

export const IMPORT_STEPS = ["DCM2NII", "NII2BIDS"] as const;
const IMPORT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const IMPORT_EXECUTION_PHASES = [
  "idle",
  "preparing",
  "running",
  "finalizing",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "interrupted",
] as const;

export const ImportLifecycleSchema = z.enum([
  "idle",
  "preparing",
  "running",
  "finalizing",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "interrupted",
]);
export type ImportLifecycle = z.infer<typeof ImportLifecycleSchema>;

export const ImportStructuredErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    subject: z.string().min(1).optional(),
    stagingIssues: z
      .array(
        z
          .object({
            code: z.string().min(1),
            field: z.enum([
              "subject",
              "session",
              "run",
              "runAlias",
              "modality",
              "sourcePath",
              "destination",
            ]),
            entryIndex: z.number().int().nonnegative().optional(),
            conflictingEntryIndex: z.number().int().nonnegative().optional(),
            message: z.string().min(1),
            suggestion: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const ImportExitEvidenceSchema = z
  .object({ exitCode: z.number().int(), successful: z.boolean() })
  .strict();
export const ImportSubjectOutcomeSchema = z
  .object({
    subject: z.string().min(1),
    outcome: z.enum(["verified", "committed", "failed", "cancelled", "interrupted"]),
    readyLockVerified: z.boolean(),
    rawdataVerified: z.boolean(),
    committed: z.boolean(),
    error: ImportStructuredErrorSchema.optional(),
  })
  .strict();
export const ImportRelocationSubjectSchema = z
  .object({
    subject: z.string(),
    status: z.enum(["committed", "rolledBack", "recoveryRequired"]),
    phase: z.string(),
    message: z.string().nullable(),
  })
  .strict();
export const ImportRelocationOutcomeSchema = z
  .object({
    planId: z.string(),
    generation: z.number().int().nonnegative(),
    subjects: z.array(ImportRelocationSubjectSchema),
    stagingCleanupComplete: z.boolean(),
  })
  .strict();
export const ImportRunSnapshotSchema = z
  .object({
    runId: z.string().min(1),
    lifecycle: ImportLifecycleSchema.exclude(["idle"]),
    ownershipGeneration: z.number().int().nonnegative(),
    profileId: z.string(),
    selectedSubjects: z.array(z.string().min(1)),
    createdAtMs: z.number().nonnegative(),
    updatedAtMs: z.number().nonnegative(),
    exitEvidence: ImportExitEvidenceSchema.optional(),
    subjectOutcomes: z.array(ImportSubjectOutcomeSchema),
    relocationOutcome: ImportRelocationOutcomeSchema.optional(),
    error: ImportStructuredErrorSchema.optional(),
    terminalResult: z.enum(["completed", "failed", "cancelled", "interrupted"]).optional(),
    /** Released records omit this field; interrupted recovery requires it. */
    confirmationRequired: z.boolean().default(false),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(
      snapshot.lifecycle,
    );
    if (terminal !== (snapshot.terminalResult !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["terminalResult"],
        message: "Terminal lifecycle and terminalResult must appear together.",
      });
    }
    if (snapshot.terminalResult && snapshot.terminalResult !== snapshot.lifecycle) {
      context.addIssue({
        code: "custom",
        path: ["terminalResult"],
        message: "terminalResult must match lifecycle.",
      });
    }
    const selected = new Set(snapshot.selectedSubjects.map((subject) => subject.toLowerCase()));
    const outcomes = new Set<string>();
    for (const outcome of snapshot.subjectOutcomes) {
      const key = outcome.subject.toLowerCase();
      if (!selected.has(key) || outcomes.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["subjectOutcomes"],
          message: "Subject outcomes must be unique and within selectedSubjects.",
        });
      }
      outcomes.add(key);
      if (outcome.committed !== (outcome.outcome === "committed")) {
        context.addIssue({
          code: "custom",
          path: ["subjectOutcomes"],
          message: "Committed flag and outcome disagree.",
        });
      }
    }
  });
export type ImportRunSnapshot = z.infer<typeof ImportRunSnapshotSchema>;

export const ImportProgressSchema = z.object({
  subject: z.string(),
  session: z.string(),
  status: z.enum(IMPORT_STATUSES),
  currentStep: z.enum(IMPORT_STEPS).optional(),
  errorStep: z.enum(IMPORT_STEPS).optional(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  duration: z.number().optional(),
  stale: z.boolean().optional(),
});

export type ImportProgress = z.infer<typeof ImportProgressSchema>;

// =============================================================================
// Metadata Grouping
// =============================================================================

export const MetadataGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  bidsParams: BidsAslMetadataBaseSchema,
});

export type { MetadataGroup } from "../generated/project/MetadataGroup";

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

export type { SubjectRow } from "../generated/project/SubjectRow";

export type { ImportSnapshot } from "../generated/project/ImportSnapshot";

// =============================================================================
// Staging Entry (for symlink tree creation)
// =============================================================================

/** Maps a raw DICOM path to the normalized 4-level staging path */
export const StagingEntrySchema = z.object({
  subject: StagingSubjectSchema,
  session: PortableStagingComponentSchema,
  run: PortableStagingComponentSchema,
  runAlias: PortableStagingComponentSchema,
  modality: StagingModalitySchema,
  /** Original logical tokens used for collision and one-to-one mapping checks. */
  originalSubject: z.string().min(1),
  originalSession: z.string().min(1),
  originalRun: z.string().min(1),
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

export function validateBidsMetadataGroup(params: BidsAslMetadata): string[] {
  const result = BidsAslMetadataSchema.safeParse(params);
  if (result.success) {
    return [];
  }

  const errors = new Set<string>();
  for (const issue of result.error.issues) {
    let msg = issue.message;

    // Add trailing period if missing to match formatting expectations
    if (!msg.endsWith(".")) {
      msg += ".";
    }
    errors.add(msg);
  }

  return Array.from(errors);
}

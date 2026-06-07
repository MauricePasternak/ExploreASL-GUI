import type { BidsAslMetadata } from "../../schemas/importSchemas";

/**
 * How a studyPar field should be interpreted in the metadata modal.
 *
 * - important: ASL / ExploreASL defaults the pipeline expects in studyPar when headers are incomplete
 * - dicomLikely: usually present in DICOM; GUI override only — omitted from studyPar.json when blank
 * - optionalOmitted: fully optional — omitted from studyPar.json when blank
 * - conditionalRecommended: recommended when the parent condition applies — omitted when blank
 */
export type MetadataFieldHint =
  | "important"
  | "dicomLikely"
  | "optionalOmitted"
  | "conditionalRecommended";

export const METADATA_FIELD_HINT_TEXT: Record<MetadataFieldHint, string> = {
  important: "Important for ExploreASL — set when headers are incomplete",
  dicomLikely: "Usually from DICOM — override only; omitted from studyPar.json if blank",
  optionalOmitted: "Optional — omitted from studyPar.json if blank",
  conditionalRecommended:
    "Recommended when applicable — omitted from studyPar.json if blank",
};

export const METADATA_HINT_LEGEND = [
  { hint: "important" as const, label: "Important" },
  { hint: "dicomLikely" as const, label: "Usually from DICOM" },
  { hint: "optionalOmitted" as const, label: "Optional" },
] as const;

/** Per-field hint for bidsParams keys shown in the metadata modal. */
export const BIDS_FIELD_HINTS: Partial<
  Record<keyof BidsAslMetadata, MetadataFieldHint>
> = {
  // ASL / M0 context
  ASLContext: "important",
  M0Type: "important",
  M0_GMScaleFactor: "optionalOmitted",
  DummyScanPositionInASL4D: "optionalOmitted",
  RepetitionTimePreparationM0: "optionalOmitted",

  // Vendor & sequence
  Manufacturer: "important",
  PulseSequenceType: "optionalOmitted",
  MRAcquisitionType: "important",
  MagneticFieldStrength: "dicomLikely",
  EchoTime: "dicomLikely",
  RepetitionTimePreparation: "dicomLikely",
  FlipAngle: "dicomLikely",

  // Core ASL
  ArterialSpinLabelingType: "important",
  PostLabelingDelay: "important",
  LabelingDuration: "important",
  PCASLType: "conditionalRecommended",
  CASLType: "conditionalRecommended",
  BolusCutOffFlag: "conditionalRecommended",
  BolusCutOffDelayTime: "conditionalRecommended",
  BolusCutOffTechnique: "optionalOmitted",
  BackgroundSuppression: "conditionalRecommended",
  BackgroundSuppressionNumberPulses: "conditionalRecommended",
  BackgroundSuppressionPulseTime: "conditionalRecommended",
  VascularCrushing: "optionalOmitted",
  SliceTiming: "conditionalRecommended",
};

function isEmptyBidsValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

/** Remove empty optional values before persisting to studyPar.json. */
export function stripEmptyBidsParams(params: BidsAslMetadata): BidsAslMetadata {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => !isEmptyBidsValue(value)),
  ) as BidsAslMetadata;
}

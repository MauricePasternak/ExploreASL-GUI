import {
  ManifestVerdictSchema,
  MANIFEST_FAIL_REASONS,
  ReviewerSchema,
  type ManifestFailReason,
  type Reviewer,
} from "./project";

export { ManifestVerdictSchema, MANIFEST_FAIL_REASONS, ReviewerSchema };
export type { ManifestFailReason, Reviewer };

export const MAX_REVIEWERS = 5;
export type ReviewerMode = "single" | "multi";

export const DISPLAY_VERDICTS = ["neutral", "pass", "fail", "no-info", "stale"] as const;
export type DisplayVerdict = (typeof DISPLAY_VERDICTS)[number];

export const FAIL_REASON_LABELS: Record<ManifestFailReason, string> = {
  motion: "Motion",
  coverage: "Coverage",
  dropout: "Signal Dropout",
  artifact: "Artifact",
  registration: "Registration",
  other: "Other",
};

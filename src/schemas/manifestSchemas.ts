import { ManifestVerdictSchema, MANIFEST_FAIL_REASONS, type ManifestFailReason } from "./project";

export { ManifestVerdictSchema, MANIFEST_FAIL_REASONS };
export type { ManifestFailReason };

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

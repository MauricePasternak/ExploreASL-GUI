import { validateBidsMetadataGroup } from "../../schemas/importSchemas";
import type { BidsAslMetadata } from "../../schemas/importSchemas";
import { normalizeManufacturer, normalizePulseSequenceType } from "./normalize";

/**
 * The 15 fingerprint fields per design D24.
 * ASLContext is display-only (D7) — NOT in fingerprint.
 */
const FINGERPRINT_FIELDS = [
  "ArterialSpinLabelingType",
  "PostLabelingDelay",
  "MRAcquisitionType",
  "MagneticFieldStrength",
  "Manufacturer",
  "ManufacturersModelName",
  "M0Type",
  "BackgroundSuppression",
  "BolusCutOffDelayTime",
  "BolusCutOffTechnique",
  "LabelingDuration",
  "BackgroundSuppressionNumberPulses",
  "RepetitionTimePreparation",
  "PulseSequenceType",
  "EchoTime",
] as const;

/**
 * Run-length encode an ASLContext string.
 * Adjacent identical tokens are merged into "{token}×{count}" entries.
 * Non-adjacent identical tokens remain separate.
 */
export function summarizeAslContext(raw: string | undefined): string {
  if (!raw) return "";
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "";

  const runs: { token: string; count: number }[] = [];
  for (const token of tokens) {
    const last = runs[runs.length - 1];
    if (last && last.token === token) {
      last.count++;
    } else {
      runs.push({ token, count: 1 });
    }
  }

  return runs.map((r) => `${r.token}\u00D7${r.count}`).join(", ");
}

/**
 * Split a comma-separated ASLContext string into trimmed, non-empty tokens.
 */
export function parseAslContext(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Thin wrapper around validateBidsMetadataGroup from importSchemas.
 * Returns an array of user-friendly validation error messages.
 */
export function validateBidsAslParams(params: BidsAslMetadata): string[] {
  return validateBidsMetadataGroup(params);
}

/**
 * Extract the 15 fingerprint fields (D24) from BidsAslMetadata.
 *
 * **Display/debug only.** Rust `extract_fingerprint` owns canonical hashing
 * (number/array normalization, Manufacturer/PulseSequenceType transforms).
 */
export function extractFingerprint(params: BidsAslMetadata): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of FINGERPRINT_FIELDS) {
    const val = (params as Record<string, unknown>)[field];
    if (val !== undefined && val !== null) {
      result[field] = val;
    }
  }
  return result;
}

/**
 * Derive injected fields for local display experiments only.
 *
 * **Do not use for Rust-sourced groups** — display `vendor`, `sequence`, and
 * `labelingType` from the `SidecarGroup` payload directly.
 */
export function deriveInjectedFields(params: BidsAslMetadata & { acq?: string }): {
  vendor?: string;
  sequence?: string;
  labelingType?: string;
} {
  // Vendor
  const vendor = params.Manufacturer ? normalizeManufacturer(params.Manufacturer) : undefined;

  // Sequence: acq_pulse, with fallbacks
  const pulse = params.PulseSequenceType
    ? normalizePulseSequenceType(params.PulseSequenceType)
    : undefined;
  let sequence: string | undefined;
  if (params.acq && pulse) {
    sequence = `${params.acq}_${pulse}`;
  } else if (pulse) {
    sequence = pulse;
  } else if (params.acq) {
    sequence = params.acq;
  } else {
    sequence = "UnknownSequence";
  }

  // LabelingType
  let labelingType: string | undefined;
  if (params.ArterialSpinLabelingType === "PCASL") {
    labelingType = "PCASL";
  } else if (params.ArterialSpinLabelingType === "CASL") {
    labelingType = "CASL";
  } else if (params.ArterialSpinLabelingType === "PASL") {
    labelingType = "PASL";
  }

  return { vendor, sequence, labelingType };
}

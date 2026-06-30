// ---------------------------------------------------------------------------
// Flag coercion helpers — for schema fields typed as `0 | 1` literal union.
//
// If ExploreASL ever standardizes these to booleans, update only this file
// (and the schema) — all consumers use fromFlag/toFlag and stay consistent.
// ---------------------------------------------------------------------------

import type { DataParState } from "../schemas/dataParSchema";

/** Fields in DataParSchema typed as `z.union([z.literal(0), z.literal(1)])`. */
export const FLAG_FIELDS: ReadonlySet<keyof DataParState> = new Set<keyof DataParState>([
  "bRegisterM02ASL",
  "M0_conventionalProcessing",
  "Quality",
  "DELETETEMP",
  "SkipIfNoFlair",
  "SkipIfNoASL",
  "SkipIfNoM0",
  "motionCorrection",
  "bPVCNativeSpace",
  "bPVCGaussianMM",
  "bUseMNIasDummyStructural",
  "bRunLongReg",
  "bRunDARTEL",
  "bSegmentSPM12",
  "bHammersCAT12",
]);

/** Coerce a boolean (or undefined) to the `0 | 1` literal required by the schema. */
export function toFlag(v: boolean | 0 | 1 | undefined): 0 | 1 {
  return v === true || v === 1 ? 1 : 0;
}

/** Coerce a `0 | 1 | boolean | undefined` to a boolean for UI controls. */
export function fromFlag(v: unknown, defaultValue: boolean = false): boolean {
  if (v === undefined) return defaultValue;
  return v === true || v === 1;
}

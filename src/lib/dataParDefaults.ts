import type { DataParState } from "../schemas/dataParSchema";
import { FIELD_METADATA } from "./dataParFieldMetadata";

/**
 * Build a complete DataParState from FIELD_METADATA defaults.
 *
 * Used by manifest generation to produce a complete config (user state merged
 * on top of defaults) for accurate methods paragraph generation.
 */
export function getDefaultDataPar(): DataParState {
  const defaults: Record<string, unknown> = {};
  for (const [key, meta] of Object.entries(FIELD_METADATA)) {
    if (meta.default !== undefined) {
      defaults[key] = meta.default;
    }
  }
  return defaults as DataParState;
}

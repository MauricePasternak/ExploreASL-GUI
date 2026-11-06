import type { DataParState } from "../schemas/dataParSchema";
import { FIELD_METADATA } from "./dataParFieldMetadata";
import { PARAMETER_SWITCH_DEFAULTS } from "../generated/bindings";

export const SWITCH_CONFIRMATION_GUIDANCE =
  "Review and confirm the proposed explicit switch choices in Parameters before processing.";

export function hasMissingParameterSwitches(state: DataParState | undefined): boolean {
  return Object.keys(PARAMETER_SWITCH_DEFAULTS).some((key) => state?.[key] === undefined);
}

/**
 * Build a synthetic complete DataParState for Methods examples.
 *
 * Never used to populate accepted project settings or processing requests.
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

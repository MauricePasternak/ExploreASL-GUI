import { commands, unwrap } from "./ipc";
import { z } from "zod";

import type { StagingEntry } from "../schemas/importSchemas";
import type { ImportPlan } from "./importPlan";
import { STAGING_FIELDS, type StagingValidationIssue } from "./stagingValidation";

export const StagingValidationIssueSchema = z.object({
  code: z.string(),
  field: z.enum(STAGING_FIELDS),
  entryIndex: z.number().int().nonnegative().optional(),
  conflictingEntryIndex: z.number().int().nonnegative().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
});

export const StagingPreflightResponseSchema = z.object({
  valid: z.boolean(),
  issues: z.array(StagingValidationIssueSchema),
});

export type StagingPreflightResponse = { valid: boolean; issues: StagingValidationIssue[] };

export async function preflightStagingPlan(
  stagingEntries: StagingEntry[],
): Promise<StagingPreflightResponse> {
  const response = await unwrap(commands.preflightStagingPlan(stagingEntries));
  return StagingPreflightResponseSchema.parse(response);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic non-cryptographic identity. It only invalidates stale session state. */
export function fingerprintImportPlan(projectRoot: string, plan: ImportPlan): string {
  let hash = 0x811c9dc5;
  const text = stable({ projectRoot, ...plan.fingerprintInput, entries: plan.entries });
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `staging-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

import type { ImportState } from "../stores/importStore";
import type { TokenAssignment, TokenTag } from "../schemas/importSchemas";

/** Step 0 complete: scan finished with at least one path pattern. */
export function isIngestionComplete(
  state: Pick<ImportState, "ingestionComplete" | "pathPatterns">,
): boolean {
  return state.ingestionComplete && state.pathPatterns.length > 0;
}

/** Step 1 complete: every pattern has Subject and Modality tags. */
export function isTokenizerComplete(
  state: Pick<ImportState, "ingestionComplete" | "pathPatterns" | "tokenizerConfigs">,
): boolean {
  if (!isIngestionComplete(state)) {
    return false;
  }

  return state.pathPatterns.every((pattern) => {
    const assignments = state.tokenizerConfigs[pattern.signature] ?? [];
    const hasSubject = assignments.some((assignment) => assignment.tag === "Subject");
    const hasModality = assignments.some((assignment) => assignment.tag === "Modality");
    return hasSubject && hasModality;
  });
}

export function hasTokenizerTag(
  tokenizerConfigs: Record<string, TokenAssignment[]>,
  tag: TokenTag,
): boolean {
  return Object.values(tokenizerConfigs).some((assignments) =>
    assignments.some((assignment) => assignment.tag === tag),
  );
}

/** Step 2 complete: at least one core pipeline modality is mapped. */
export function isAliasResolutionComplete(
  state: Pick<ImportState, "modalityAliases">,
): boolean {
  return state.modalityAliases.some(
    (alias) => alias.mapped === "ASL4D" || alias.mapped === "T1w",
  );
}

/**
 * Highest import wizard step index the user may jump to via the stepper.
 * Mirrors the gates on each step's "Next" button.
 */
export function getMaxUnlockedImportStep(
  state: Pick<
    ImportState,
    "ingestionComplete" | "pathPatterns" | "tokenizerConfigs" | "modalityAliases"
  >,
): number {
  if (!isIngestionComplete(state)) {
    return 0;
  }

  if (!isTokenizerComplete(state)) {
    return 1;
  }

  if (!isAliasResolutionComplete(state)) {
    return 2;
  }

  return 4;
}

export function canSelectImportStep(
  stepIndex: number,
  state: Pick<
    ImportState,
    "ingestionComplete" | "pathPatterns" | "tokenizerConfigs" | "modalityAliases"
  >,
): boolean {
  return stepIndex >= 0 && stepIndex <= getMaxUnlockedImportStep(state);
}

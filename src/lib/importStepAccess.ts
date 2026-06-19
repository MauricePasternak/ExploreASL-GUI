import type { ImportState } from "../stores/importStore";
import type { GlobalSettings } from "../schemas/globalSettings";
import type { TokenAssignment, TokenTag } from "../schemas/importSchemas";
import { SourcestructureJsonSchema, StudyParJsonSchema } from "../schemas/importSchemas";
import { assembleSourcestructure, assembleStudyPar } from "./tokenizerUtils";

export const TOTAL_IMPORT_STEPS = 6;

type StepPrerequisiteState = Pick<
  ImportState,
  "ingestionComplete" | "pathPatterns" | "tokenizerConfigs" | "modalityAliases"
>;

type Step5State = StepPrerequisiteState &
  Partial<
    Pick<
      ImportState,
      "sessionAliases" | "runAliases" | "bMatchDirectories" | "metadataGroups" | "subjectRows"
    >
  >;

type ImportExecutionSettings = Pick<GlobalSettings, "matlabInstallations" | "exploreAslPath">;

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
export function isAliasResolutionComplete(state: Pick<ImportState, "modalityAliases">): boolean {
  return state.modalityAliases.some((alias) => alias.mapped === "ASL4D" || alias.mapped === "T1w");
}

/**
 * Highest import wizard step index the user may jump to via the stepper.
 * Mirrors the gates on each step's "Next" button.
 */
export function getMaxUnlockedImportStep(
  state: Step5State,
  settings?: ImportExecutionSettings,
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

  if (!settings || !canEnterStep5(state, settings)) {
    return 4;
  }

  return 5;
}

export function getMaxRestorableImportStep(state: Step5State): number {
  if (!isIngestionComplete(state)) {
    return 0;
  }

  if (!isTokenizerComplete(state)) {
    return 1;
  }

  if (!isAliasResolutionComplete(state)) {
    return 2;
  }

  if (!hasValidStep5ProjectPrerequisites(state)) {
    return 4;
  }

  return 5;
}

export function canSelectImportStep(
  stepIndex: number,
  state: Step5State,
  settings?: ImportExecutionSettings,
): boolean {
  return stepIndex >= 0 && stepIndex <= getMaxUnlockedImportStep(state, settings);
}

export function canEnterStep5(state: Step5State, settings: ImportExecutionSettings): boolean {
  if (
    !isIngestionComplete(state) ||
    !isTokenizerComplete(state) ||
    !isAliasResolutionComplete(state)
  ) {
    return false;
  }

  const matlabConfigured = settings.matlabInstallations.some(
    (installation) => installation.path.trim().length > 0,
  );
  const exploreAslConfigured = settings.exploreAslPath.trim().length > 0;

  if (!matlabConfigured || !exploreAslConfigured) {
    return false;
  }

  return hasValidStep5ProjectPrerequisites(state);
}

function hasValidStep5ProjectPrerequisites(state: Step5State): boolean {
  const sourcestructure = assembleSourcestructure(
    state.sessionAliases ?? [],
    state.runAliases ?? [],
    state.modalityAliases,
    state.bMatchDirectories ?? true,
  );
  const studyPar = assembleStudyPar(state.metadataGroups ?? [], state.subjectRows ?? []);

  return (
    SourcestructureJsonSchema.safeParse(sourcestructure).success &&
    StudyParJsonSchema.safeParse(studyPar).success
  );
}

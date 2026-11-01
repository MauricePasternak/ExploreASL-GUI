import type { acceptedImportSettings } from "../stores/importStore";
import type { GlobalSettings } from "../schemas/globalSettings";
import type { TokenAssignment, TokenTag } from "../schemas/importSchemas";
import { SourcestructureJsonSchema, StudyParJsonSchema } from "../schemas/importSchemas";
import { assembleSourcestructure, assembleStudyPar } from "./tokenizerUtils";
import type { StagingPreflightState } from "../stores/importStore";

type ImportSettings = ReturnType<typeof acceptedImportSettings>;

type StepPrerequisiteState = Pick<
  ImportSettings,
  "ingestionComplete" | "pathPatterns" | "tokenizerConfigs" | "modalityAliases"
>;

type Step5State = StepPrerequisiteState &
  Partial<
    Pick<
      ImportSettings,
      "sessionAliases" | "runAliases" | "bMatchDirectories" | "metadataGroups" | "subjectRows"
    >
  >;

type ImportExecutionGate = {
  executionProfiles: GlobalSettings["executionProfiles"];
  profileValidationState: Record<string, { valid: boolean; errors: string[] }>;
};

export type StagingValidationGate = Pick<StagingPreflightState, "status" | "fingerprint"> & {
  currentFingerprint: string;
  localIssueCount: number;
};

export function hasValidExecutionProfile(gate: ImportExecutionGate): boolean {
  return gate.executionProfiles.some(
    (profile) => gate.profileValidationState[profile.id]?.valid === true,
  );
}

/** Step 0 complete: scan finished with at least one path pattern. */
export function isIngestionComplete(
  state: Pick<ImportSettings, "ingestionComplete" | "pathPatterns">,
): boolean {
  return state.ingestionComplete && state.pathPatterns.length > 0;
}

/** Step 1 complete: every pattern has Subject and Modality tags. */
export function isTokenizerComplete(
  state: Pick<ImportSettings, "ingestionComplete" | "pathPatterns" | "tokenizerConfigs">,
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
export function isAliasResolutionComplete(state: Pick<ImportSettings, "modalityAliases">): boolean {
  return state.modalityAliases.some((alias) => alias.mapped === "ASL4D" || alias.mapped === "T1w");
}

export function canEnterStep5(
  state: Step5State,
  gate: ImportExecutionGate,
  stagingGate: StagingValidationGate,
): boolean {
  if (
    !isIngestionComplete(state) ||
    !isTokenizerComplete(state) ||
    !isAliasResolutionComplete(state)
  ) {
    return false;
  }

  if (!hasValidExecutionProfile(gate)) {
    return false;
  }

  return (
    hasValidStep5ProjectPrerequisites(state) &&
    stagingGate.localIssueCount === 0 &&
    stagingGate.status === "valid" &&
    stagingGate.fingerprint === stagingGate.currentFingerprint
  );
}

function hasValidStep5ProjectPrerequisites(state: Step5State): boolean {
  const sourcestructure = assembleSourcestructure(
    state.sessionAliases ?? [],
    state.runAliases ?? [],
    state.modalityAliases,
    state.bMatchDirectories ?? true,
  );
  const studyPar = assembleStudyPar(
    state.metadataGroups ?? [],
    state.subjectRows ?? [],
    state.sessionAliases ?? [],
  );

  return (
    SourcestructureJsonSchema.safeParse(sourcestructure).success &&
    StudyParJsonSchema.safeParse(studyPar).success
  );
}

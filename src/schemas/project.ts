import type {
  ProjectDocument_Serialize as ProjectDocument,
  ProjectSnapshot_Serialize as ProjectSnapshot,
} from "../generated/bindings";

export type {
  ProjectPhase,
  Reviewer,
  Verdict_Serialize as ManifestVerdict,
  FailReason as ManifestFailReason,
  ManifestConfig_Serialize as ManifestUiState,
  ImportUiState_Serialize as ImportUiState,
} from "../generated/bindings";

export const PROJECT_FILE_NAME = "project.easl";
export const PROJECT_PHASES = [
  "import",
  "parameters",
  "processing",
  "visualization",
  "manifest",
] as const;
export const MANIFEST_FAIL_REASONS = [
  "motion",
  "coverage",
  "dropout",
  "artifact",
  "registration",
  "other",
] as const;

/** Display-only runtime fields. Persisted configuration comes from Rust. */
export type ProjectFile = Omit<ProjectDocument, "projectMeta"> &
  Omit<ProjectSnapshot, "document" | "rootPath"> & {
    projectMeta: ProjectDocument["projectMeta"] & { rootPath: string };
  };
export type ProjectMeta = ProjectFile["projectMeta"];

export function projectView(snapshot: ProjectSnapshot): ProjectFile {
  const { document, rootPath, ...runtime } = snapshot;
  return { ...document, ...runtime, projectMeta: { ...document.projectMeta, rootPath } };
}

export function canAccessPhase(
  project: ProjectFile,
  phase: (typeof PROJECT_PHASES)[number],
): boolean {
  return project.allowedPhases.includes(phase);
}

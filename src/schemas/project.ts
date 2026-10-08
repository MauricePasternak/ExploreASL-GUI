import type { ProjectDocument } from "../generated/project/ProjectDocument";
import type { ProjectSnapshot } from "../generated/project/ProjectSnapshot";

export type { ProjectPhase } from "../generated/project/ProjectPhase";
export type { Reviewer } from "../generated/project/Reviewer";
export type { Verdict as ManifestVerdict } from "../generated/project/Verdict";
export type { FailReason as ManifestFailReason } from "../generated/project/FailReason";
export type { ManifestConfig as ManifestUiState } from "../generated/project/ManifestConfig";
export type { ImportUiState } from "../generated/project/ImportUiState";

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

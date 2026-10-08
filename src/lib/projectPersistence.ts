import { invoke } from "@tauri-apps/api/core";
import type { ProjectSnapshot } from "../generated/project/ProjectSnapshot";
import type { ProjectInspection } from "../generated/project/ProjectInspection";
import type { ProjectEdit } from "../generated/project/ProjectEdit";
import type { RecentProject } from "../schemas/globalSettings";

export type ProjectStorageErrorCategory =
  | "invalid_serialization"
  | "permission_denied"
  | "insufficient_space"
  | "temporary_write"
  | "file_flush"
  | "backup"
  | "primary_replacement"
  | "durability_uncertain"
  | "recovery";

const PROJECT_STORAGE_ERROR_CATEGORIES: ReadonlySet<string> = new Set([
  "invalid_serialization",
  "permission_denied",
  "insufficient_space",
  "temporary_write",
  "file_flush",
  "backup",
  "primary_replacement",
  "durability_uncertain",
  "recovery",
]);

export class ProjectStorageError extends Error {
  constructor(
    readonly category: ProjectStorageErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "ProjectStorageError";
  }
}

export function projectStorageErrorMessage(error: ProjectStorageError) {
  switch (error.category) {
    case "permission_denied":
      return "Permission denied. Check access to the project directory and try again.";
    case "insufficient_space":
      return "Insufficient disk space. Free space on the project volume and try again.";
    case "invalid_serialization":
      return "Project data failed validation and was not written.";
    case "file_flush":
      return "Project data could not be flushed safely to disk. The previous file remains recoverable.";
    case "backup":
      return "The last-known-good project backup could not be preserved.";
    case "primary_replacement":
      return "The primary project file could not be replaced. The previous file or backup remains recoverable.";
    case "durability_uncertain":
      return "The project was replaced, but durable storage could not be confirmed. Save again before closing.";
    case "recovery":
      return "The project backup is missing, malformed, or unsupported and cannot be recovered.";
    case "temporary_write":
      return "The temporary project file could not be written. The previous project file was not replaced.";
  }
}

function storageError(error: unknown): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  if (typeof error === "string") {
    try {
      const parsed: unknown = JSON.parse(error);
      if (typeof parsed === "object" && parsed !== null) return storageError(parsed);
    } catch {
      // Native errors may be plain text rather than serialized objects.
    }
    return new ProjectStorageError("temporary_write", error);
  }
  if (typeof error === "object" && error !== null && "category" in error) {
    const { category, message } = error as { category: unknown; message?: unknown };
    if (typeof category === "string" && PROJECT_STORAGE_ERROR_CATEGORIES.has(category)) {
      return new ProjectStorageError(
        category as ProjectStorageErrorCategory,
        typeof message === "string" ? message : `Project write failed: ${category}`,
      );
    }
  }
  return new ProjectStorageError(
    "temporary_write",
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error),
  );
}

export async function projectRequest<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error && "message" in error) {
      throw Object.assign(new Error(String(error.message)), { cause: error });
    }
    throw storageError(error);
  }
}

export const inspectProject = (path: string, recents: RecentProject[] = []) =>
  projectRequest<ProjectInspection>("inspect_project", {
    path,
    recents: recents.map(({ path, projectId }) => ({ path, projectId: projectId ?? null })),
  });
export const activateProject = async (
  candidate: ProjectInspection,
  confirmBackup: boolean,
  copied = false,
) => {
  const candidateId = copied
    ? (
        await projectRequest<ProjectInspection>("copy_project_candidate", {
          candidateId: candidate.candidateId,
          confirmBackup,
        })
      ).candidateId
    : candidate.candidateId;
  return projectRequest<ProjectSnapshot>("activate_project", { candidateId, confirmBackup });
};
export const createNativeProject = (
  root: string,
  name: string,
  source: "dicom" | "bids",
  profileId: string,
) => projectRequest<ProjectInspection>("create_project", { root, name, source, profileId });
export const currentProjectSnapshot = () =>
  projectRequest<ProjectSnapshot | null>("current_project_snapshot");
export const readProjectSnapshot = (generation: number) =>
  projectRequest<ProjectSnapshot>("get_project_snapshot", { generation });
export const acceptProjectEdit = (generation: number, edit: ProjectEdit) =>
  projectRequest<ProjectSnapshot>("accept_project_edit", { generation, edit });
export const saveNativeProject = (generation: number) =>
  projectRequest<ProjectSnapshot>("save_project", { generation });

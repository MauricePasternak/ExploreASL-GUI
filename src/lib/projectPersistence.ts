import { invoke } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
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
      return "Some project settings could not be saved. Review your recent changes and try again. If the problem continues, report it with the application log.";
    case "file_flush":
      return "Your project could not be safely saved to disk. Check the drive connection and available space, then try Save again. The previous saved copy remains recoverable.";
    case "backup":
      return "The previous saved copy could not be backed up. Check access and free space in the project folder, then try Save again.";
    case "primary_replacement":
      return "The project file could not be updated. Check that it is not read-only or locked by another program, then try Save again. The previous file or backup remains recoverable.";
    case "durability_uncertain":
      return "Your project was written, but the application could not confirm it is safely stored. Check the drive connection, then try Save again before closing.";
    case "recovery":
      return "The project backup could not be opened because it is missing or invalid. Choose another project file or restore a working backup.";
    case "temporary_write":
      return "The project could not be saved. Check access and free space in the project folder, then try Save again. The previous saved file has not been replaced.";
  }
}

function storageError(error: unknown): ProjectStorageError | null {
  if (error instanceof ProjectStorageError) return error;
  if (typeof error === "string") {
    try {
      const parsed: unknown = JSON.parse(error);
      if (typeof parsed === "object" && parsed !== null) return storageError(parsed);
    } catch {
      // Native errors may be plain text rather than serialized objects.
    }
    return null;
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
  return null;
}

export async function projectRequest<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const diagnostic =
      error instanceof Error
        ? (error.stack ?? error.message)
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    // Log the original failure, not project arguments (which can contain study data).
    void logError(`[PROJECT] ${command} failed: ${diagnostic}`).catch(() => undefined);
    const storage = storageError(error);
    if (storage) {
      throw Object.assign(
        new ProjectStorageError(storage.category, projectStorageErrorMessage(storage)),
        { cause: error },
      );
    }
    // Structured native operation/validation errors already describe the required correction.
    if (typeof error === "object" && error !== null && "message" in error) {
      throw Object.assign(new Error(String(error.message)), { cause: error });
    }
    const message =
      command === "accept_project_edit"
        ? "Your project changes could not be applied. They have not been saved. Try the action again. If the problem continues, report it with the application log."
        : command === "save_project"
          ? "Your project could not be saved. Try Save again. If the problem continues, report it with the application log."
          : "The project action could not be completed. Try again. If the problem continues, report it with the application log.";
    throw Object.assign(new Error(message), { cause: error });
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

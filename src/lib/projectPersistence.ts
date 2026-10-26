import { commands } from "./ipc";
import { error as logError } from "@tauri-apps/plugin-log";
import type {
  ProjectInspection_Serialize as ProjectInspection,
  ProjectEdit_Deserialize as ProjectEdit,
  WriteErrorCategory,
} from "../generated/bindings";
import type { RecentProject } from "../schemas/globalSettings";

export type ProjectStorageErrorCategory = WriteErrorCategory;

const PROJECT_STORAGE_ERROR_CATEGORIES: ReadonlySet<string> = new Set<WriteErrorCategory>([
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

/** Command name is diagnostics only; generated operation owns its argument/result types. */
export async function projectRequest<T, E extends { message: string; details: string }>(
  command: string,
  operation: () => Promise<{ status: "ok"; data: T } | { status: "error"; error: E }>,
): Promise<T> {
  try {
    const result = await operation();
    if (result.status === "error") throw result.error;
    return result.data;
  } catch (failure) {
    const error = failure instanceof Error && "cause" in failure ? failure.cause : failure;
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
        typeof error === "object" && error !== null ? error : {},
        { message: projectStorageErrorMessage(storage), cause: error },
      );
    }
    // Structured native operation/validation errors already describe the required correction.
    if (typeof error === "object" && error !== null && "message" in error) {
      throw Object.assign(new Error(String(error.message)), error, { cause: error });
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
  projectRequest("inspect_project", () =>
    commands.inspectProject(
      path,
      recents.map(({ path, projectId }) => ({ path, projectId: projectId ?? null })),
    ),
  );
export const activateProject = async (
  candidate: ProjectInspection,
  confirmBackup: boolean,
  copied = false,
) => {
  const candidateId = copied
    ? (
        await projectRequest("copy_project_candidate", () =>
          commands.copyProjectCandidate(candidate.candidateId, confirmBackup),
        )
      ).candidateId
    : candidate.candidateId;
  return projectRequest("activate_project", () =>
    commands.activateProject(candidateId, confirmBackup),
  );
};
export const createNativeProject = (
  root: string,
  name: string,
  source: "dicom" | "bids",
  profileId: string,
) => projectRequest("create_project", () => commands.createProject(root, name, source, profileId));
export const currentProjectSnapshot = () =>
  projectRequest("current_project_snapshot", () => commands.currentProjectSnapshot());
export const readProjectSnapshot = (generation: number) =>
  projectRequest("get_project_snapshot", () => commands.getProjectSnapshot(generation));
export const acceptProjectEdit = (generation: number, edit: ProjectEdit) =>
  projectRequest("accept_project_edit", () => commands.acceptProjectEdit(generation, edit));
export const saveNativeProject = (generation: number) =>
  projectRequest("save_project", () => commands.saveProject(generation));

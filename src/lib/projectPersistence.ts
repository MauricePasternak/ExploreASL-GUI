import { invoke } from "@tauri-apps/api/core";

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

export type AtomicWriteProjectInput = {
  projectPath: string;
  canonicalBytes: string;
  preserveBackup: boolean;
};

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
  return new ProjectStorageError("temporary_write", String(error));
}

/** Commits already schema-validated canonical bytes through the native writer. */
export async function atomicWriteProject(input: AtomicWriteProjectInput): Promise<void> {
  try {
    await invoke("atomic_write_project", input);
  } catch (error) {
    throw storageError(error);
  }
}

export async function cleanupProjectTemps(projectPath: string): Promise<void> {
  await invoke("cleanup_project_temps", { projectPath });
}

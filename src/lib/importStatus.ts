import { invoke } from "@tauri-apps/api/core";

export interface ImportSubjectStatus {
  subject: string;
  status: "completed" | "failed";
}

export async function readImportStatus(
  projectRoot: string,
): Promise<ImportSubjectStatus[]> {
  return invoke<ImportSubjectStatus[]>("read_import_status", { projectRoot });
}
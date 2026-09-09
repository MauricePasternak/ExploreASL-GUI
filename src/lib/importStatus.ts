import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const ImportSubjectStatusSchema = z
  .object({ subject: z.string().min(1), status: z.enum(["completed", "failed"]) })
  .strict();

export type ImportSubjectStatus = z.infer<typeof ImportSubjectStatusSchema>;

/** Native active-project ownership derives the audit root. */
export async function readImportStatus(): Promise<ImportSubjectStatus[]> {
  const raw = await invoke("read_import_status");
  return raw == null ? [] : z.array(ImportSubjectStatusSchema).parse(raw);
}

import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export const LogFileInfoSchema = z.object({
  filename: z.string(),
  module: z.enum(["structural", "asl"]),
  subjectSession: z.string(),
  run: z.string().nullable().optional().transform(v => v ?? undefined),
  hasError: z.boolean(),
});

export const LogContentSchema = z.record(z.string(), z.string());

export type LogFileInfo = z.infer<typeof LogFileInfoSchema>;
export type LogContent = z.infer<typeof LogContentSchema>;

export async function fetchModuleLogs(projectRoot: string): Promise<LogFileInfo[]> {
  const raw = await invoke<unknown[]>("list_module_logs", { projectRoot });
  return raw.map((item) => LogFileInfoSchema.parse(item));
}

export async function fetchLogContent(
  projectRoot: string,
  subjectSession: string,
  module: "structural" | "asl",
): Promise<LogContent> {
  const raw = await invoke<Record<string, string>>("read_module_logs", {
    projectRoot,
    subjectSession,
    module,
  });
  return LogContentSchema.parse(raw);
}
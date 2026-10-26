import { z } from "zod";
import { commands, unwrap } from "./ipc";

export const LogFileInfoSchema = z.object({
  filename: z.string(),
  module: z.enum(["structural", "asl", "import", "population"]),
  subjectSession: z.string(),
  run: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  hasError: z.boolean(),
});

export type LogFileInfo = z.infer<typeof LogFileInfoSchema>;
export type LogContent = Record<string, string>;

/** ExploreASL import log filenames use a `sub-` prefix; GUI subject rows do not. */
export function importLogSubjectKey(subject: string): string {
  return subject.startsWith("sub-") ? subject : `sub-${subject}`;
}

export function importLogSubjectFromSession(subjectSession: string): string {
  return subjectSession.startsWith("sub-") ? subjectSession.slice(4) : subjectSession;
}

export async function fetchModuleLogs(projectRoot: string): Promise<LogFileInfo[]> {
  const raw = await unwrap(commands.listModuleLogs(projectRoot));
  return raw.map((item) => LogFileInfoSchema.parse(item));
}

export async function fetchLogContent(
  projectRoot: string,
  subjectSession: string,
  module: "structural" | "asl" | "import" | "population",
): Promise<LogContent> {
  return unwrap(commands.readModuleLogs(projectRoot, subjectSession, module));
}

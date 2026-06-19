import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export const ReportFileInfoSchema = z.object({
  module: z.enum(["structural", "asl", "m0"]),
  subjectSession: z.string(),
  run: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
});

export type ReportFileInfo = z.infer<typeof ReportFileInfoSchema>;

export async function fetchSubjectReports(projectRoot: string): Promise<ReportFileInfo[]> {
  const raw = await invoke<unknown[]>("list_subject_reports", { projectRoot });
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => ReportFileInfoSchema.parse(item));
}

export async function fetchReportImage(
  projectRoot: string,
  subjectSession: string,
  module: "structural" | "asl" | "m0",
  run: string | undefined,
  viewType: "axial" | "coronal",
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_report_image", {
    projectRoot,
    subjectSession,
    module,
    run: run ?? null,
    viewType,
  });
  return new Uint8Array(bytes);
}

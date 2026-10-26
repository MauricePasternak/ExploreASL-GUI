import { z } from "zod";
import type { QcMeasure } from "../generated/bindings";
import { commands, unwrap } from "./ipc";

export type { QcMeasure } from "../generated/bindings";

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
  const raw = await unwrap(commands.listSubjectReports(projectRoot));
  return raw.map((item) => ReportFileInfoSchema.parse(item));
}

export async function fetchReportImage(
  projectRoot: string,
  subjectSession: string,
  module: "structural" | "asl" | "m0",
  run: string | undefined,
  viewType: "axial" | "coronal",
): Promise<Uint8Array> {
  const bytes = await unwrap(
    commands.readReportImage(projectRoot, subjectSession, module, run ?? null, viewType),
  );
  return new Uint8Array(bytes);
}

export async function fetchSubjectQC(
  projectRoot: string,
  subjectSession: string,
  module: "structural" | "asl",
  run: string | undefined,
): Promise<QcMeasure[]> {
  return unwrap(commands.getSubjectSessionQc(projectRoot, subjectSession, module, run ?? null));
}

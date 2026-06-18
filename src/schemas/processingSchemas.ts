import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROCESSING_MODULES = ["structural", "asl", "population"] as const;
export const PROCESSING_PHASES = [
  "idle",
  "preparing",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const SUBJECT_MODULE_STATUSES = ["pending", "incomplete", "complete"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ProcessConfigSchema = z.object({
  subjects: z.array(z.string()),
  modules: z.array(z.enum(PROCESSING_MODULES)).min(1),
  matlabPath: z.string(),
  exploreAslPath: z.string(),
  workers: z.number().int().min(1),
  subjectRegexp: z.string(),
});

export const SubjectModuleStatusSchema = z.object({
  subjectSession: z.string().optional().default(""),
  module: z.enum(PROCESSING_MODULES),
  run: z.string().optional(),
  status: z.enum(SUBJECT_MODULE_STATUSES),
  completedSteps: z.array(z.string()),
  locked: z.boolean(),
});

export const ProcessingPhaseSchema = z.enum(PROCESSING_PHASES);

export const SubjectInfoSchema = z.object({
  subjectSession: z.string(),
  subject: z.string(),
  session: z.string(),
  hasStructural: z.boolean(),
  hasASL: z.boolean(),
  aslRuns: z.array(z.string()).optional().default([]),
});

export const LockFileEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("StatusFileCreated"),
    module: z.string(),
    subjectSession: z.string().optional(),
    stepCode: z.string(),
    run: z.string().optional(),
  }),
  z.object({
    type: z.literal("LockCreated"),
    module: z.string(),
    subjectSession: z.string().optional(),
    run: z.string().optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessConfig = z.infer<typeof ProcessConfigSchema>;
export type SubjectModuleStatus = z.infer<typeof SubjectModuleStatusSchema>;
export type ProcessingPhase = z.infer<typeof ProcessingPhaseSchema>;
export type SubjectInfo = z.infer<typeof SubjectInfoSchema>;
export type LockFileEvent = z.infer<typeof LockFileEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODULE_INDEX_MAP: Record<(typeof PROCESSING_MODULES)[number], number> = {
  structural: 0,
  asl: 1,
  population: 2,
};

export function modulesToBProcess(modules: string[]): boolean[] {
  const result: boolean[] = Array(PROCESSING_MODULES.length).fill(false);
  for (const mod of modules) {
    if (mod in MODULE_INDEX_MAP) {
      result[MODULE_INDEX_MAP[mod as keyof typeof MODULE_INDEX_MAP]] = true;
    }
  }
  return result;
}

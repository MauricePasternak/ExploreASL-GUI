import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROCESSING_MODULES = ["structural", "asl", "population"] as const;
export const PROCESSING_PHASES = [
  "idle",
  "preparing",
  "running",
  "finalizing",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const SUBJECT_MODULE_STATUSES = ["pending", "incomplete", "complete", "outdated"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ProcessConfigSchema = z.object({
  subjects: z.array(z.string()),
  modules: z.array(z.enum(PROCESSING_MODULES)),
  selectedProfileId: z.string(),
  workers: z.number().int().min(1),
  rerunBids2Legacy: z.boolean().optional(),
});

export const SubjectModuleStatusSchema = z.object({
  subjectSession: z.string().optional().default(""),
  module: z.enum(PROCESSING_MODULES),
  run: z.string().optional(),
  status: z.enum(SUBJECT_MODULE_STATUSES),
  completedSteps: z.array(z.string()),
  locked: z.boolean(),
  bids2legacyExists: z.boolean().optional(),
});

export const ProcessingPhaseSchema = z.enum(PROCESSING_PHASES);

/** Native lifecycle. `idle` exists only in renderer runtime state. */
export const ProcessingLifecycleSchema = z.enum([
  "preparing",
  "running",
  "finalizing",
  "completed",
  "cancelling",
  "cancelled",
  "failed",
  "interrupted",
]);

export const ProcessingTerminalResultSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const WorkerExitEvidenceSchema = z
  .object({
    pid: z.number().int().nonnegative(),
    exitCode: z.number().int(),
  })
  .strict();

/** Exact camelCase serialization of Rust `ProcessingRunSnapshot`. */
export const ProcessingRunSnapshotSchema = z
  .object({
    runId: z.string().min(1),
    lifecycle: ProcessingLifecycleSchema,
    projectRoot: z.string().min(1),
    selectedModules: z.array(z.string()),
    selectedSubjectSessions: z.array(z.string()),
    startTime: z.number().int().nonnegative(),
    workers: z.array(z.number().int().nonnegative()),
    exitEvidence: z.array(WorkerExitEvidenceSchema),
    watcherOwned: z.boolean(),
    terminalResult: ProcessingTerminalResultSchema.nullable().optional(),
    pendingLaunchFailure: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ProcessingRunLaunchResponseSchema = ProcessingRunSnapshotSchema;
/** Run-correlated native lifecycle event payload. */
export const ProcessingLifecycleSnapshotSchema = ProcessingRunSnapshotSchema;

const RunCorrelatedEventBaseSchema = z.object({
  runId: z.string().min(1),
  module: z.string(),
  subjectSession: z.string().nullable().optional(),
  run: z.string().nullable().optional(),
});

export const StatusFileCreatedPayloadSchema = RunCorrelatedEventBaseSchema.extend({
  stepCode: z.string(),
}).strict();
export const LockCreatedPayloadSchema = RunCorrelatedEventBaseSchema.strict();
export const LockRemovedPayloadSchema = RunCorrelatedEventBaseSchema.strict();
export const WorkerExitedPayloadSchema = z
  .object({
    runId: z.string().min(1),
    pid: z.number().int().nonnegative(),
    exitCode: z.number().int(),
  })
  .strict();

export const SubjectInfoSchema = z.object({
  subjectSession: z.string(),
  subject: z.string(),
  session: z.string(),
  hasStructural: z.boolean(),
  hasASL: z.boolean(),
  aslRuns: z.array(z.string()).optional().default([]),
});

export const LockFileEventSchema = z.discriminatedUnion("type", [
  StatusFileCreatedPayloadSchema.extend({
    type: z.literal("StatusFileCreated"),
  }),
  LockCreatedPayloadSchema.extend({
    type: z.literal("LockCreated"),
  }),
  LockRemovedPayloadSchema.extend({
    type: z.literal("LockRemoved"),
  }),
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessConfig = z.infer<typeof ProcessConfigSchema>;
export type SubjectModuleStatus = z.infer<typeof SubjectModuleStatusSchema>;
export type ProcessingPhase = z.infer<typeof ProcessingPhaseSchema>;
export type ProcessingLifecycle = z.infer<typeof ProcessingLifecycleSchema>;
export type ProcessingTerminalResult = z.infer<typeof ProcessingTerminalResultSchema>;
export type WorkerExitEvidence = z.infer<typeof WorkerExitEvidenceSchema>;
export type ProcessingRunSnapshot = z.infer<typeof ProcessingRunSnapshotSchema>;
export type ProcessingRunLaunchResponse = z.infer<typeof ProcessingRunLaunchResponseSchema>;
export type ProcessingLifecycleSnapshot = z.infer<typeof ProcessingLifecycleSnapshotSchema>;
export type StatusFileCreatedPayload = z.infer<typeof StatusFileCreatedPayloadSchema>;
export type LockCreatedPayload = z.infer<typeof LockCreatedPayloadSchema>;
export type LockRemovedPayload = z.infer<typeof LockRemovedPayloadSchema>;
export type WorkerExitedPayload = z.infer<typeof WorkerExitedPayloadSchema>;
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

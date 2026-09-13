import { z } from "zod";
import { ExecutionProfileSchema } from "./executionProfile";

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

export const ProcessingAvailableActionSchema = z.enum([
  "none",
  "stop",
  "retryCleanup",
  "confirmStopped",
  "acknowledge",
]);

export const ProcessingRequestSchema = z
  .object({
    requestId: z.uuid(),
    projectId: z.string().min(1),
    selectedModules: z.array(z.enum(PROCESSING_MODULES)).min(1),
    selectedSubjectSessions: z.array(z.string()),
    executionProfile: ExecutionProfileSchema,
    dataPar: z.record(z.string(), z.unknown()),
    participants: z
      .object({
        correction: z.boolean(),
        subjectRows: z.array(
          z
            .object({ subject: z.string(), session: z.string(), groupId: z.string().nullable() })
            .strict(),
        ),
        metadataGroups: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
      })
      .strict(),
    workers: z.number().int().positive(),
    rerunBids2legacy: z.boolean(),
  })
  .strict();

/** Exact camelCase serialization of native current authority. */
export const ProcessingRunSnapshotSchema = z
  .object({
    runId: z.string().min(1),
    lifecycle: ProcessingLifecycleSchema,
    projectRoot: z.string().min(1),
    selectedModules: z.array(z.enum(PROCESSING_MODULES)),
    selectedSubjectSessions: z.array(z.string()),
    startTime: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    requestId: z.string().nullable(),
    expectedTargets: z.array(
      z
        .object({
          module: z.enum(PROCESSING_MODULES),
          subjectSession: z.string().nullable(),
          run: z.string().nullable(),
          complete: z.boolean(),
        })
        .strict(),
    ),
    logicalExits: z.array(z.object({ workerId: z.string(), exitCode: z.number().int() }).strict()),
    workerCount: z.number().int().nonnegative(),
    error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
    availableAction: ProcessingAvailableActionSchema,
    terminalSummary: z
      .object({
        result: ProcessingTerminalResultSchema,
        executionCommitted: z.boolean(),
        populationCompleted: z.boolean(),
        profileId: z.string(),
        exploreAslVersion: z.string().nullable(),
      })
      .strict()
      .nullable(),
    terminalRevision: z.number().int().nonnegative().nullable(),
    executionCommitted: z.boolean(),
    populationExecutionCommitted: z.boolean(),
    versions: z
      .object({ exploreAsl: z.string(), matlab: z.string(), gui: z.string() })
      .strict()
      .nullable(),
    populationReadyMtimeMs: z.number().int().nonnegative().nullable(),
    terminalResult: ProcessingTerminalResultSchema.optional(),
  })
  .strict();

/** Bounded acknowledged history is a receipt, never a current snapshot. */
export const ProcessingHistoricalReplaySchema = z
  .object({
    version: z.literal(2),
    projectIdDigest: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.uuid(),
    runId: z.uuid(),
    terminalRevision: z.number().int().nonnegative(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: ProcessingTerminalResultSchema,
    summary: z
      .object({
        result: ProcessingTerminalResultSchema,
        executionCommitted: z.boolean(),
        populationCompleted: z.boolean(),
        profileId: z.string(),
        expectedTargetCount: z.number().int().nonnegative(),
        workerCount: z.number().int().nonnegative(),
        failedWorkerCount: z.number().int().nonnegative(),
        errorCode: z.string().nullable(),
        errorMessage: z.string().nullable(),
      })
      .strict(),
    acknowledged: z.literal(true),
    historicalReplay: z.literal(true),
  })
  .strict();

export const ProcessingReservationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current"), snapshot: ProcessingRunSnapshotSchema }).strict(),
  z.object({ kind: z.literal("historical"), replay: ProcessingHistoricalReplaySchema }).strict(),
]);

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
export type ProcessingRequest = z.infer<typeof ProcessingRequestSchema>;
export type ProcessingAvailableAction = z.infer<typeof ProcessingAvailableActionSchema>;
export type ProcessingHistoricalReplay = z.infer<typeof ProcessingHistoricalReplaySchema>;
export type ProcessingRunSnapshot = z.infer<typeof ProcessingRunSnapshotSchema>;
export type ProcessingLifecycleSnapshot = z.infer<typeof ProcessingLifecycleSnapshotSchema>;
export type StatusFileCreatedPayload = z.infer<typeof StatusFileCreatedPayloadSchema>;
export type LockCreatedPayload = z.infer<typeof LockCreatedPayloadSchema>;
export type LockRemovedPayload = z.infer<typeof LockRemovedPayloadSchema>;
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

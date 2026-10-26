import { z } from "zod";
import type { SubjectModuleStatus_Serialize } from "../generated/bindings";
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
    dataPar: z.record(z.string(), z.json()),
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ProcessingConfig_Serialize as ProcessConfig,
  SubjectInfo,
} from "../generated/bindings";

/** Renderer-normalized lock status, not the raw native response. */
export type SubjectModuleStatus = Omit<
  SubjectModuleStatus_Serialize,
  "module" | "run" | "status" | "bids2legacyExists"
> & {
  module: (typeof PROCESSING_MODULES)[number];
  run?: string;
  status: (typeof SUBJECT_MODULE_STATUSES)[number];
  bids2legacyExists?: boolean;
};
export type ProcessingPhase = (typeof PROCESSING_PHASES)[number];
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

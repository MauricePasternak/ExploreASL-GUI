import { describe, expect, it } from "vitest";

import {
  LockCreatedPayloadSchema,
  LockRemovedPayloadSchema,
  ProcessingRequestSchema,
  ProcessingRunSnapshotSchema,
  StatusFileCreatedPayloadSchema,
} from "./processingSchemas";

it("requires processing DataPar to contain only JSON values", () => {
  const schema = ProcessingRequestSchema.shape.dataPar;
  expect(schema.safeParse({ x: { values: [1, null, "ASL"] } }).success).toBe(true);
  expect(schema.safeParse({ x: { invalid: undefined } }).success).toBe(false);
  expect(schema.safeParse({ x: Number.NaN }).success).toBe(false);
});

describe("native processing-run wire schemas", () => {
  const snapshot = {
    runId: "processing-run-1",
    lifecycle: "running",
    projectRoot: "/projects/example",
    selectedModules: ["structural", "asl"],
    selectedSubjectSessions: ["sub-001_01"],
    startTime: 1_700_000_000_000,
    revision: 1,
    requestId: "12345678-1234-4234-8234-123456789002",
    expectedTargets: [],
    logicalExits: [],
    workerCount: 2,
    error: null,
    availableAction: "stop",
    terminalSummary: null,
    terminalRevision: null,
    executionCommitted: false,
    populationExecutionCommitted: false,
    versions: null,
    populationReadyMtimeMs: null,
  };

  it.each([
    "preparing",
    "running",
    "finalizing",
    "completed",
    "cancelling",
    "cancelled",
    "failed",
    "interrupted",
  ])("accepts Rust lifecycle %s", (lifecycle) => {
    expect(ProcessingRunSnapshotSchema.parse({ ...snapshot, lifecycle }).lifecycle).toBe(lifecycle);
  });

  it("accepts terminal result and rejects unknown snapshot fields", () => {
    expect(
      ProcessingRunSnapshotSchema.parse({
        ...snapshot,
        lifecycle: "completed",
        terminalResult: "completed",
      }),
    ).toMatchObject({ terminalResult: "completed" });
    expect(() => ProcessingRunSnapshotSchema.parse({ ...snapshot, unexpected: true })).toThrow();
    expect(() =>
      ProcessingRunSnapshotSchema.parse({ ...snapshot, pendingLaunchFailure: "obsolete" }),
    ).toThrow();
  });

  it.each([StatusFileCreatedPayloadSchema, LockCreatedPayloadSchema, LockRemovedPayloadSchema])(
    "fails closed when a lock event lacks runId",
    (schema) => {
      expect(() => schema.parse({ module: "xASL_module_ASL" })).toThrow();
    },
  );

  it("accepts interrupted recovery confirmation", () => {
    expect(
      ProcessingRunSnapshotSchema.parse({
        ...snapshot,
        lifecycle: "interrupted",
        availableAction: "confirmStopped",
      }).availableAction,
    ).toBe("confirmStopped");
  });
});

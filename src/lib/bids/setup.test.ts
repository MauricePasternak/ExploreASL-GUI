import { describe, expect, it } from "vitest";
import { SetupCommandErrorSchema, SetupCommitResultSchema, SetupPlanSchema } from "./setup";

describe("native BIDS setup IPC contract", () => {
  it("accepts the serialized native plan and committed outcome only", () => {
    expect(
      SetupPlanSchema.parse({
        planId: "setup-opaque-id",
        rootPath: "/dataset",
        mode: "bids",
        operations: [{ path: ".bidsignore", operation: "update", textPreview: "rawdata/\n" }],
        warnings: [],
        conflicts: [],
        projectSummary: {
          schemaVersion: "1",
          name: "Dataset",
          projectId: "id",
          dataSource: "bids",
          contentHash: "a".repeat(64),
        },
        preservesReadme: true,
        temporaryArtifacts: ["same-parent candidate"],
      }),
    ).toMatchObject({ planId: "setup-opaque-id", mode: "bids" });
    expect(
      SetupCommitResultSchema.parse({
        outcome: "committed",
        projectPath: "/dataset/project.easl",
        canonicalProjectBytes: "{}",
        directorySyncSupported: true,
      }),
    ).toMatchObject({ outcome: "committed" });
    expect(() => SetupCommitResultSchema.parse({ directorySyncSupported: true })).toThrow();
  });

  it("keeps structured native errors typed", () => {
    expect(SetupCommandErrorSchema.parse({ kind: "stale", message: "changed" }).kind).toBe("stale");
  });
});

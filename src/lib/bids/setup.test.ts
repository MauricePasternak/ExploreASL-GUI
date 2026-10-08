import { describe, expect, it } from "vitest";
import { SetupCommandErrorSchema, SetupPlanSchema } from "./setup";

describe("native BIDS setup IPC contract", () => {
  it("accepts the serialized native plan", () => {
    expect(
      SetupPlanSchema.parse({
        planId: "setup-opaque-id",
        rootPath: "/dataset",
        mode: "bids",
        operations: [{ path: ".bidsignore", operation: "update", textPreview: "rawdata/\n" }],
        warnings: [],
        conflicts: [],
        projectSummary: {
          schemaVersion: "2",
          name: "Dataset",
          projectId: "id",
          dataSource: "bids",
          contentHash: "a".repeat(64),
        },
        preservesReadme: true,
        temporaryArtifacts: ["same-parent candidate"],
      }),
    ).toMatchObject({ planId: "setup-opaque-id", mode: "bids" });
  });

  it("keeps structured native errors typed", () => {
    expect(SetupCommandErrorSchema.parse({ kind: "stale", message: "changed" }).kind).toBe("stale");
  });
});

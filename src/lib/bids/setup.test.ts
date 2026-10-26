import { describe, expect, it } from "vitest";
import { SetupCommandErrorSchema } from "./setup";

describe("native BIDS setup IPC contract", () => {
  it("keeps structured native errors typed", () => {
    expect(
      SetupCommandErrorSchema.parse({ kind: "stale", message: "changed", details: "changed" }).kind,
    ).toBe("stale");
  });
});

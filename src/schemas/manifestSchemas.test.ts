import { describe, it, expect } from "vitest";
import { FAIL_REASON_LABELS, DISPLAY_VERDICTS } from "./manifestSchemas";

describe("FAIL_REASON_LABELS", () => {
  it("has entries for all fail reasons", () => {
    expect(FAIL_REASON_LABELS.motion).toBe("Motion");
    expect(FAIL_REASON_LABELS.coverage).toBe("Coverage");
    expect(FAIL_REASON_LABELS.dropout).toBe("Signal Dropout");
    expect(FAIL_REASON_LABELS.artifact).toBe("Artifact");
    expect(FAIL_REASON_LABELS.registration).toBe("Registration");
    expect(FAIL_REASON_LABELS.other).toBe("Other");
  });
});

describe("DISPLAY_VERDICTS", () => {
  it("contains expected verdicts", () => {
    expect(DISPLAY_VERDICTS).toEqual(["neutral", "pass", "fail", "no-info", "stale"]);
  });
});

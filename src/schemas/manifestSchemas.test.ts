import { describe, it, expect } from "vitest";
import { ManifestVerdictSchema, FAIL_REASON_LABELS, DISPLAY_VERDICTS } from "./manifestSchemas";

describe("ManifestVerdictSchema", () => {
  it("rejects status 'neutral'", () => {
    expect(() => ManifestVerdictSchema.parse({ status: "neutral", setAt: 1 })).toThrow();
  });

  it("accepts status 'pass'", () => {
    const result = ManifestVerdictSchema.parse({ status: "pass", setAt: 1 });
    expect(result.status).toBe("pass");
  });

  it("accepts status 'fail' with reason", () => {
    const result = ManifestVerdictSchema.parse({ status: "fail", reason: "motion", setAt: 1 });
    expect(result.status).toBe("fail");
    expect(result.reason).toBe("motion");
  });

  it("rejects status 'fail' without reason", () => {
    expect(() => ManifestVerdictSchema.parse({ status: "fail", setAt: 1 })).toThrow();
  });
});

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

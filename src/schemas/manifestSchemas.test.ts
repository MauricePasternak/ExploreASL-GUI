import { describe, it, expect } from "vitest";
import { ManifestVerdictSchema, FAIL_REASON_LABELS, DISPLAY_VERDICTS } from "./manifestSchemas";
import * as manifestSchemas from "./manifestSchemas";
import { ManifestUiStateSchema } from "./project";

const reviewerOne = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Reviewer 1",
  createdAt: "2026-08-08T12:00:00.000Z",
};

const reviewerTwo = {
  id: "22222222-2222-4222-8222-222222222222",
  label: "Reviewer 2",
  createdAt: "2026-08-08T12:00:00.000Z",
};

const passVerdict = { status: "pass" as const, setAt: 1 };

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

describe("ManifestUiStateSchema reviewer verdict modes", () => {
  it.each([undefined, [reviewerOne]])("accepts flat verdicts with reviewers %o", (reviewers) => {
    const parsed = ManifestUiStateSchema.parse({
      reviewers,
      verdicts: { "sub-01_01": passVerdict },
    });

    expect(parsed.verdicts).toEqual({ "sub-01_01": passVerdict });
    expect(parsed.reviewers).toEqual(reviewers);
  });

  it("accepts nested verdicts with two reviewers", () => {
    const verdicts = {
      [reviewerOne.id]: { "sub-01_01": passVerdict },
      [reviewerTwo.id]: {},
    };

    expect(
      ManifestUiStateSchema.parse({ reviewers: [reviewerOne, reviewerTwo], verdicts }).verdicts,
    ).toEqual(verdicts);
  });

  it("rejects nonempty nested verdicts in single-reviewer mode", () => {
    expect(
      ManifestUiStateSchema.safeParse({
        reviewers: [reviewerOne],
        verdicts: { [reviewerOne.id]: { "sub-01_01": passVerdict } },
      }).success,
    ).toBe(false);
  });

  it("rejects nonempty flat verdicts in multi-reviewer mode", () => {
    expect(
      ManifestUiStateSchema.safeParse({
        reviewers: [reviewerOne, reviewerTwo],
        verdicts: { "sub-01_01": passVerdict },
      }).success,
    ).toBe(false);
  });

  it("rejects nested verdicts indexed by an unregistered reviewer", () => {
    expect(
      ManifestUiStateSchema.safeParse({
        reviewers: [reviewerOne, reviewerTwo],
        verdicts: {
          "33333333-3333-4333-8333-333333333333": { "sub-01_01": passVerdict },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts empty verdict records in either mode", () => {
    expect(ManifestUiStateSchema.safeParse({ verdicts: {} }).success).toBe(true);
    expect(
      ManifestUiStateSchema.safeParse({ reviewers: [reviewerOne, reviewerTwo], verdicts: {} })
        .success,
    ).toBe(true);
  });
});

describe("ManifestUiStateSchema reviewer data", () => {
  it("parses reviewers, active reviewer, and resolved verdicts", () => {
    const parsed = ManifestUiStateSchema.parse({
      reviewers: [reviewerOne, reviewerTwo],
      activeReviewerId: reviewerTwo.id,
      resolvedVerdicts: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    });

    expect(parsed.reviewers).toEqual([reviewerOne, reviewerTwo]);
    expect(parsed.activeReviewerId).toBe(reviewerTwo.id);
    expect(parsed.resolvedVerdicts).toEqual({
      "sub-01_01": { status: "fail", reason: "motion", setAt: 1 },
    });
  });

  it("rejects a resolved fail verdict without a reason", () => {
    expect(
      ManifestUiStateSchema.safeParse({
        resolvedVerdicts: { "sub-01_01": { status: "fail", setAt: 1 } },
      }).success,
    ).toBe(false);
  });

  it.each([
    [{ ...reviewerOne, label: "" }],
    [{ ...reviewerOne, id: "not-a-uuid" }],
    Array.from({ length: 6 }, (_, index) => ({
      ...reviewerOne,
      id: `00000000-0000-4000-8000-00000000000${index}`,
    })),
  ])("rejects invalid reviewer registry %o", (reviewers) => {
    expect(ManifestUiStateSchema.safeParse({ reviewers }).success).toBe(false);
  });
});

describe("multi-reviewer manifest schema exports", () => {
  it("exports reviewer validation and the reviewer cap", () => {
    expect(manifestSchemas.MAX_REVIEWERS).toBe(5);
    expect(manifestSchemas.ReviewerSchema.parse(reviewerOne)).toEqual(reviewerOne);
  });
});

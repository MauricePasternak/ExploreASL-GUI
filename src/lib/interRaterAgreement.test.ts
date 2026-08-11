import { describe, expect, it } from "vitest";

import { cohensKappa, fleissKappa, formatKappa } from "./interRaterAgreement";

describe("cohensKappa", () => {
  it("uses only subjectSessions rated by both reviewers", () => {
    const result = cohensKappa(
      { "sub-01": "pass", "sub-02": "fail", "sub-03": "pass" },
      { "sub-01": "pass", "sub-02": "fail", "sub-04": "fail" },
    );

    expect(result).toEqual({
      kappa: 1,
      ci95Lower: 1,
      ci95Upper: 1,
      n: 2,
      agreementRate: 1,
    });
  });

  it("computes partial agreement across five complete ratings", () => {
    const result = cohensKappa(
      { a: "pass", b: "pass", c: "fail", d: "fail", e: "pass" },
      { a: "pass", b: "fail", c: "fail", d: "fail", e: "pass" },
    );

    expect(result.n).toBe(5);
    expect(result.agreementRate).toBe(0.8);
    expect(result.kappa).toBeCloseTo(0.615_384_615_4, 10);
  });

  it("returns perfect kappa and CI for identical category-varying ratings", () => {
    const result = cohensKappa(
      { a: "pass", b: "fail", c: "pass", d: "fail" },
      { a: "pass", b: "fail", c: "pass", d: "fail" },
    );

    expect(result).toEqual({
      kappa: 1,
      ci95Lower: 1,
      ci95Upper: 1,
      n: 4,
      agreementRate: 1,
    });
  });

  it("returns null kappa and CI for single-category ratings", () => {
    expect(cohensKappa({ a: "pass", b: "pass" }, { a: "pass", b: "pass" })).toEqual({
      kappa: null,
      ci95Lower: null,
      ci95Upper: null,
      n: 2,
      agreementRate: 1,
    });
  });

  it("returns zero kappa for all-pass versus all-fail ratings", () => {
    const result = cohensKappa({ a: "pass", b: "pass" }, { a: "fail", b: "fail" });

    expect(result.kappa).toBe(0);
    expect(result.agreementRate).toBe(0);
  });

  it("keeps confidence intervals from the specified formula without clamping", () => {
    const result = cohensKappa({ a: "pass", b: "pass" }, { a: "pass", b: "fail" });

    expect(result.kappa).toBe(0);
    expect(result.ci95Lower).toBeCloseTo(-1.96 * Math.sqrt(0.5), 10);
    expect(result.ci95Upper).toBeCloseTo(1.96 * Math.sqrt(0.5), 10);
  });

  it("returns nullable kappa and CI with fewer than two complete ratings", () => {
    expect(cohensKappa({ a: "pass" }, { a: "pass" })).toEqual({
      kappa: null,
      ci95Lower: null,
      ci95Upper: null,
      n: 1,
      agreementRate: 1,
    });
  });
});

describe("fleissKappa", () => {
  it("computes a known three-reviewer partial-agreement value", () => {
    const result = fleissKappa({
      reviewerA: { a: "pass", b: "pass", c: "fail", d: "fail" },
      reviewerB: { a: "pass", b: "fail", c: "fail", d: "pass" },
      reviewerC: { a: "pass", b: "fail", c: "fail", d: "fail" },
    });

    expect(result.n).toBe(4);
    expect(result.agreementRate).toBe(0.5);
    expect(result.kappa).toBeCloseTo(11 / 35, 10);
    expect(result.ci95Lower).toBeCloseTo(-0.267_458_788_6, 10);
    expect(result.ci95Upper).toBeCloseTo(0.896_030_217_2, 10);
  });

  it("returns perfect kappa and CI for category-varying unanimous ratings", () => {
    const verdicts = {
      reviewerA: { a: "pass" as const, b: "fail" as const, c: "pass" as const },
      reviewerB: { a: "pass" as const, b: "fail" as const, c: "pass" as const },
      reviewerC: { a: "pass" as const, b: "fail" as const, c: "pass" as const },
    };

    expect(fleissKappa(verdicts)).toEqual({
      kappa: 1,
      ci95Lower: 1,
      ci95Upper: 1,
      n: 3,
      agreementRate: 1,
    });
  });

  it("returns null kappa and CI for single-category ratings", () => {
    expect(
      fleissKappa({
        reviewerA: { a: "pass", b: "pass" },
        reviewerB: { a: "pass", b: "pass" },
        reviewerC: { a: "pass", b: "pass" },
      }),
    ).toEqual({
      kappa: null,
      ci95Lower: null,
      ci95Upper: null,
      n: 2,
      agreementRate: 1,
    });
  });

  it("excludes subjectSessions missing any reviewer rating", () => {
    const result = fleissKappa({
      reviewerA: { a: "pass", b: "fail", c: "pass" },
      reviewerB: { a: "pass", b: "fail", c: "fail" },
      reviewerC: { a: "pass", b: "fail" },
    });

    expect(result).toEqual({
      kappa: 1,
      ci95Lower: 1,
      ci95Upper: 1,
      n: 2,
      agreementRate: 1,
    });
  });

  it("returns no included ratings for fewer than two reviewers", () => {
    expect(fleissKappa({ reviewerA: { a: "pass", b: "fail" } })).toEqual({
      kappa: null,
      ci95Lower: null,
      ci95Upper: null,
      n: 0,
      agreementRate: 0,
    });
  });

  it("rejects two-reviewer input because Fleiss kappa requires more than two reviewers", () => {
    expect(
      fleissKappa({
        reviewerA: { a: "pass", b: "fail" },
        reviewerB: { a: "pass", b: "fail" },
      }),
    ).toEqual({
      kappa: null,
      ci95Lower: null,
      ci95Upper: null,
      n: 0,
      agreementRate: 0,
    });
  });
});

describe("formatKappa", () => {
  it("formats finite kappa and confidence interval to two decimals", () => {
    expect(formatKappa(0.82, 0.71, 0.9)).toBe("0.82 [0.71, 0.90]");
  });

  it("formats unavailable kappa as N/A", () => {
    expect(formatKappa(null, null, null)).toBe("N/A");
  });
});

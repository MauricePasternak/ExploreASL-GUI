import { describe, expect, it } from "vitest";

import {
  escapeCsvField,
  generateAgreementCsv,
  generateVerdictsCsv,
  type AgreementCsvPayload,
} from "./manifestCsvExport";

describe("escapeCsvField", () => {
  it.each([
    ["plain text", "plain text"],
    ["contains,comma", '"contains,comma"'],
    ['contains "quote"', '"contains ""quote"""'],
    ["line one\r\nline two", '"line one\nline two"'],
    ["line one\rline two", '"line one\nline two"'],
    ["line one\nline two", '"line one\nline two"'],
    ["=SUM(A1:A2)", "\t=SUM(A1:A2)"],
    ["+1", "\t+1"],
    ["-1", "\t-1"],
    ["@cmd", "\t@cmd"],
    ["=SUM(1,1)", '"\t=SUM(1,1)"'],
  ])("escapes %j as %j", (value, expected) => {
    expect(escapeCsvField(value)).toBe(expected);
  });
});

describe("generateVerdictsCsv", () => {
  it("renders the exact simplified single-reviewer columns without agreement data", () => {
    const csv = generateVerdictsCsv({
      subjectSessions: ["sub-01_01"],
      verdicts: {
        "sub-01_01": { status: "pass", notes: "looks good" },
      },
      qcMetrics: {
        "sub-01_01": {
          coverage: 95,
          spatialCov: 10.5,
          motion: [0.2, 0.4],
          motionExclusionPct: 3,
        },
      },
    });

    expect(csv).toBe(
      "SubjectSession,Verdict,Reason,Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct\n" +
        "sub-01_01,pass,,looks good,95,10.5,0.4,3",
    );
    expect(csv).not.toContain("Final_Verdict");
    expect(csv).not.toContain("Resolution_Notes");
    expect(csv).not.toContain("Agreement Statistics");
    expect(csv).not.toContain("\r");
  });

  it("retains headers when single-reviewer verdict data is empty", () => {
    expect(generateVerdictsCsv({ verdicts: {} })).toBe(
      "SubjectSession,Verdict,Reason,Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct",
    );
  });

  it("appends default agreement statistics after an empty multi-reviewer body", () => {
    expect(
      generateVerdictsCsv({
        reviewers: [
          { id: "reviewer-a", label: "First" },
          { id: "reviewer-b", label: "Second" },
        ],
        verdicts: {},
      }),
    ).toBe(
      "SubjectSession,Reviewer_1_Verdict,Reviewer_1_Reason,Reviewer_1_Notes,Reviewer_2_Verdict,Reviewer_2_Reason,Reviewer_2_Notes,Final_Verdict,Resolution_Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct\n" +
        "\n" +
        "Agreement Statistics\n" +
        "Metric,Value\n" +
        "Number_of_Reviewers,2\n" +
        "Overall_Initial_Agreement_Rate,0\n" +
        "Kappa,\n" +
        "Kappa_CI_Lower,\n" +
        "Kappa_CI_Upper,\n" +
        "N_Subjects,0\n" +
        "N_Disagreements,0\n" +
        "\n" +
        "Per_Group_Agreement\n" +
        "Group,N,Initial_Agreement_Rate,Kappa,Kappa_CI_Lower,Kappa_CI_Upper",
    );
  });

  it("uses registry-ordered reviewer columns and resolution then unanimity for final verdicts", () => {
    const agreement: AgreementCsvPayload = {
      numberOfReviewers: 2,
      overall: {
        agreementRate: 1 / 3,
        kappa: 0.2,
        ci95Lower: 0.1,
        ci95Upper: 0.3,
        n: 3,
      },
      numberOfDisagreements: 2,
      perGroup: [],
    };
    const csv = generateVerdictsCsv({
      reviewers: [
        { id: "reviewer-b", label: "Second" },
        { id: "reviewer-a", label: "First" },
      ],
      subjectSessions: ["sub-01_01", "sub-02_01", "sub-03_01"],
      verdicts: {
        "reviewer-a": {
          "sub-01_01": { status: "pass", reason: "other", notes: "first view" },
          "sub-02_01": { status: "pass" },
          "sub-03_01": { status: "fail", reason: "motion" },
        },
        "reviewer-b": {
          "sub-01_01": { status: "pass", notes: "second view" },
          "sub-02_01": { status: "fail", reason: "coverage", notes: "needs review" },
          "sub-03_01": { status: "pass" },
        },
      },
      resolvedVerdicts: {
        "sub-02_01": { status: "fail", reason: "coverage", notes: "resolution note" },
      },
      qcMetrics: {
        "sub-01_01": { coverage: 97, spatialCov: 8, motion: [0.1, 0.3], motionExclusionPct: 2 },
      },
      agreement,
    });

    expect(csv).toContain(
      "SubjectSession,Reviewer_1_Verdict,Reviewer_1_Reason,Reviewer_1_Notes,Reviewer_2_Verdict,Reviewer_2_Reason,Reviewer_2_Notes,Final_Verdict,Resolution_Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct",
    );
    expect(csv).toContain("sub-01_01,pass,,second view,pass,other,first view,pass,,97,8,0.3,2");
    expect(csv).toContain("sub-02_01,fail,coverage,needs review,pass,,,fail,resolution note,,,,");
    expect(csv).toContain("sub-03_01,pass,,,fail,motion,,,,,,,");
    expect(csv).toContain("\n\nAgreement Statistics\nMetric,Value");
    expect(csv).not.toContain("\r");
  });
});

describe("generateAgreementCsv", () => {
  it("renders exact overall metrics and group rows without serializing nullable values", () => {
    const csv = generateAgreementCsv({
      numberOfReviewers: 2,
      overall: { agreementRate: 0.8, kappa: null, ci95Lower: null, ci95Upper: null, n: 50 },
      numberOfDisagreements: 10,
      perGroup: [
        {
          group: "Group A",
          result: { agreementRate: 1, kappa: 1, ci95Lower: 1, ci95Upper: 1, n: 20 },
        },
        {
          group: "Group B",
          result: { agreementRate: 0, kappa: null, ci95Lower: null, ci95Upper: null, n: 30 },
        },
      ],
    });

    expect(csv).toBe(
      "Agreement Statistics\n" +
        "Metric,Value\n" +
        "Number_of_Reviewers,2\n" +
        "Overall_Initial_Agreement_Rate,0.8\n" +
        "Kappa,\n" +
        "Kappa_CI_Lower,\n" +
        "Kappa_CI_Upper,\n" +
        "N_Subjects,50\n" +
        "N_Disagreements,10\n" +
        "\n" +
        "Per_Group_Agreement\n" +
        "Group,N,Initial_Agreement_Rate,Kappa,Kappa_CI_Lower,Kappa_CI_Upper\n" +
        "Group A,20,1,1,1,1\n" +
        "Group B,30,0,,,",
    );
    expect(csv).not.toMatch(/null|undefined/);
  });
});

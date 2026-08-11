/// <reference types="node" />

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { ManifestPayload } from "./manifestExport";
import { renderMarkdown, renderHtml } from "./manifestExport";
import { getDefaultDataPar } from "./dataParDefaults";
import { generateMethodsParagraph } from "./manifestMethods";

function readGolden(filename: string): string {
  return readFileSync(resolve(__dirname, "__fixtures__", filename), "utf-8");
}

function makeFixtureManifest(): ManifestPayload {
  return {
    metadataGroups: [
      {
        label: "Group A",
        nSubjects: 2,
        nRuns: 4,
        params: {
          "Arterial Spin Labeling Type": "PCASL",
          "Labeling Duration": "1800 ms",
          "Post Labeling Delay": "2000 ms",
          "M0 Type": "Separate",
          "Background Suppression": "true",
        },
      },
      {
        label: "Group B",
        nSubjects: 1,
        nRuns: 2,
        params: {
          "Arterial Spin Labeling Type": "PASL",
          "Post Labeling Delay": "1800 ms",
          "Bolus Cut Off Flag": "true",
          "Bolus Cut Off Delay Time": "1000 ms",
          "M0 Type": "Included",
          "Background Suppression": "false",
        },
      },
      {
        label: "Ungrouped",
        nSubjects: 1,
        nRuns: 1,
        params: {
          "Arterial Spin Labeling Type": "PCASL",
          "Labeling Duration": "1500 ms",
          "Post Labeling Delay": "1500 ms",
          "M0 Type": "Separate",
          "Background Suppression": "true",
        },
      },
    ],
    versions: { exploreASL: "1.0.0", matlab: "R2023b", gui: "0.1.0" },
    qcGroups: [
      {
        label: "Group A",
        passTotal: "2 / 2",
        coverage: "95.00 (3.54)",
        spatialCov: "8.50 (0.71)",
        motion: "0.40 (0.14)",
        motionExclusion: "5.00 (4.24)",
        failReasons: "none",
      },
      {
        label: "Group B",
        passTotal: "0 / 1",
        coverage: "N/A",
        spatialCov: "N/A",
        motion: "N/A",
        motionExclusion: "N/A",
        failReasons: "motion: 1",
      },
      {
        label: "Ungrouped",
        passTotal: "1 / 1",
        coverage: "88.00 (N/A)",
        spatialCov: "10.00 (N/A)",
        motion: "0.50 (N/A)",
        motionExclusion: "2.00 (N/A)",
        failReasons: "none",
      },
    ],
    pipelineParagraph:
      "Data were processed with ExploreASL (version 1.0.0) running in MATLAB R2023b through the ExploreASL GUI (version 0.1.0). This manifest covers 4 subjects across 3 groups.",
    ...(() => {
      const methods = generateMethodsParagraph(getDefaultDataPar());
      return {
        methodsParagraphs: methods.paragraphs,
        methodsReferences: methods.references,
      };
    })(),
    dataPar: {
      "x.Q.M0": 1,
      "x.bPVCNativeSpace": 0,
      "x.SESSIONS": "01",
    },
  };
}

describe("renderMarkdown", () => {
  it("renders markdown byte-identical to golden", () => {
    const manifest = makeFixtureManifest();
    const out = renderMarkdown(manifest);
    expect(out).toEqual(readGolden("manifest.golden.md"));
  });

  it("produces deterministic markdown output", () => {
    const manifest = makeFixtureManifest();
    const out1 = renderMarkdown(manifest);
    const out2 = renderMarkdown(manifest);
    expect(out1).toBe(out2);
  });

  it("inserts multi-reviewer agreement between QC and pipeline while single payloads remain unchanged", () => {
    const manifest = {
      ...makeFixtureManifest(),
      agreement: {
        numberOfReviewers: 2,
        overall: { agreementRate: 0.86, kappa: 0.82, ci95Lower: 0.71, ci95Upper: 0.9, n: 50 },
        numberOfDisagreements: 7,
        perGroup: [
          {
            label: "Group A",
            result: { agreementRate: 1, kappa: null, ci95Lower: null, ci95Upper: null, n: 1 },
          },
        ],
      },
    } as unknown as ManifestPayload;

    const markdown = renderMarkdown(manifest);
    expect(markdown).toContain("## Section 4: Inter-Rater Agreement");
    expect(markdown).toContain("| Overall Initial Agreement Rate | 86% (43/50) |");
    expect(markdown).toContain("| Kappa Value | κ = 0.82 [0.71, 0.90] |");
    expect(markdown).toContain("| Group A | 1 | 100% | N/A |");
    expect(markdown).toContain(
      "Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject counts.",
    );
    expect(markdown.indexOf("## Section 3: QC Summary")).toBeLessThan(
      markdown.indexOf("## Section 4: Inter-Rater Agreement"),
    );
    expect(markdown.indexOf("## Section 4: Inter-Rater Agreement")).toBeLessThan(
      markdown.indexOf("## Section 5: Pipeline Summary"),
    );
  });
});

describe("renderHtml", () => {
  it("renders HTML byte-identical to golden", () => {
    const manifest = makeFixtureManifest();
    const out = renderHtml(manifest);
    expect(out).toEqual(readGolden("manifest.golden.html"));
  });

  it("produces deterministic HTML output", () => {
    const manifest = makeFixtureManifest();
    const out1 = renderHtml(manifest);
    const out2 = renderHtml(manifest);
    expect(out1).toBe(out2);
  });

  it("renders multi-reviewer agreement in self-contained HTML", () => {
    const html = renderHtml({
      ...makeFixtureManifest(),
      agreement: {
        numberOfReviewers: 2,
        overall: { agreementRate: 1, kappa: null, ci95Lower: null, ci95Upper: null, n: 2 },
        numberOfDisagreements: 0,
        perGroup: [],
      },
    } as unknown as ManifestPayload);

    expect(html).toContain("Inter-Rater Agreement");
    expect(html).toContain("Overall Initial Agreement Rate");
    expect(html).toContain(
      "Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject counts.",
    );
    expect(html).toContain("<style>");
    expect(html).not.toContain("stylesheet");
  });
});

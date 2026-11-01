/// <reference types="node" />

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { ManifestPayload } from "./manifestExport";
import { renderMarkdown, renderHtml, sanitiseDataParForExport } from "./manifestExport";
import { getDefaultDataPar } from "./dataParDefaults";
import { generateMethodsParagraph } from "./manifestMethods";

function readGolden(filename: string): string {
  return readFileSync(resolve(__dirname, "__fixtures__", filename), "utf-8").replace(/\r\n/g, "\n");
}

function makeFixtureManifest(): ManifestPayload {
  return {
    metadataGroups: [
      {
        label: "Group A",
        nParticipants: 2,
        nSubjectSessions: 2,
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
        nParticipants: 1,
        nSubjectSessions: 1,
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
        nParticipants: 1,
        nSubjectSessions: 1,
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
        coverage: "95.00 (3.54); n=2",
        spatialCov: "8.50 (0.71); n=2",
        motion: "0.40 (0.14); n=2",
        motionExclusion: "5.00 (4.24); n=2",
        failReasons: "none",
      },
      {
        label: "Group B",
        passTotal: "0 / 1",
        coverage: "N/A; n=0",
        spatialCov: "N/A; n=0",
        motion: "N/A; n=0",
        motionExclusion: "N/A; n=0",
        failReasons: "motion: 1",
      },
      {
        label: "Ungrouped",
        passTotal: "1 / 1",
        coverage: "88.00 (N/A); n=1",
        spatialCov: "10.00 (N/A); n=1",
        motion: "0.50 (N/A); n=1",
        motionExclusion: "2.00 (N/A); n=1",
        failReasons: "none",
      },
    ],
    pipelineParagraph:
      "This manifest covers 4 unique participants with 4 included subject-sessions across 3 groups.",
    ...(() => {
      const methods = generateMethodsParagraph(getDefaultDataPar());
      return {
        methodsParagraphs: methods.paragraphs,
        methodsReferences: methods.references,
        methodsDisclaimer: methods.disclaimer,
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
  it.each([
    ["/private/study", "[redacted path]/study"],
    ["C:\\private\\study", "[redacted path]/study"],
    ["C:\\", "[redacted path]"],
  ])("preserves selection semantics while redacting machine paths: %s", (path, expected) => {
    const dataPar = {
      x: {
        opts: { subjectFolder: path },
        external: { FSLdir: path },
        dataset: { subjectRegexp: "^sub-(?!excluded).*", ForceInclusionList: ["sub-01"] },
        Q: { M0: 123 },
      },
    };
    const copy = sanitiseDataParForExport(dataPar);
    expect(copy).toMatchObject({
      x: {
        dataset: dataPar.x.dataset,
        Q: { M0: 123 },
        opts: { subjectFolder: expected },
        external: { FSLdir: expected },
      },
    });
    expect(dataPar.x.opts.subjectFolder).toBe(path);
    expect(sanitiseDataParForExport({ x: { dataset: {} } })).toEqual({ x: { dataset: {} } });
    const manifest = { ...makeFixtureManifest(), dataPar };
    expect(renderMarkdown(manifest)).toContain('"ForceInclusionList"');
    expect(renderMarkdown(manifest)).toContain('"^sub-(?!excluded).*"');
    expect(renderHtml(manifest)).not.toContain("private");
  });

  it("renders markdown byte-identical to golden", () => {
    const manifest = makeFixtureManifest();
    const out = renderMarkdown(manifest);
    expect(out.split(manifest.methodsDisclaimer)).toHaveLength(2);
    const methods = out.slice(out.indexOf("### Methods"), out.indexOf("### References"));
    expect(methods.indexOf(manifest.methodsDisclaimer)).toBeLessThan(
      methods.indexOf(manifest.methodsParagraphs[0]),
    );
    expect(methods.split("\n\n").slice(2, 7)).toEqual(manifest.methodsParagraphs);
    expect(out).toEqual(readGolden("manifest.golden.md"));
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
    expect(markdown).toContain("| Number of Subject-Sessions | 50 |");
    expect(markdown).toContain("| Subject-Sessions Requiring Resolution | 7 |");
    expect(markdown).toContain("| n (subject-sessions) |");
    expect(markdown).toContain("| Group A | 1 | 100% | N/A |");
    expect(markdown).toContain(
      "Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject-session counts.",
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
    expect(out.split(manifest.methodsDisclaimer)).toHaveLength(2);
    const methods = out.slice(out.indexOf("<h3>Methods</h3>"), out.indexOf("<h3>References</h3>"));
    expect(methods.match(/<p>/g) ?? []).toHaveLength(6);
    const text = methods
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
    expect(text.trimEnd().split("\n").slice(1)).toEqual([
      manifest.methodsDisclaimer,
      ...manifest.methodsParagraphs,
    ]);
    expect(out).toEqual(readGolden("manifest.golden.html"));
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
    expect(html).toContain("<td>Number of Subject-Sessions</td><td>2</td>");
    expect(html).toContain("<td>Subject-Sessions Requiring Resolution</td><td>0</td>");
    expect(html).toContain(
      "Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject-session counts.",
    );
    expect(html).toContain("<style>");
    expect(html).not.toContain("stylesheet");
  });
});

/// <reference types="node" />
// Run with: pnpm exec tsx src/lib/__fixtures__/regenerate_goldens.ts
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { ManifestPayload } from "../manifestExport";
import { renderHtml, renderMarkdown } from "../manifestExport";
import { getDefaultDataPar } from "../dataParDefaults";
import { generateMethodsParagraph } from "../manifestMethods";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const manifest = makeFixtureManifest();
const mdOut = renderMarkdown(manifest);
const htmlOut = renderHtml(manifest);

const fixturesDir = __dirname;
writeFileSync(resolve(fixturesDir, "manifest.golden.md"), mdOut, "utf-8");
writeFileSync(resolve(fixturesDir, "manifest.golden.html"), htmlOut, "utf-8");

console.log("Golden files regenerated.");

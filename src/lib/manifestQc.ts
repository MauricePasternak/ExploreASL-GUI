import { exists, readTextFile } from "@tauri-apps/plugin-fs";

export interface SubjectQcOutputs {
  coverage: number;
  spatialCov: number;
  motion: number[];
  motionExclusionPct: number;
}

export async function readSubjectQcOutputs(
  projectRoot: string,
  subjectSession: string,
): Promise<SubjectQcOutputs | null> {
  const popDir = `${projectRoot}/derivatives/ExploreASL/population`;

  const coveragePath = `${popDir}/Coverage.tsv`;
  if (!(await exists(coveragePath))) return null;

  try {
    const coverageRaw = await readTextFile(coveragePath);
    const coverageLines = coverageRaw.trim().split("\n");
    const coverageHeader = coverageLines[0].split("\t");
    const subjIdx = coverageHeader.indexOf("SubjectSession");
    const covIdx = coverageHeader.indexOf("Coverage");
    let coverage = 0;
    for (let i = 1; i < coverageLines.length; i++) {
      const cols = coverageLines[i].split("\t");
      if (cols[subjIdx] === subjectSession) {
        coverage = parseFloat(cols[covIdx]);
        break;
      }
    }

    const covPath = `${popDir}/SpatialCoV.tsv`;
    const covRaw = await readTextFile(covPath);
    const covLines = covRaw.trim().split("\n");
    const covHeader2 = covLines[0].split("\t");
    const subjIdx2 = covHeader2.indexOf("SubjectSession");
    const scIdx = covHeader2.indexOf("SpatialCoV");
    let spatialCov = 0;
    for (let i = 1; i < covLines.length; i++) {
      const cols = covLines[i].split("\t");
      if (cols[subjIdx2] === subjectSession) {
        spatialCov = parseFloat(cols[scIdx]);
        break;
      }
    }

    const motion: number[] = [];
    let motionExclusionPct = 0;
    for (let run = 1; run <= 10; run++) {
      const runStr = String(run).padStart(2, "0");
      const motionPath = `${popDir}/Motion_${runStr}.tsv`;
      if (!(await exists(motionPath))) break;
      const motionRaw = await readTextFile(motionPath);
      const motionLines = motionRaw.trim().split("\n");
      const motionHeader = motionLines[0].split("\t");
      const subjIdx3 = motionHeader.indexOf("SubjectSession");
      const motionIdx = motionHeader.indexOf("MeanMotion_rms");
      const exclIdx = motionHeader.indexOf("MotionExclusionPct");
      for (let i = 1; i < motionLines.length; i++) {
        const cols = motionLines[i].split("\t");
        if (cols[subjIdx3] === subjectSession) {
          motion.push(parseFloat(cols[motionIdx]));
          motionExclusionPct += parseFloat(cols[exclIdx]);
          break;
        }
      }
    }

    return { coverage, spatialCov, motion, motionExclusionPct };
  } catch {
    return null;
  }
}

export function aggregateMotionBySubject(runMotions: number[]): number {
  if (runMotions.length === 0) return 0;
  return Math.max(...runMotions);
}

export function aggregateMeanSd<T>(
  rows: T[],
  val: (r: T) => number | undefined,
): { mean: number | null; sd: number | null } {
  const vals = rows
    .filter((r) => (r as Record<string, unknown>).verdict === "pass")
    .map(val)
    .filter((v): v is number => v !== undefined);
  if (vals.length === 0) return { mean: null, sd: null };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (vals.length < 2) return { mean, sd: null };
  const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (vals.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

export function formatMeanSd(stats: { mean: number | null; sd: number | null }): string {
  if (stats.mean === null) return "N/A";
  if (stats.sd === null) return `${stats.mean.toFixed(2)} (N/A)`;
  return `${stats.mean.toFixed(2)} (${stats.sd.toFixed(2)})`;
}

export function aggregateFailReasons<T extends { verdict: string; reason?: string }>(
  rows: T[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.verdict === "fail" && r.reason) {
      counts[r.reason] = (counts[r.reason] ?? 0) + 1;
    }
  }
  return counts;
}

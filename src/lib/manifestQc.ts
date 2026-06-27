import { exists, readTextFile } from "@tauri-apps/plugin-fs";

export interface SubjectQcOutputs {
  coverage: number;
  spatialCov: number;
  motion: number[];
  motionExclusionPct: number;
}

/**
 * Reads the QC outputs for a single subject session.
 * Capitalizes 'Population' directory for case-sensitivity on Linux.
 * Within-subject motion exclusion percentage is aggregated as mean across runs (Issue 8).
 */
export async function readSubjectQcOutputs(
  projectRoot: string,
  subjectSession: string,
): Promise<SubjectQcOutputs | null> {
  const popDir = `${projectRoot}/derivatives/ExploreASL/Population`;

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
    let runCount = 0;
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
          runCount++;
          break;
        }
      }
    }

    // Mean within-subject motion exclusion percentage across runs
    const finalMotionExclusionPct = runCount > 0 ? motionExclusionPct / runCount : 0;

    return { coverage, spatialCov, motion, motionExclusionPct: finalMotionExclusionPct };
  } catch {
    return null;
  }
}

async function readTsvToMap(
  filePath: string,
  valueKey: string,
): Promise<Map<string, number> | null> {
  if (!(await exists(filePath))) return null;
  try {
    const raw = await readTextFile(filePath);
    const lines = raw.trim().split("\n");
    if (lines.length <= 1) return new Map();
    const header = lines[0].split("\t");
    const subjIdx = header.indexOf("SubjectSession");
    const valIdx = header.indexOf(valueKey);
    if (subjIdx === -1 || valIdx === -1) return new Map();
    const map = new Map<string, number>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols[subjIdx]) {
        map.set(cols[subjIdx], parseFloat(cols[valIdx]) || 0);
      }
    }
    return map;
  } catch {
    return null;
  }
}

async function readMotionFiles(
  popDir: string,
): Promise<Map<string, { motion: number[]; exclusion: number; runCount: number }> | null> {
  const result = new Map<string, { motion: number[]; exclusion: number; runCount: number }>();
  let hasAny = false;
  for (let run = 1; run <= 10; run++) {
    const runStr = String(run).padStart(2, "0");
    const motionPath = `${popDir}/Motion_${runStr}.tsv`;
    if (!(await exists(motionPath))) {
      break;
    }
    hasAny = true;
    try {
      const raw = await readTextFile(motionPath);
      const lines = raw.trim().split("\n");
      if (lines.length <= 1) continue;
      const header = lines[0].split("\t");
      const subjIdx = header.indexOf("SubjectSession");
      const motionIdx = header.indexOf("MeanMotion_rms");
      const exclIdx = header.indexOf("MotionExclusionPct");
      if (subjIdx === -1 || motionIdx === -1 || exclIdx === -1) continue;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        const subj = cols[subjIdx];
        if (subj) {
          let entry = result.get(subj);
          if (!entry) {
            entry = { motion: [], exclusion: 0, runCount: 0 };
            result.set(subj, entry);
          }
          entry.motion.push(parseFloat(cols[motionIdx]) || 0);
          entry.exclusion += parseFloat(cols[exclIdx]) || 0;
          entry.runCount += 1;
        }
      }
    } catch {
      // Ignore errors for individual run files
    }
  }
  return hasAny ? result : null;
}

/**
 * Optimizes filesystem access by reading the study-level Coverage, SpatialCoV,
 * and Motion TSV files once, mapping values into memory for all subjects.
 */
export async function readAllSubjectQcOutputs(
  projectRoot: string,
): Promise<Record<string, SubjectQcOutputs> | null> {
  const popDir = `${projectRoot}/derivatives/ExploreASL/Population`;

  const coverageMap = await readTsvToMap(`${popDir}/Coverage.tsv`, "Coverage");
  if (!coverageMap) return null;

  const covMap = await readTsvToMap(`${popDir}/SpatialCoV.tsv`, "SpatialCoV");
  if (!covMap) return null;

  const motionMap = await readMotionFiles(popDir);
  if (!motionMap) return null;

  const result: Record<string, SubjectQcOutputs> = {};
  for (const ss of coverageMap.keys()) {
    const coverage = coverageMap.get(ss) ?? 0;
    const spatialCov = covMap.get(ss) ?? 0;
    const motionData = motionMap.get(ss) ?? { motion: [], exclusion: 0, runCount: 0 };
    const motionExclusionPct =
      motionData.runCount > 0 ? motionData.exclusion / motionData.runCount : 0;

    result[ss] = {
      coverage,
      spatialCov,
      motion: motionData.motion,
      motionExclusionPct,
    };
  }
  return result;
}

export function aggregateMotionBySubject(runMotions: number[]): number | null {
  if (runMotions.length === 0) return null;
  return Math.max(...runMotions);
}

export function aggregateMeanSd<T extends { verdict: string }>(
  rows: T[],
  val: (r: T) => number | undefined,
): { mean: number | null; sd: number | null } {
  const vals = rows
    .filter((r) => r.verdict === "pass")
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

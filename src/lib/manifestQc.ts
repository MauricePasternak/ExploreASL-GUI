import { commands, unwrap } from "./ipc";
import type { SubjectQcOutputs_Serialize } from "../generated/bindings";

/** Nonfinite native motion values serialize as null, not valid motion samples. */
export type SubjectQcOutputs = Omit<SubjectQcOutputs_Serialize, "motion"> & { motion: number[] };

/**
 * Optimizes filesystem access by calling the Tauri backend's batch fetching command.
 */
export async function readAllSubjectQcOutputs(
  projectRoot: string,
  subjectSessions?: string[],
): Promise<Record<string, SubjectQcOutputs> | null> {
  if (!subjectSessions || subjectSessions.length === 0) {
    return null;
  }
  try {
    const raw = await unwrap(commands.getAllSubjectsQc(projectRoot, subjectSessions));
    return Object.fromEntries(
      Object.entries(raw).map(([subject, qc]) => [
        subject,
        {
          ...qc,
          motion: qc.motion.filter(
            (value): value is number => value !== null && Number.isFinite(value),
          ),
        },
      ]),
    );
  } catch (err) {
    console.warn("[manifestQc] failed to get batch QC from Tauri backend", err);
    return null;
  }
}

export function aggregateMotionBySubject(runMotions: number[]): number | null {
  if (runMotions.length === 0) return null;
  return Math.max(...runMotions);
}

export function aggregateMeanSd<T extends { verdict: string }>(
  rows: T[],
  val: (r: T) => number | null | undefined,
): { mean: number | null; sd: number | null } {
  const vals = rows
    .filter((r) => r.verdict === "pass")
    .map(val)
    .filter((v): v is number => v !== undefined && v !== null);
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

import type { SubjectModuleStatus } from "../../schemas/processingSchemas";
import { aslRunsEqual, normalizeAslRunId } from "../../lib/aslRun";

/**
 * Index of `SubjectModuleStatus` entries keyed by `${subjectSession}|${module}`.
 *
 * Built once per `subjectStatuses` change so consumers can do O(1) lookups
 * instead of O(T) linear scans per subject.
 */
export type SubjectStatusIndex = Map<string, SubjectModuleStatus[]>;

function key(subjectSession: string, module: string): string {
  return `${subjectSession}|${module}`;
}

export function indexSubjectStatuses(statuses: SubjectModuleStatus[]): SubjectStatusIndex {
  const map: SubjectStatusIndex = new Map();
  for (const s of statuses) {
    const k = key(s.subjectSession ?? "", s.module);
    const list = map.get(k);
    if (list) {
      list.push(s);
    } else {
      map.set(k, [s]);
    }
  }
  return map;
}

export function getEntriesFor(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: string,
): SubjectModuleStatus[] {
  return index.get(key(subjectSession, module)) ?? [];
}

/**
 * Returns the entry matching the requested run, or (when `run` is undefined)
 * the first entry for the subject/module (mirrors the legacy linear-scan
 * semantics where `runMatches(s.run, undefined)` is always true).
 *
 * Run matching uses `aslRunsEqual` so "01" matches "1" etc.
 */
export function getEntryFor(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: string,
  run?: string,
): SubjectModuleStatus | undefined {
  const entries = getEntriesFor(index, subjectSession, module);
  if (run === undefined) {
    return entries[0];
  }
  return entries.find((e) => aslRunsEqual(e.run, run));
}

/**
 * Union of normalized run ids for an ASL subject, drawn from the SubjectInfo
 * `aslRuns` and any lock statuses recorded with a run. Sorted numerically.
 *
 * Returns ["1"] when no runs are recorded.
 */
export function collectAslRuns(
  aslRuns: string[] | undefined,
  statuses: SubjectModuleStatus[],
): string[] {
  const fromSubject = (aslRuns ?? []).map(normalizeAslRunId);
  const fromLock = statuses.filter((s) => s.run !== undefined).map((s) => normalizeAslRunId(s.run));
  const union = Array.from(new Set([...fromSubject, ...fromLock]));
  if (union.length === 0) return ["1"];
  return union.sort((a, b) => Number(a) - Number(b));
}

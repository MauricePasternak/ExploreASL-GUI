import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { aslRunsEqual, normalizeAslRunId } from "../../lib/aslRun";

export type ModuleName = (typeof PROCESSING_MODULES)[number];

export interface StepStatus {
  name: string;
  status: "pending" | "running" | "complete";
}

function runMatches(entryRun: string | undefined, requestedRun: string | undefined): boolean {
  if (requestedRun === undefined) return true;
  return aslRunsEqual(entryRun, requestedRun);
}

export function getStepsForSubject(
  subjectSession: string,
  module: ModuleName,
  statuses: SubjectModuleStatus[],
  run?: string,
): StepStatus[] {
  const entry = statuses.find(
    (s) => s.subjectSession === subjectSession && s.module === module && runMatches(s.run, run),
  );
  if (!entry) return [];
  const steps: StepStatus[] = entry.completedSteps.map((name) => ({
    name,
    status: "complete" as const,
  }));
  if (entry.locked && entry.status !== "complete") {
    steps.push({ name: "Processing...", status: "running" });
  }
  return steps;
}

export function getStatusForSubject(
  subjectSession: string,
  module: ModuleName,
  statuses: SubjectModuleStatus[],
  run?: string,
): SubjectModuleStatus | undefined {
  return statuses.find(
    (s) => s.subjectSession === subjectSession && s.module === module && runMatches(s.run, run),
  );
}

export function getRunsForSubjectInfo(
  subject: SubjectInfo,
  statuses: SubjectModuleStatus[],
): string[] {
  const fromSubject = (subject.aslRuns ?? []).map(normalizeAslRunId);
  const fromLock = statuses
    .filter(
      (s) =>
        s.subjectSession === subject.subjectSession && s.module === "asl" && s.run !== undefined,
    )
    .map((s) => normalizeAslRunId(s.run));
  const union = Array.from(new Set([...fromSubject, ...fromLock]));
  if (union.length === 0) {
    return ["1"];
  }
  return union.sort((a, b) => Number(a) - Number(b));
}

export function getSubjectOverallStatus(
  subjectSession: string,
  module: ModuleName,
  statuses: SubjectModuleStatus[],
): {
  status: SubjectModuleStatus["status"];
  locked: boolean;
  completedRunsCount: number;
} {
  const subjectStatuses = statuses.filter(
    (s) => s.subjectSession === subjectSession && s.module === module,
  );

  if (subjectStatuses.length === 0) {
    return { status: "pending", locked: false, completedRunsCount: 0 };
  }

  const locked = subjectStatuses.some((s) => s.locked);
  const completedRunsCount = subjectStatuses.filter((s) => s.status === "complete").length;

  let status: SubjectModuleStatus["status"] = "pending";
  if (subjectStatuses.every((s) => s.status === "complete")) {
    status = "complete";
  } else if (
    subjectStatuses.some(
      (s) => s.status === "complete" || s.status === "incomplete" || s.status === "outdated",
    )
  ) {
    status = "incomplete";
  }

  return { status, locked, completedRunsCount };
}

export function calcModuleProgress(
  subjects: SubjectInfo[],
  module: ModuleName,
  statuses: SubjectModuleStatus[],
): { complete: number; total: number } {
  const eligible = subjects.filter((s) => {
    if (module === "structural") return s.hasStructural;
    if (module === "asl") return s.hasASL;
    return true;
  });

  const complete = eligible.filter((s) => {
    const { status } = getSubjectOverallStatus(s.subjectSession, module, statuses);
    return status === "complete";
  }).length;

  return { complete, total: eligible.length };
}

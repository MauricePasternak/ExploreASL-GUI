import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import {
  collectAslRuns,
  getEntriesFor,
  getEntryFor,
  type SubjectStatusIndex,
} from "./subjectStatusIndex";

export type ModuleName = (typeof PROCESSING_MODULES)[number];

export interface StepStatus {
  name: string;
  status: "pending" | "running" | "complete";
}

export function getStepsForSubject(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: ModuleName,
  run?: string,
): StepStatus[] {
  const entry = getEntryFor(index, subjectSession, module, run);
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
  index: SubjectStatusIndex,
  subjectSession: string,
  module: ModuleName,
  run?: string,
): SubjectModuleStatus | undefined {
  return getEntryFor(index, subjectSession, module, run);
}

export function getRunsForSubjectInfo(subject: SubjectInfo, index: SubjectStatusIndex): string[] {
  const aslEntries = getEntriesFor(index, subject.subjectSession, "asl");
  return collectAslRuns(subject.aslRuns, aslEntries);
}

export function getSubjectOverallStatus(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: ModuleName,
): {
  status: SubjectModuleStatus["status"];
  locked: boolean;
  completedRunsCount: number;
} {
  const subjectStatuses = getEntriesFor(index, subjectSession, module);
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
  index: SubjectStatusIndex,
): { complete: number; total: number } {
  const eligible = subjects.filter((s) => {
    if (module === "structural") return s.hasStructural;
    if (module === "asl") return s.hasASL;
    return true;
  });

  const complete = eligible.filter((s) => {
    const { status } = getSubjectOverallStatus(index, s.subjectSession, module);
    return status === "complete";
  }).length;

  return { complete, total: eligible.length };
}

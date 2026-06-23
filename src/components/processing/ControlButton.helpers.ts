import { IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";

import type { ProcessingPhase, SubjectModuleStatus } from "../../schemas/processingSchemas";

export interface CompletedSubjectEntry {
  subjectSession: string;
  modules: string[];
}

export function getButtonProps(phase: ProcessingPhase) {
  switch (phase) {
    case "running":
      return { label: "Stop", color: "red", icon: IconPlayerStop, action: "kill" as const };
    case "preparing":
      return { label: "Stop", color: "red", icon: IconPlayerStop, action: "kill" as const };
    case "idle":
    case "completed":
    case "failed":
    case "cancelled":
    default:
      return { label: "Start", color: "teal", icon: IconPlayerPlay, action: "start" as const };
  }
}

/**
 * Given the current processing config and subject statuses, find subjects
 * that have already completed processing for the selected Structural and/or
 * ASL modules. Only "complete" status triggers (not "outdated", "pending", etc.).
 * Population module is excluded from this check.
 */
export function findCompletedSubjects(
  selectedSubjects: string[],
  selectedModules: string[],
  subjectStatuses: SubjectModuleStatus[],
): CompletedSubjectEntry[] {
  const relevantModules = selectedModules.filter((m) => m === "structural" || m === "asl");
  if (relevantModules.length === 0) return [];

  const subjectsToCheck = selectedSubjects.length > 0 ? selectedSubjects : [];
  if (subjectsToCheck.length === 0) return [];

  const result: CompletedSubjectEntry[] = [];

  for (const subjectSession of subjectsToCheck) {
    const completedModules: string[] = [];
    for (const mod of relevantModules) {
      const status = subjectStatuses.find(
        (s) => s.subjectSession === subjectSession && s.module === mod,
      );
      if (status?.status === "complete") {
        completedModules.push(mod);
      }
    }
    if (completedModules.length > 0) {
      result.push({ subjectSession, modules: completedModules });
    }
  }

  return result;
}

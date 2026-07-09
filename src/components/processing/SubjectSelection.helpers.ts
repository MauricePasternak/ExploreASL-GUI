import type { LogFileInfo } from "../../lib/logViewer";
import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";

export type ModuleDisplayStatus = "complete" | "incomplete" | "pending" | "skipped" | "outdated";

export type LogBadgeVariant = "errors" | "logs" | "no-logs";

export function resolveLogBadge(
  moduleStatus: ModuleDisplayStatus,
  logFiles: LogFileInfo[] | undefined,
): LogBadgeVariant {
  if (!logFiles || logFiles.length === 0) {
    return moduleStatus === "incomplete" ? "errors" : "no-logs";
  }
  return moduleStatus === "incomplete" ? "errors" : "logs";
}

export function resolveModuleDisplay(
  subjectInfo: SubjectInfo,
  module: "structural" | "asl",
  statuses: SubjectModuleStatus[],
  missingBids2LegacySubjectSessions: ReadonlySet<string> = new Set(),
): ModuleDisplayStatus {
  if (module === "structural" && !subjectInfo.hasStructural) return "skipped";
  if (module === "asl" && !subjectInfo.hasASL) return "skipped";

  const entry = statuses.find(
    (s) => s.subjectSession === subjectInfo.subjectSession && s.module === module,
  );
  if (!entry) return "pending";
  if (entry.status === "complete") {
    return missingBids2LegacySubjectSessions.has(subjectInfo.subjectSession)
      ? "outdated"
      : "complete";
  }
  if (entry.status === "incomplete") return "incomplete";
  if (entry.status === "outdated") return "outdated";
  return "pending";
}

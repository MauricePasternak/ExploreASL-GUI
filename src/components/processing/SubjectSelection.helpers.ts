import type { LogFileInfo } from "../../lib/logViewer";
import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import { getEntriesFor, type SubjectStatusIndex } from "./subjectStatusIndex";

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
): ModuleDisplayStatus {
  if (module === "structural" && !subjectInfo.hasStructural) return "skipped";
  if (module === "asl" && !subjectInfo.hasASL) return "skipped";

  const entry = statuses.find(
    (s) => s.subjectSession === subjectInfo.subjectSession && s.module === module,
  );
  if (!entry) return "pending";
  if (entry.status === "complete") {
    return entry.bids2legacyExists === false ? "outdated" : "complete";
  }
  if (entry.status === "incomplete") return "incomplete";
  if (entry.status === "outdated") return "outdated";
  return "pending";
}

/**
 * Indexed variant of `resolveModuleDisplay` — O(1) lookup instead of O(T) scan.
 * Falls back to scanning `statuses` if no index is provided.
 */
export function resolveModuleDisplayFromIndex(
  subjectInfo: SubjectInfo,
  module: "structural" | "asl",
  index: SubjectStatusIndex,
): ModuleDisplayStatus {
  if (module === "structural" && !subjectInfo.hasStructural) return "skipped";
  if (module === "asl" && !subjectInfo.hasASL) return "skipped";

  const entries = getEntriesFor(index, subjectInfo.subjectSession, module);
  const entry = entries[0];
  if (!entry) return "pending";
  if (entry.status === "complete") {
    return entry.bids2legacyExists === false ? "outdated" : "complete";
  }
  if (entry.status === "incomplete") return "incomplete";
  if (entry.status === "outdated") return "outdated";
  return "pending";
}

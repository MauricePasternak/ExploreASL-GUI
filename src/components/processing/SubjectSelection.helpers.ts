import type { LogFileInfo } from "../../lib/logViewer";

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

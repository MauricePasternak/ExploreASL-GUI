import { z } from "zod";

/**
 * Format a Zod error into a clean, human-readable multiline message.
 * Specially tailored for metadata group scanning validation.
 */
export function formatBidsScanValidationError(
  err: z.ZodError,
  groupsWithId: Array<{ label?: string; [key: string]: unknown }>,
): string {
  const lines = ["BIDS scanner validation failed:"];
  for (const issue of err.issues) {
    const path = issue.path;
    if (path.length >= 3 && typeof path[0] === "number" && path[1] === "bidsParams") {
      const idx = path[0];
      const field = String(path[2]);
      const groupName = groupsWithId[idx]?.label || `Group ${idx + 1}`;
      lines.push(`• Field "${field}" in group "${groupName}": ${issue.message}`);
    } else if (path.length >= 1 && typeof path[0] === "number") {
      const idx = path[0];
      const groupName = groupsWithId[idx]?.label || `Group ${idx + 1}`;
      const subPath = path.slice(1).join(".");
      lines.push(`• Group "${groupName}" (path: ${subPath}): ${issue.message}`);
    } else {
      lines.push(`• ${path.join(".") || "Root"}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

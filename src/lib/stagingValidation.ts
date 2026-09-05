import { caseFold } from "unicode-case-folding";

export const STAGING_FIELDS = [
  "subject",
  "session",
  "run",
  "runAlias",
  "modality",
  "sourcePath",
  "destination",
] as const;
export type StagingValidationField = (typeof STAGING_FIELDS)[number];

export type StagingValidationCode =
  | "EMPTY_COMPONENT"
  | "TRAVERSAL_COMPONENT"
  | "ABSOLUTE_COMPONENT"
  | "SEPARATOR_COMPONENT"
  | "CONTROL_COMPONENT"
  | "FORBIDDEN_CHARACTER"
  | "TRAILING_DOT_OR_SPACE"
  | "NON_NFC_COMPONENT"
  | "RESERVED_BASENAME"
  | "INVALID_SUBJECT"
  | "INVALID_MODALITY"
  | "PORTABLE_COLLISION";

export interface StagingValidationIssue {
  code: StagingValidationCode | string;
  field: StagingValidationField;
  entryIndex?: number;
  conflictingEntryIndex?: number;
  message: string;
  suggestion?: string;
}

const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CLOCK$",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
  "COM¹",
  "COM²",
  "COM³",
  "LPT¹",
  "LPT²",
  "LPT³",
]);

export function portableKey(value: string): string {
  return caseFold(value.normalize("NFC"));
}

export function componentValidationMessage(value: string): string | undefined {
  if (value.length === 0) return "Identifier must not be empty.";
  if (value === "." || value === "..") return "Identifier must not be a traversal component.";
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return "Identifier must not be absolute.";
  if (value.includes("/") || value.includes("\\"))
    return "Identifier must not contain a path separator.";
  if (/\p{Cc}/u.test(value)) return "Identifier must not contain a control character.";
  if (/[<>:"|?*]/.test(value)) return "Identifier contains a Windows-forbidden character.";
  if (/[. ]$/.test(value)) return "Identifier must not end with a period or space.";
  if (value !== value.normalize("NFC")) return "Identifier must already use NFC normalization.";
  const basename = value.split(".", 1)[0];
  if (WINDOWS_RESERVED.has(portableKey(basename).toUpperCase())) {
    return "Identifier uses a reserved Windows device basename.";
  }
  return undefined;
}

export function suggestPortableComponent(value: string): string | undefined {
  const suggestion = value
    .normalize("NFC")
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, "-")
    .replace(/[. ]+$/u, "")
    .replace(/^-+|-+$/gu, "");
  if (
    !suggestion ||
    suggestion === "." ||
    suggestion === ".." ||
    componentValidationMessage(suggestion)
  ) {
    return undefined;
  }
  return suggestion === value ? undefined : suggestion;
}

export function sortStagingIssues(issues: StagingValidationIssue[]): StagingValidationIssue[] {
  return [...issues].sort((left, right) => {
    const leftIndex = left.entryIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.entryIndex ?? Number.MAX_SAFE_INTEGER;
    return (
      leftIndex - rightIndex ||
      left.field.localeCompare(right.field) ||
      left.code.localeCompare(right.code) ||
      (left.conflictingEntryIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.conflictingEntryIndex ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

export function portableCollisionIssues(
  values: Array<{ value: string; entryIndex: number }>,
  field: Extract<StagingValidationField, "subject" | "session" | "run" | "runAlias">,
): StagingValidationIssue[] {
  const byKey = new Map<string, Array<{ value: string; entryIndex: number }>>();
  for (const value of values) {
    const group = byKey.get(portableKey(value.value)) ?? [];
    group.push(value);
    byKey.set(portableKey(value.value), group);
  }
  const issues: StagingValidationIssue[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      for (const conflict of group) {
        if (entry.entryIndex === conflict.entryIndex) continue;
        issues.push({
          code: "PORTABLE_COLLISION",
          field,
          entryIndex: entry.entryIndex,
          conflictingEntryIndex: conflict.entryIndex,
          message: "Identifier collides with another value under portable filesystem rules.",
        });
      }
    }
  }
  return sortStagingIssues(issues);
}

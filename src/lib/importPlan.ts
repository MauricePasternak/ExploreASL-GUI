import type {
  ModalityAlias,
  PathPattern,
  SessionAlias,
  SourcestructureJson,
  StagingEntry,
  StagingMappingByPattern,
  StudyParJson,
  SubjectRename,
  TokenAssignment,
} from "../schemas/importSchemas";
import {
  StagingModalitySchema,
  StagingSubjectSchema,
  PortableStagingComponentSchema,
} from "../schemas/importSchemas";
import {
  componentValidationMessage,
  portableKey,
  sortStagingIssues,
  suggestPortableComponent,
  type StagingValidationField,
  type StagingValidationIssue,
} from "./stagingValidation";
import { buildAllStagingMappings } from "./importPreviewUtils";
import { assembleSourcestructure, assembleStudyPar } from "./tokenizerUtils";
import type { MetadataGroup, SubjectRow } from "../schemas/importSchemas";

export interface ImportPlanInput {
  rawPaths: string[];
  sourceRoot: string;
  pathPatterns: PathPattern[];
  tokenizerConfigs: Record<string, TokenAssignment[]>;
  subjectRenames: SubjectRename[];
  sessionAliases: SessionAlias[];
  runAliases: SessionAlias[];
  modalityAliases: ModalityAlias[];
  tokenSubDelimiters: string[];
  bMatchDirectories: boolean;
  metadataGroups: MetadataGroup[];
  subjectRows: SubjectRow[];
}

export interface ImportPlan {
  mappings: StagingMappingByPattern[];
  entries: StagingEntry[];
  sourcestructureJson: SourcestructureJson;
  studyparJson: StudyParJson;
  localIssues: StagingValidationIssue[];
  fingerprintInput: Omit<ImportPlanInput, "metadataGroups" | "subjectRows"> & {
    sourcestructureJson: SourcestructureJson;
    studyparJson: StudyParJson;
  };
}

export function selectImportEntries(
  entries: StagingEntry[],
  subjects: readonly string[],
): StagingEntry[] {
  const subjectKeys = new Set(subjects.map(portableKey));
  return entries.filter((entry) => subjectKeys.has(portableKey(entry.subject)));
}

function issueCode(value: string): StagingValidationIssue["code"] {
  if (value.length === 0) return "EMPTY_COMPONENT";
  if (value === "." || value === "..") return "TRAVERSAL_COMPONENT";
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return "ABSOLUTE_COMPONENT";
  if (value.includes("/") || value.includes("\\")) return "SEPARATOR_COMPONENT";
  if (/\p{Cc}/u.test(value)) return "CONTROL_COMPONENT";
  if (/[<>:"|?*]/.test(value)) return "FORBIDDEN_CHARACTER";
  if (/[. ]$/u.test(value)) return "TRAILING_DOT_OR_SPACE";
  if (value !== value.normalize("NFC")) return "NON_NFC_COMPONENT";
  return "RESERVED_BASENAME";
}

function uniqueSuggestion(
  value: string,
  existing: Iterable<string>,
  subject: boolean,
): string | undefined {
  const base = subject
    ? value
        .normalize("NFC")
        .replace(/^sub-/i, "")
        .replace(/[^A-Za-z0-9]/g, "")
    : suggestPortableComponent(value);
  if (
    !base ||
    (subject
      ? !StagingSubjectSchema.safeParse(base).success
      : !PortableStagingComponentSchema.safeParse(base).success)
  ) {
    return undefined;
  }
  const used = new Set(Array.from(existing, portableKey));
  if (!used.has(portableKey(base))) return base === value ? undefined : base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(portableKey(candidate))) return candidate;
  }
  return undefined;
}

function componentIssues(entries: StagingEntry[]): StagingValidationIssue[] {
  const issues: StagingValidationIssue[] = [];
  const targetValues: Record<"subject" | "session" | "runAlias", string[]> = {
    subject: entries.map((entry) => entry.subject),
    session: entries.map((entry) => entry.session),
    runAlias: entries.map((entry) => entry.runAlias),
  };
  const fields: Array<[StagingValidationField, (entry: StagingEntry) => string]> = [
    ["subject", (entry) => entry.subject],
    ["session", (entry) => entry.session],
    ["run", (entry) => entry.run],
    ["runAlias", (entry) => entry.runAlias],
    ["modality", (entry) => entry.modality],
  ];
  entries.forEach((entry, entryIndex) => {
    for (const [field, getValue] of fields) {
      const value = getValue(entry);
      const message =
        field === "subject"
          ? StagingSubjectSchema.safeParse(value).error?.issues[0]?.message
          : field === "modality"
            ? StagingModalitySchema.safeParse(value).error?.issues[0]?.message
            : componentValidationMessage(value);
      if (!message) continue;
      const suggestion =
        field === "subject"
          ? uniqueSuggestion(value, targetValues.subject, true)
          : field === "session" || field === "runAlias"
            ? uniqueSuggestion(value, targetValues[field], false)
            : undefined;
      issues.push({
        code:
          field === "subject" && !componentValidationMessage(value)
            ? "INVALID_SUBJECT"
            : field === "modality"
              ? "INVALID_MODALITY"
              : issueCode(value),
        field,
        entryIndex,
        message,
        ...(suggestion ? { suggestion } : {}),
      });
    }
  });
  return issues;
}

function originalTargetCollisions(
  entries: StagingEntry[],
  field: "subject" | "session" | "runAlias",
  original: (entry: StagingEntry) => string,
): StagingValidationIssue[] {
  const groups = new Map<string, number[]>();
  entries.forEach((entry, entryIndex) => {
    const value = entry[field];
    const indexes = groups.get(portableKey(value)) ?? [];
    indexes.push(entryIndex);
    groups.set(portableKey(value), indexes);
  });
  const issues: StagingValidationIssue[] = [];
  for (const indexes of groups.values()) {
    for (let leftPosition = 0; leftPosition < indexes.length; leftPosition += 1) {
      for (
        let rightPosition = leftPosition + 1;
        rightPosition < indexes.length;
        rightPosition += 1
      ) {
        const left = indexes[leftPosition];
        const right = indexes[rightPosition];
        if (original(entries[left]) === original(entries[right])) continue;
        for (const [entryIndex, conflictingEntryIndex] of [
          [left, right],
          [right, left],
        ] as const) {
          issues.push({
            code: "PORTABLE_COLLISION",
            field,
            entryIndex,
            conflictingEntryIndex,
            message: "Distinct original identifiers share a portable target.",
          });
        }
      }
    }
  }
  return issues;
}

function destinationCollisions(entries: StagingEntry[]): StagingValidationIssue[] {
  const groups = new Map<string, number[]>();
  entries.forEach((entry, entryIndex) => {
    const key = [entry.subject, entry.session, entry.run, entry.modality]
      .map(portableKey)
      .join("\0");
    groups.set(key, [...(groups.get(key) ?? []), entryIndex]);
  });
  const issues: StagingValidationIssue[] = [];
  for (const indexes of groups.values()) {
    for (let leftPosition = 0; leftPosition < indexes.length; leftPosition += 1) {
      for (
        let rightPosition = leftPosition + 1;
        rightPosition < indexes.length;
        rightPosition += 1
      ) {
        const left = indexes[leftPosition];
        const right = indexes[rightPosition];
        const leftEntry = entries[left];
        const rightEntry = entries[right];
        const sameOriginalTuple =
          leftEntry.originalSubject === rightEntry.originalSubject &&
          leftEntry.originalSession === rightEntry.originalSession &&
          leftEntry.originalRun === rightEntry.originalRun;
        const sameFinalSpelling =
          leftEntry.subject === rightEntry.subject &&
          leftEntry.session === rightEntry.session &&
          leftEntry.run === rightEntry.run &&
          leftEntry.modality === rightEntry.modality;
        if (sameOriginalTuple && sameFinalSpelling) continue;
        for (const [entryIndex, conflictingEntryIndex] of [
          [left, right],
          [right, left],
        ] as const) {
          issues.push({
            code: "PORTABLE_COLLISION",
            field: "destination",
            entryIndex,
            conflictingEntryIndex,
            message:
              "Only exactly spelled destinations from one original logical tuple may share a directory.",
          });
        }
      }
    }
  }
  return issues;
}

export function validateLocalStagingEntries(entries: StagingEntry[]): StagingValidationIssue[] {
  return sortStagingIssues([
    ...componentIssues(entries),
    ...originalTargetCollisions(entries, "subject", (entry) => entry.originalSubject),
    ...originalTargetCollisions(entries, "session", (entry) => entry.originalSession),
    ...originalTargetCollisions(entries, "runAlias", (entry) => entry.originalRun),
    ...destinationCollisions(entries),
  ]);
}

/** One current mapping build used by Preview, preflight, and Import Execution. */
export function buildImportPlan(input: ImportPlanInput): ImportPlan {
  const subjectRenames = Object.fromEntries(
    input.subjectRenames.map((rename) => [rename.original, rename.target]),
  );
  const mappings = buildAllStagingMappings(
    input.rawPaths,
    input.sourceRoot,
    input.pathPatterns,
    input.tokenizerConfigs,
    subjectRenames,
    input.sessionAliases,
    input.runAliases,
    input.modalityAliases,
    input.tokenSubDelimiters,
  );
  const entries = mappings.flatMap((mapping) => mapping.entries);
  const sourcestructureJson = assembleSourcestructure(
    input.sessionAliases,
    input.runAliases,
    input.modalityAliases,
    input.bMatchDirectories,
  );
  const studyparJson = assembleStudyPar(
    input.metadataGroups,
    input.subjectRows,
    input.sessionAliases,
  );
  return {
    mappings,
    entries,
    sourcestructureJson,
    studyparJson,
    localIssues: validateLocalStagingEntries(entries),
    fingerprintInput: {
      ...input,
      sourcestructureJson,
      studyparJson,
    },
  };
}

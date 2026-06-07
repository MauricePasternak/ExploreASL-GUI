import type {
  MetadataGroup,
  ModalityAlias,
  PathPattern,
  SessionAlias,
  SourcestructureJson,
  StagingEntry,
  StudyParJson,
  TokenAssignment,
  TokenTag,
} from "../schemas/importSchemas";
import { getRelativePath, splitBySubDelimiters } from "./pathUtils";

/**
 * Generate the folderHierarchy regex array from token assignments.
 *
 * For each folder depth level in the pattern:
 * - If a block at that level has a tag (Subject/Session/Run/Modality): `^(.*)$` (capture group)
 * - If a block is tagged Ignore: `^.*$` (no capture)
 * - If a block has multiple sub-block assignments: constructs a regex with
 *   multiple capture groups using the original delimiters
 *
 * The result always has `pattern.depth` entries.
 */
export function generateFolderHierarchy(
  assignments: TokenAssignment[],
  pattern: PathPattern,
  tokenSubDelimiters: string[] = ["_"],
): string[] {
  const hierarchy: string[] = [];

  for (let i = 0; i < pattern.depth; i++) {
    const blockAssignments = assignments.filter((a) => a.blockIndex === i);

    if (blockAssignments.length === 0) {
      // No assignment for this level → ignore (no capture)
      hierarchy.push("^.*$");
    } else if (blockAssignments.length === 1 && blockAssignments[0].subBlockIndex === null) {
      // Single whole-level assignment
      if (blockAssignments[0].tag === "Ignore") {
        hierarchy.push("^.*$");
      } else {
        hierarchy.push("^(.*)$");
      }
    } else {
      // Multiple sub-block assignments at this level
      // Build a regex with capture groups for tagged sub-blocks
      // and non-capturing groups for Ignored sub-blocks
      //
      // We need the delimiter structure from the sample path
      const sampleFolderName = pattern.blocks[i];
      const parts = splitFolderByDelimiters(sampleFolderName, tokenSubDelimiters);
      const regexParts: string[] = [];

      for (let j = 0; j < parts.segments.length; j++) {
        const assignment = blockAssignments.find((a) => a.subBlockIndex === j);
        if (assignment && assignment.tag !== "Ignore") {
          regexParts.push("(.*)");
        } else {
          regexParts.push(".*");
        }

        // Add delimiter after segment (if not the last one)
        if (j < parts.delimiters.length) {
          regexParts.push(escapeRegex(parts.delimiters[j]));
        }
      }

      hierarchy.push(`^${regexParts.join("")}$`);
    }
  }

  return hierarchy;
}

/**
 * Generate ExploreASL tokenOrdering from assignments.
 *
 * ExploreASL tokenOrdering: [Subject, Visit, Session, Scan]
 * GUI terminology mapping:
 *   - GUI "Subject"  → ExploreASL "Subject" (index 0 in tokenOrdering)
 *   - GUI "Session"  → ExploreASL "Visit"   (index 1 in tokenOrdering)
 *   - GUI "Run"      → ExploreASL "Session" (index 2 in tokenOrdering)
 *   - GUI "Modality" → ExploreASL "Scan"    (index 3 in tokenOrdering)
 *
 * Values are 0-based capture group indices. -1 means "not captured".
 *
 * The capture group index is determined by counting how many capture groups
 * appear in the folderHierarchy up to and including the assignment's position.
 */
export function generateTokenOrdering(
  assignments: TokenAssignment[],
  folderHierarchy: string[],
): [number, number, number, number] {
  // Map each semantic tag to its capture group index
  const tagToGroupIndex = new Map<TokenTag, number>();

  // Count capture groups sequentially across the hierarchy
  let groupIndex = 0;
  for (let level = 0; level < folderHierarchy.length; level++) {
    const regex = folderHierarchy[level];
    // Count capture groups in this regex entry
    const captureGroups = countCaptureGroups(regex);

    // Find assignments for this level, sorted by subBlockIndex
    const levelAssignments = assignments
      .filter((a) => a.blockIndex === level && a.tag !== "Ignore")
      .sort((a, b) => (a.subBlockIndex ?? 0) - (b.subBlockIndex ?? 0));

    for (const assignment of levelAssignments) {
      if (!tagToGroupIndex.has(assignment.tag)) {
        tagToGroupIndex.set(assignment.tag, groupIndex);
      }
      groupIndex++;
    }

    // Account for any capture groups not associated with an assignment
    // (shouldn't happen in normal flow, but be robust)
    const assignedCount = levelAssignments.length;
    if (captureGroups > assignedCount) {
      groupIndex += captureGroups - assignedCount;
    }
  }

  // Map GUI tags to ExploreASL ordering positions
  return [
    tagToGroupIndex.get("Subject") ?? -1,   // Subject → ExploreASL Subject
    tagToGroupIndex.get("Session") ?? -1,    // Session → ExploreASL Visit
    tagToGroupIndex.get("Run") ?? -1,        // Run → ExploreASL Session
    tagToGroupIndex.get("Modality") ?? -1,   // Modality → ExploreASL Scan
  ];
}

/**
 * Count the number of capture groups in a regex string.
 * Counts occurrences of `(` that are NOT preceded by `\` or followed by `?`.
 */
function countCaptureGroups(regex: string): number {
  let count = 0;
  for (let i = 0; i < regex.length; i++) {
    if (regex[i] === "(" && (i === 0 || regex[i - 1] !== "\\")) {
      // Check it's not a non-capturing group (?:...)
      if (i + 1 < regex.length && regex[i + 1] !== "?") {
        count++;
      }
    }
  }
  return count;
}

/**
 * Extract unique values for a given tag across all paths matching a pattern.
 */
export function extractUniqueValues(
  paths: string[],
  rootPath: string,
  assignments: TokenAssignment[],
  tag: TokenTag,
  pattern: PathPattern,
  tokenSubDelimiters: string[] = ["_"],
): string[] {
  const tagAssignments = assignments.filter((a) => a.tag === tag);
  if (tagAssignments.length === 0) return [];

  const values = new Set<string>();

  for (const fullPath of paths) {
    const relativePath = getRelativePath(fullPath, rootPath);
    const segments = relativePath.split("/").filter(Boolean);

    if (!pathMatchesPattern(segments, pattern)) continue;

    for (const assignment of tagAssignments) {
      if (assignment.blockIndex >= segments.length) continue;

      if (assignment.subBlockIndex === null) {
        // Whole folder level
        values.add(segments[assignment.blockIndex]);
      } else {
        // Sub-block within folder level
        const parts = splitFolderByDelimiters(
          segments[assignment.blockIndex],
          tokenSubDelimiters,
        );
        if (assignment.subBlockIndex < parts.segments.length) {
          values.add(parts.segments[assignment.subBlockIndex]);
        }
      }
    }
  }

  return [...values].sort();
}

/**
 * Build the staging mapping from raw paths to normalized 4-level staging paths.
 *
 * The staging tree is always: Subject/Session/Run/Modality
 * - Subject: required, from tokenizer
 * - Session: from tokenizer or defaults to "01"
 * - Run: from tokenizer or defaults to "01"
 * - Modality: required, from tokenizer (before alias mapping)
 */
export function buildStagingMapping(
  paths: string[],
  rootPath: string,
  assignments: TokenAssignment[],
  pattern: PathPattern,
  subjectRenames: Record<string, string>,
  modalityAliases: Record<string, string | null>,
  tokenSubDelimiters: string[] = ["_"],
): StagingEntry[] {
  const entries: StagingEntry[] = [];

  const subjectAssignment = assignments.find((a) => a.tag === "Subject");
  const sessionAssignment = assignments.find((a) => a.tag === "Session");
  const runAssignment = assignments.find((a) => a.tag === "Run");
  const modalityAssignment = assignments.find((a) => a.tag === "Modality");

  if (!subjectAssignment || !modalityAssignment) {
    return entries; // Cannot proceed without Subject and Modality
  }

  for (const fullPath of paths) {
    const relativePath = getRelativePath(fullPath, rootPath);
    const segments = relativePath.split("/").filter(Boolean);

    if (segments.length !== pattern.depth) continue;

    const rawSubject = extractValue(segments, subjectAssignment, tokenSubDelimiters);
    const rawSession = sessionAssignment
      ? extractValue(segments, sessionAssignment, tokenSubDelimiters)
      : "01";
    const rawRun = runAssignment
      ? extractValue(segments, runAssignment, tokenSubDelimiters)
      : "01";
    const rawModality = extractValue(segments, modalityAssignment, tokenSubDelimiters);

    // Apply subject rename
    const subject = subjectRenames[rawSubject] ?? rawSubject;

    // Apply modality alias — skip if mapped to null (Ignore)
    const mappedModality = modalityAliases[rawModality];
    if (mappedModality === null || mappedModality === undefined) continue;

    entries.push({
      subject,
      session: rawSession,
      run: rawRun,
      modality: mappedModality,
      sourcePath: fullPath,
    });
  }

  return entries;
}

/**
 * Extract a value from path segments based on a token assignment.
 */
function extractValue(segments: string[], assignment: TokenAssignment, tokenSubDelimiters: string[] = ["_"]): string {
  if (assignment.subBlockIndex === null) {
    return segments[assignment.blockIndex] ?? "";
  }
  const parts = splitFolderByDelimiters(segments[assignment.blockIndex] ?? "", tokenSubDelimiters);
  return parts.segments[assignment.subBlockIndex] ?? "";
}

/**
 * Assemble the final sourcestructure.json.
 *
 * Always produces a 4-level hierarchy (Subject/Session/Run/Modality).
 * If the original data doesn't have Session or Run levels, defaults
 * are injected to maintain the fixed 4-level structure.
 */
export function assembleSourcestructure(
  sessionAliases: SessionAlias[],
  runAliases: SessionAlias[],
  modalityAliases: ModalityAlias[],
  bMatchDirectories: boolean,
): SourcestructureJson {
  // The staging tree is always normalized to 4 levels:
  // Subject/Session/Run/Modality
  // So the folderHierarchy is always 4 capture groups
  const folderHierarchy = ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"];

  // tokenOrdering for the normalized tree is always:
  // [Subject=0, Visit(Session)=1, Session(Run)=2, Scan(Modality)=3]
  const tokenOrdering: [number, number, number, number] = [0, 1, 2, 3];

  // Build session aliases as flat alternating [regex, alias] pairs
  // Always include the default "01" → "ASL_1"
  const tokenSessionAliases: string[] = ["^01$", "ASL_1"];
  const seenSessionRegexes = new Set(["^01$"]);

  for (const alias of [...sessionAliases, ...runAliases]) {
    const regex = `^${escapeRegex(alias.captured)}$`;
    if (seenSessionRegexes.has(regex)) {
      continue;
    }
    seenSessionRegexes.add(regex);
    tokenSessionAliases.push(regex, alias.alias);
  }

  // Build scan (modality) aliases as flat alternating [regex, alias] pairs
  const tokenScanAliases: string[] = [];
  const seenModalities = new Set<string>();
  for (const alias of modalityAliases) {
    if (alias.mapped === null) continue; // Ignored modalities
    if (seenModalities.has(alias.mapped)) continue;
    seenModalities.add(alias.mapped);
    tokenScanAliases.push(`^${escapeRegex(alias.mapped)}$`, alias.mapped);
  }

  return {
    folderHierarchy,
    tokenOrdering,
    tokenSessionAliases,
    tokenScanAliases,
    bMatchDirectories,
  };
}

/**
 * Assemble the final studyPar.json from metadata groups.
 *
 * The catch-all group (empty subjectRegExp) is always first.
 * Override groups follow with their regex selectors.
 */
export function assembleStudyPar(
  metadataGroups: MetadataGroup[],
): StudyParJson {
  // Separate catch-all from overrides
  const catchAll = metadataGroups.find((g) => g.subjectRegExp === "");
  const overrides = metadataGroups.filter((g) => g.subjectRegExp !== "");

  const studyPars = [];

  // Catch-all first (no regex selectors)
  if (catchAll) {
    studyPars.push({ ...catchAll.bidsParams });
  }

  // Override entries with regex selectors
  for (const group of overrides) {
    studyPars.push({
      ...group.bidsParams,
      ...(group.subjectRegExp && { SubjectRegExp: group.subjectRegExp }),
      ...(group.sessionRegExp && { SessionRegExp: group.sessionRegExp }),
      ...(group.runRegExp && { RunRegExp: group.runRegExp }),
    });
  }

  // Ensure at least one entry
  if (studyPars.length === 0) {
    studyPars.push({});
  }

  return { StudyPars: studyPars };
}

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Split a folder name by configured delimiters, preserving delimiter info.
 */
function splitFolderByDelimiters(
  folderName: string,
  delimitersToSplitOn: string[] = ["_"],
): {
  segments: string[];
  delimiters: string[];
} {
  const { subBlocks, delimiters } = splitBySubDelimiters(
    folderName,
    delimitersToSplitOn,
  );
  return { segments: subBlocks, delimiters };
}

export function pathMatchesPattern(segments: string[], pattern: PathPattern): boolean {
  if (segments.length !== pattern.depth) {
    return false;
  }

  return segments.every((segment, index) => {
    const allowedValues = pattern.uniqueNames[index] ?? [];
    return allowedValues.length === 0 || allowedValues.includes(segment);
  });
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import type {
  BidsAslMetadata,
  MetadataGroup,
  ModalityAlias,
  PathPattern,
  SessionAlias,
  SourcestructureJson,
  StagingEntry,
  StudyParJson,
  SubjectRow,
  TokenAssignment,
  TokenTag,
} from "../schemas/importSchemas";
import { getRelativePath, splitBySubDelimiters } from "./pathUtils";

const VENDOR_MAP: Record<string, string> = {
  GE_product: "GE",
  Philips: "Philips",
  Siemens: "Siemens",
};

export function deriveVendor(manufacturer: string | undefined): string | undefined {
  if (!manufacturer) return undefined;
  return VENDOR_MAP[manufacturer];
}

export function deriveSequence(
  mrAcquisitionType: string | undefined,
  pulseSequenceType: string | undefined,
): string | undefined {
  if (!mrAcquisitionType || !pulseSequenceType) return undefined;
  return `${mrAcquisitionType}_${pulseSequenceType}`;
}

function injectDerivedFields(params: BidsAslMetadata): BidsAslMetadata {
  const derived: BidsAslMetadata = { ...params };
  const vendor = deriveVendor(params.Manufacturer as string | undefined);
  const sequence = deriveSequence(params.MRAcquisitionType, params.PulseSequenceType);
  if (vendor) (derived as Record<string, string>).Vendor = vendor;
  if (sequence) (derived as Record<string, string>).Sequence = sequence;
  return derived;
}

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
    tagToGroupIndex.has("Subject") ? tagToGroupIndex.get("Subject")! + 1 : 0,
    tagToGroupIndex.has("Session") ? tagToGroupIndex.get("Session")! + 1 : 0,
    tagToGroupIndex.has("Run") ? tagToGroupIndex.get("Run")! + 1 : 0,
    tagToGroupIndex.has("Modality") ? tagToGroupIndex.get("Modality")! + 1 : 0,
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
        const parts = splitFolderByDelimiters(segments[assignment.blockIndex], tokenSubDelimiters);
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
  sessionRenames: Record<string, string>,
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
    const rawRun = runAssignment ? extractValue(segments, runAssignment, tokenSubDelimiters) : "01";
    const rawModality = extractValue(segments, modalityAssignment, tokenSubDelimiters);

    // Apply subject rename
    const subject = subjectRenames[rawSubject] ?? rawSubject;

    // Apply BIDS session rename
    const session = sessionRenames[rawSession] ?? rawSession;

    // Apply modality alias — skip if mapped to null (Ignore)
    const mappedModality = modalityAliases[rawModality];
    if (mappedModality === null || mappedModality === undefined) continue;

    entries.push({
      subject,
      session,
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
function extractValue(
  segments: string[],
  assignment: TokenAssignment,
  tokenSubDelimiters: string[] = ["_"],
): string {
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
  // [Subject=1, Visit(Session)=2, Session(Run)=3, Scan(Modality)=4]
  const tokenOrdering: [number, number, number, number] = [1, 2, 3, 4];

  // Build session aliases as flat alternating [regex, alias] pairs
  // Always include the default "01" → "ASL_1"
  const tokenSessionAliases: string[] = ["^01$", "ASL_1"];
  const seenSessionRegexes = new Set(["^01$"]);

  for (const alias of runAliases) {
    const regex = `^${escapeRegex(alias.captured)}$`;
    if (seenSessionRegexes.has(regex)) {
      continue;
    }
    seenSessionRegexes.add(regex);
    tokenSessionAliases.push(regex, alias.alias);
  }

  // Build visit aliases as flat alternating [folderName, folderName] pairs
  // Simple 1-to-1 mapping (no regex anchors) for ExploreASL v1.11.0 compat
  const tokenVisitAliases: string[] = [];
  const seenVisits = new Set<string>();
  for (const alias of sessionAliases) {
    if (seenVisits.has(alias.captured)) continue;
    seenVisits.add(alias.captured);
    tokenVisitAliases.push(alias.captured, alias.captured);
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
    tokenVisitAliases,
    tokenScanAliases,
    bMatchDirectories,
  };
}

/**
 * Assemble the final studyPar.json from metadata groups and subject row assignments.
 *
 * Every StudyPars block emits explicit SubjectRegExp and VisitRegExp derived
 * from subjectRows. Subjects within each group are sub-grouped by their
 * session signatures to produce compressed regex blocks.
 */
export function assembleStudyPar(
  metadataGroups: MetadataGroup[],
  subjectRows: SubjectRow[],
): StudyParJson {
  // Group subjectRows by groupId
  const rowsByGroup = new Map<string, SubjectRow[]>();
  for (const row of subjectRows) {
    const existing = rowsByGroup.get(row.groupId);
    if (existing) {
      existing.push(row);
    } else {
      rowsByGroup.set(row.groupId, [row]);
    }
  }

  const studyPars = [];

  for (const group of metadataGroups) {
    const rows = rowsByGroup.get(group.id);
    if (!rows || rows.length === 0) continue;

    // Build per-subject session lists
    const subjectSessions = new Map<string, string[]>();
    for (const row of rows) {
      const existing = subjectSessions.get(row.subject);
      if (existing) {
        if (!existing.includes(row.session)) {
          existing.push(row.session);
        }
      } else {
        subjectSessions.set(row.subject, [row.session]);
      }
    }

    // Sub-group subjects by their session set signature
    const sessionSignatureMap = new Map<string, Set<string>>();
    for (const [subject, sessions] of subjectSessions) {
      const signature = [...sessions].sort().join(",");
      const existing = sessionSignatureMap.get(signature);
      if (existing) {
        existing.add(subject);
      } else {
        sessionSignatureMap.set(signature, new Set([subject]));
      }
    }

    // Emit one StudyPars block per session signature
    for (const [signature, subjects] of sessionSignatureMap) {
      const sessions = signature.split(",");
      const escapedSubjects = [...subjects].map(escapeRegex);
      const subjectRegEx =
        escapedSubjects.length === 1
          ? `^(${escapedSubjects[0]})$`
          : `^(${escapedSubjects.join("|")})$`;
      const escapedSessions = sessions.map(escapeRegex);
      const visitRegEx =
        escapedSessions.length === 1
          ? `^(${escapedSessions[0]})$`
          : `^(${escapedSessions.join("|")})$`;

      studyPars.push({
        ...injectDerivedFields(group.bidsParams),
        SubjectRegExp: subjectRegEx,
        VisitRegExp: visitRegEx,
      });
    }
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
  const { subBlocks, delimiters } = splitBySubDelimiters(folderName, delimitersToSplitOn);
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

/**
 * Decode pattern signature using user-defined token assignments.
 * Translates generic <TOKEN> and VARYING placeholders to uppercase tag names
 * (e.g. <SUBJECT>, <SESSION>, <RUN>, <MODALITY>, <IGNORE>) where assigned.
 */
export function decodePatternSignature(
  signature: string,
  assignments: TokenAssignment[],
  subDelimiters: string[] = ["_", "-"],
): string {
  const blocks = signature.split("/");
  const decodedBlocks = blocks.map((block, blockIndex) => {
    const blockAssignments = assignments.filter((a) => a.blockIndex === blockIndex);
    if (blockAssignments.length === 0) {
      return block;
    }

    const wholeAssignment = blockAssignments.find((a) => a.subBlockIndex === null);
    if (wholeAssignment) {
      return wholeAssignment.tag === "Ignore"
        ? "<IGNORE>"
        : `<${wholeAssignment.tag.toUpperCase()}>`;
    }

    const { subBlocks, delimiters } = splitBySubDelimiters(block, subDelimiters);
    const decodedSubBlocks = subBlocks.map((subBlock, subBlockIndex) => {
      const assignment = blockAssignments.find((a) => a.subBlockIndex === subBlockIndex);
      if (assignment) {
        return assignment.tag === "Ignore" ? "<IGNORE>" : `<${assignment.tag.toUpperCase()}>`;
      }
      return subBlock;
    });

    return decodedSubBlocks.reduce((result, sub, idx) => {
      if (idx === 0) return sub;
      return result + (delimiters[idx - 1] ?? "") + sub;
    }, "");
  });

  return decodedBlocks.join("/");
}

import type { PathPattern } from "../schemas/importSchemas";

/**
 * Strip the root path prefix from a full path to get a relative path.
 * Handles trailing slashes on rootPath.
 */
export function getRelativePath(fullPath: string, rootPath: string): string {
  const normalizedRoot = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  if (fullPath.startsWith(normalizedRoot)) {
    return fullPath.slice(normalizedRoot.length);
  }
  return fullPath;
}

/**
 * Classify a set of values at a given path depth as "fixed" (all identical)
 * or "varying" (multiple unique values).
 */
export function classifySegment(values: string[]): "fixed" | "varying" {
  if (values.length === 0) return "fixed";
  const unique = new Set(values);
  return unique.size === 1 ? "fixed" : "varying";
}

/**
 * Generate a human-readable label for a segment based on its values.
 * - If fixed: returns the literal value (e.g., "DICOM")
 * - If varying: tries to classify (e.g., "SUBJECT", "NUMBER", "VARYING")
 */
export function labelSegment(values: string[]): string {
  const unique = [...new Set(values)];
  if (unique.length === 1) {
    return unique[0];
  }

  // Check if all values are numeric
  if (unique.every((v) => /^\d+$/.test(v))) {
    return "NUMBER";
  }

  return "VARYING";
}

/**
 * Compute a human-readable pattern signature from path blocks and their
 * unique values across all matching paths.
 *
 * Example: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"]
 * with uniqueNames showing BAR/FOO varying → "VARYING/VARYING/VARYING"
 */
export function computePatternSignature(
  uniqueNames: Record<number, string[]>,
  depth: number,
): string {
  const labels: string[] = [];
  for (let i = 0; i < depth; i++) {
    const values = uniqueNames[i] ?? [];
    labels.push(labelSegment(values));
  }
  return labels.join("/");
}

/**
 * Group paths by their structural depth pattern.
 * Paths with the same depth AND the same fixed-vs-varying pattern at each level
 * are grouped together.
 *
 * The key insight: two paths have the same "structural pattern" if:
 * 1. They have the same depth (number of "/" segments)
 * 2. Fixed segments (where ALL paths in the group share the same value)
 *    appear at the same positions
 */
export function discoverPathPatterns(
  paths: string[],
  rootPath: string,
): PathPattern[] {
  if (paths.length === 0) return [];

  // Convert to relative paths and split by "/"
  const relativePaths = paths.map((p) => getRelativePath(p, rootPath));
  const splitPaths = relativePaths.map((p) => p.split("/").filter(Boolean));

  // Group by depth first
  const byDepth = new Map<number, { original: string; segments: string[] }[]>();
  for (let i = 0; i < splitPaths.length; i++) {
    const segments = splitPaths[i];
    const depth = segments.length;
    if (!byDepth.has(depth)) {
      byDepth.set(depth, []);
    }
    byDepth.get(depth)!.push({ original: relativePaths[i], segments });
  }

  const patterns: PathPattern[] = [];

  for (const [depth, entries] of byDepth) {
    // Within each depth group, further group by which positions are "fixed"
    // (same literal value across all entries at that depth position)
    // We need to iteratively refine: compute unique values per position,
    // then compute a "shape key" based on fixed positions.
    const subGroups = groupByStructure(entries, depth);

    for (const group of subGroups) {
      const uniqueNames: Record<number, string[]> = {};
      for (let i = 0; i < depth; i++) {
        const valuesAtDepth = [...new Set(group.map((e) => e.segments[i]))];
        uniqueNames[i] = valuesAtDepth.sort();
      }

      const signature = computePatternSignature(uniqueNames, depth);
      const samplePath = group[0].original;
      const blocks = group[0].segments;

      patterns.push({
        signature,
        samplePath,
        blocks,
        uniqueNames,
        count: group.length,
        depth,
      });
    }
  }

  return patterns;
}

/**
 * Group entries of the same depth by their structural "shape".
 *
 * Strategy: find positions with low cardinality (few unique values relative
 * to the number of entries) — these are likely structural markers (e.g.,
 * "DICOM" folder). Group entries by their values at these positions.
 *
 * A position is a "structural candidate" if:
 * - It has more than 1 unique value (not globally fixed)
 * - Its cardinality is lower than the total number of entries
 *   (if every entry has a unique value, it's data, not structure)
 * - Its cardinality is less than half the entry count
 *   (heuristic to distinguish structural markers from data)
 */
function groupByStructure(
  entries: { original: string; segments: string[] }[],
  depth: number,
): { original: string; segments: string[] }[][] {
  if (entries.length <= 1) return [entries];

  // Find the best structural position to split on
  let bestPos = -1;
  let bestCardinality = Infinity;

  for (let i = 0; i < depth; i++) {
    const unique = new Set(entries.map((e) => e.segments[i]));
    const cardinality = unique.size;

    // A structural position has: more than 1 value, but fewer unique values
    // than entries (meaning values repeat → structural, not data)
    if (cardinality > 1 && cardinality < entries.length && cardinality < bestCardinality) {
      bestPos = i;
      bestCardinality = cardinality;
    }
  }

  if (bestPos === -1) {
    // No structural positions found — all positions are either globally
    // fixed or fully varying. This is one group.
    return [entries];
  }

  // Split by the values at the best structural position
  const subGroupMap = new Map<
    string,
    { original: string; segments: string[] }[]
  >();

  for (const entry of entries) {
    const key = entry.segments[bestPos];
    if (!subGroupMap.has(key)) {
      subGroupMap.set(key, []);
    }
    subGroupMap.get(key)!.push(entry);
  }

  // Recursively refine each sub-group (splitting may reveal new structure)
  const result: { original: string; segments: string[] }[][] = [];
  for (const group of subGroupMap.values()) {
    result.push(...groupByStructure(group, depth));
  }
  return result;
}

/**
 * Split a folder name by sub-delimiters into sub-blocks.
 * Preserves the delimiters in the split info so we can reconstruct
 * the regex pattern.
 *
 * Example: "sernum-0018_ser-pcasl_3d" →
 *   blocks: ["sernum-0018", "ser-pcasl", "3d"]
 *   delimiters: ["_", "_"]
 */
export function splitBySubDelimiters(
  folderName: string,
  delimitersToSplitOn: string[] = ["_"],
): {
  subBlocks: string[];
  delimiters: string[];
} {
  const subBlocks: string[] = [];
  const delimiters: string[] = [];
  let current = "";

  for (const char of folderName) {
    if (delimitersToSplitOn.includes(char)) {
      subBlocks.push(current);
      delimiters.push(char);
      current = "";
    } else {
      current += char;
    }
  }
  subBlocks.push(current);

  return { subBlocks, delimiters };
}

/**
 * Count unique values at each sub-block position within a folder level
 * across all paths matching a pattern.
 *
 * @param paths - All relative paths matching a pattern
 * @param blockIndex - Which folder depth level to analyze
 * @returns Map of sub-block index → unique values
 */
export function analyzeSubBlocks(
  paths: string[],
  blockIndex: number,
  delimitersToSplitOn: string[] = ["_"],
): Record<number, string[]> {
  const result: Record<number, string[]> = {};

  const allSubBlocks = paths
    .map((p) => {
      const segments = p.split("/").filter(Boolean);
      if (blockIndex >= segments.length) return null;
      return splitBySubDelimiters(segments[blockIndex], delimitersToSplitOn);
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (allSubBlocks.length === 0) return result;

  // Find the maximum number of sub-blocks at this level
  const maxSubBlocks = Math.max(...allSubBlocks.map((s) => s.subBlocks.length));

  for (let i = 0; i < maxSubBlocks; i++) {
    const values = allSubBlocks
      .map((s) => s.subBlocks[i])
      .filter((v): v is string => v !== undefined);
    result[i] = [...new Set(values)].sort();
  }

  return result;
}

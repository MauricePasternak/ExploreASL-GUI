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
 * Shows sub-block template for varying positions with multiple sub-blocks
 * (e.g. "<TOKEN>-<TOKEN>-<TOKEN>"), literal values for fixed positions,
 * and "VARYING" for varying single-block positions.
 */
function uniformSubBlockCount(values: string[], delimiters: string[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const counts = values.map((value) => splitBySubDelimiters(value, delimiters).subBlocks.length);
  const first = counts[0];
  return counts.every((count) => count === first) ? first : null;
}

export function computePatternSignature(
  uniqueNames: Record<number, string[]>,
  depth: number,
  sampleBlocks: string[],
  delimiters: string[] = ["_", "-"],
): string {
  const labels: string[] = [];
  for (let i = 0; i < depth; i++) {
    const values = uniqueNames[i] ?? [];
    const unique = new Set(values);

    if (unique.size === 1) {
      labels.push(values[0]);
    } else {
      const sampleBlock = sampleBlocks[i] ?? values[0];
      const { subBlocks: sampleSubBlocks, delimiters: sampleDelimiters } = splitBySubDelimiters(
        sampleBlock,
        delimiters,
      );
      const subBlockCount = uniformSubBlockCount(values, delimiters);
      const isLeaf = i === depth - 1;

      if (isLeaf) {
        if (sampleSubBlocks.length > 1) {
          labels.push(buildSubBlockTemplate(sampleSubBlocks.length, sampleDelimiters));
        } else {
          labels.push("<TOKEN>");
        }
      } else if (subBlockCount === 1) {
        labels.push("<TOKEN>");
      } else if (subBlockCount !== null && subBlockCount > 1) {
        labels.push(buildSubBlockTemplate(subBlockCount, sampleDelimiters));
      } else if (sampleSubBlocks.length > 1) {
        labels.push(buildSubBlockTemplate(sampleSubBlocks.length, sampleDelimiters));
      } else {
        labels.push("VARYING");
      }
    }
  }
  return labels.join("/");
}

/**
 * Build a template string showing sub-block structure with delimiters.
 * E.g. 3 sub-blocks with ["-", "-"] delimiters → "<TOKEN>-<TOKEN>-<TOKEN>"
 */
function buildSubBlockTemplate(subBlockCount: number, subDelimiters: string[]): string {
  const tokens = Array.from({ length: subBlockCount }, () => "<TOKEN>");
  return tokens.reduce((result, token, idx) => {
    if (idx === 0) return token;
    return result + (subDelimiters[idx - 1] ?? "") + token;
  }, "");
}

/**
 * Group paths by their structural depth pattern.
 * Paths with the same depth AND the same sub-block structure at each level
 * are grouped together.
 *
 * Two paths have the same "structural pattern" if, at every depth position,
 * their folder names produce the same number of sub-blocks when split by
 * the configured delimiters (default: ["_", "-"]).
 */
export function discoverPathPatterns(
  paths: string[],
  rootPath: string,
  delimiters: string[] = ["_", "-"],
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
    // Within each depth group, group by sub-block shape
    const subGroups = groupByShape(entries, depth, delimiters);

    for (const group of subGroups) {
      const uniqueNames: Record<number, string[]> = {};
      for (let i = 0; i < depth; i++) {
        const valuesAtDepth = [...new Set(group.map((e) => e.segments[i]))];
        uniqueNames[i] = valuesAtDepth.sort();
      }

      const blocks = group[0].segments;
      const signature = computePatternSignature(uniqueNames, depth, blocks, delimiters);
      const samplePath = group[0].original;

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
 * Group entries of the same depth by their sub-block "shape".
 *
 * Two paths have the same shape if, at every depth position, their folder
 * names produce the same number of sub-blocks when split by the configured
 * delimiters. This correctly distinguishes structural patterns:
 *
 * e.g. "C9ORF059-01-MR00" (3 sub-blocks by "-") vs "C9ORF059-11" (2 sub-blocks)
 * are different shapes, while "C9ORF059-01-MR00" and "C9ORF007-02-MR00" (both
 * 3 sub-blocks) are the same shape.
 */
function groupByShape(
  entries: { original: string; segments: string[] }[],
  depth: number,
  delimiters: string[] = ["_", "-"],
): { original: string; segments: string[] }[][] {
  if (entries.length <= 1) return [entries];

  const groups = new Map<string, { original: string; segments: string[] }[]>();

  // Leaf folder names (e.g. scan series) vary in token count but share parent structure.
  const structuralDepth = Math.max(1, depth - 1);

  for (const entry of entries) {
    const shapeKey = entry.segments
      .slice(0, structuralDepth)
      .map((seg) => {
        const { subBlocks } = splitBySubDelimiters(seg, delimiters);
        return subBlocks.length;
      })
      .join("/");

    if (!groups.has(shapeKey)) {
      groups.set(shapeKey, []);
    }
    groups.get(shapeKey)!.push(entry);
  }

  return [...groups.values()];
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

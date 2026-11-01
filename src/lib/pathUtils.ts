import type { PathPattern } from "../schemas/importSchemas";

/**
 * Strip the root path prefix from a full path to get a relative path.
 * Handles trailing slashes on rootPath.
 */
export function getRelativePath(fullPath: string, rootPath: string): string {
  const normFullPath = fullPath.replace(/\\/g, "/");
  const normRootPath = rootPath.replace(/\\/g, "/");
  const normalizedRoot = normRootPath.endsWith("/") ? normRootPath : `${normRootPath}/`;
  if (normFullPath.startsWith(normalizedRoot)) {
    return normFullPath.slice(normalizedRoot.length);
  }
  return normFullPath;
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
 * e.g. "002-01-MR00" (3 sub-blocks by "-") vs "002-11" (2 sub-blocks)
 * are different shapes, while "002-01-MR00" and "001-02-MR00" (both
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

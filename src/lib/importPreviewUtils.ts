import type {
  ModalityAlias,
  PathPattern,
  StagingMappingByPattern,
  TokenAssignment,
} from "../schemas/importSchemas";
import { buildStagingMapping, pathMatchesPattern } from "./tokenizerUtils";
import { getRelativePath } from "./pathUtils";

export function buildAllStagingMappings(
  rawPaths: string[],
  rootPath: string,
  pathPatterns: PathPattern[],
  tokenizerConfigs: Record<string, TokenAssignment[]>,
  subjectRenames: Record<string, string>,
  modalityAliases: ModalityAlias[],
  tokenSubDelimiters: string[] = ["_"],
): StagingMappingByPattern[] {
  const aliasMap: Record<string, string | null> = {};
  for (const alias of modalityAliases) {
    aliasMap[alias.captured] = alias.mapped;
  }

  const results: StagingMappingByPattern[] = [];

  for (const pattern of pathPatterns) {
    const assignments = tokenizerConfigs[pattern.signature] ?? [];

    const matchingPaths = rawPaths.filter((p) => {
      const relative = getRelativePath(p, rootPath);
      const segments = relative.split("/").filter(Boolean);
      return pathMatchesPattern(segments, pattern);
    });

    const entries = buildStagingMapping(
      matchingPaths,
      rootPath,
      assignments,
      pattern,
      subjectRenames,
      aliasMap,
      tokenSubDelimiters,
    );

    results.push({
      patternSignature: pattern.signature,
      pattern,
      assignments,
      entries,
    });
  }

  return results;
}
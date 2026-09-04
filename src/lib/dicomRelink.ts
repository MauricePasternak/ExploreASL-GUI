import type { PathPattern } from "../schemas/importSchemas";
import { normalizeRawPath } from "./projectPaths";

function normalizedInventory(paths: string[]): string[] {
  return paths.map(normalizeRawPath).sort();
}

function normalizedPatterns(patterns: PathPattern[]) {
  return patterns
    .map(({ signature, depth, count }) => ({ signature, depth, count }))
    .sort((a, b) => a.signature.localeCompare(b.signature));
}

export function areDicomStructuresCompatible(
  savedPaths: string[],
  savedPatterns: PathPattern[],
  replacementPaths: string[],
  replacementPatterns: PathPattern[],
): boolean {
  try {
    return (
      JSON.stringify(normalizedInventory(savedPaths)) ===
        JSON.stringify(normalizedInventory(replacementPaths)) &&
      JSON.stringify(normalizedPatterns(savedPatterns)) ===
        JSON.stringify(normalizedPatterns(replacementPatterns))
    );
  } catch {
    return false;
  }
}

/**
 * Match known subject names as substrings within an ExploreASL failure description.
 * Mirrors the Rust parser behaviour in `import.rs`.
 */
export function matchSubjectsInFailureDescription(
  description: string,
  subjectList: string[],
): string[] {
  return subjectList.filter((subject) => description.includes(subject));
}

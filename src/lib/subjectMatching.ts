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

/**
 * Generate a regular expression pattern for matching subjects.
 * If subjects list is empty, returns the default pattern matching all subjects.
 */
export function generateSubjectRegexp(subjects: string[]): string {
  if (subjects.length === 0) return "^sub-.*$";
  const escaped = subjects.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(${escaped.join("|")})$`;
}

import type { DerivedMetadataGroup, SubjectRow } from "../../schemas/importSchemas";

/** Strip `sub-` prefix from a BIDS subject directory label. */
export function stripSubjectPrefix(subjectLabel: string): string {
  return subjectLabel.startsWith("sub-") ? subjectLabel.slice(4) : subjectLabel;
}

/**
 * Flatten Rust `SidecarGroup` subjects into DICOM-compatible `SubjectRow[]`.
 *
 * Contract: `subject` is stripped (e.g. `"01"`), `id`/`subject_session` style is
 * `"sub-01_1"`, matching `list_subjects` / `parseParticipantId` expectations.
 *
 * Throws on cross-group `(subjectLabel, sessionLabel)` collisions — duplicate
 * subject-session across distinct groups is out-of-scope for v1 (design D17:
 * validation at confirm-time; cross-group merge is a v1.5 feature).
 */
export function flattenBidsGroupsToSubjectRows(groups: DerivedMetadataGroup[]): SubjectRow[] {
  const rows: SubjectRow[] = [];
  /** Tracks emitted (id) → groupId for cross-group collision detection. */
  const emittedIds = new Map<string, string>();

  for (const group of groups) {
    const mergedBySubject = new Map<string, Set<string>>();

    for (const groupSubject of group.subjects) {
      const subjectKey = groupSubject.subjectLabel;
      const sessions = mergedBySubject.get(subjectKey) ?? new Set<string>();
      for (const session of groupSubject.sessionLabels) {
        sessions.add(session);
      }
      mergedBySubject.set(subjectKey, sessions);
    }

    for (const [subjectLabel, sessionSet] of mergedBySubject) {
      const subject = stripSubjectPrefix(subjectLabel);
      const sessionLabels = [...sessionSet].sort();
      for (const session of sessionLabels) {
        const id = `sub-${subject}_${session}`;
        const existingGroup = emittedIds.get(id);
        if (existingGroup !== undefined && existingGroup !== group.id) {
          throw new Error(
            `BIDS scan produced duplicate subject-session "${id}" across groups — manual merge required (v1.5 feature)`,
          );
        }
        emittedIds.set(id, group.id);
        rows.push({ id, subject, session, groupId: group.id });
      }
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

import type { ImportSnapshot } from "../schemas/importSchemas";
import type { ImportState } from "../stores/importStore";

type StructuralKey = keyof Pick<
  ImportSnapshot,
  | "sourceDataPath"
  | "pathPatterns"
  | "tokenizerConfigs"
  | "bMatchDirectories"
  | "modalityAliases"
  | "sessionAliases"
  | "runAliases"
  | "subjectRenames"
>;

const STRUCTURAL_KEYS: StructuralKey[] = [
  "sourceDataPath",
  "pathPatterns",
  "tokenizerConfigs",
  "bMatchDirectories",
  "modalityAliases",
  "sessionAliases",
  "runAliases",
  "subjectRenames",
];

export function computeStaleness(
  currentState: ImportState,
  snapshot: ImportSnapshot | null,
): Record<string, boolean> {
  if (snapshot === null) {
    return {};
  }

  const subjects = new Set<string>();
  for (const row of currentState.subjectRows) {
    subjects.add(row.subject);
  }

  const hasStructuralChange = STRUCTURAL_KEYS.some(
    (key) => JSON.stringify(currentState[key]) !== JSON.stringify(snapshot[key]),
  );

  if (hasStructuralChange) {
    const result: Record<string, boolean> = {};
    for (const subject of subjects) {
      result[subject] = true;
    }
    return result;
  }

  const changedGroupIds = new Set<string>();

  if (JSON.stringify(currentState.metadataGroups) !== JSON.stringify(snapshot.metadataGroups)) {
    const oldGroupMap = new Map(snapshot.metadataGroups.map((g) => [g.id, g]));
    const currentGroupIds = new Set(currentState.metadataGroups.map((g) => g.id));

    for (const group of currentState.metadataGroups) {
      const oldGroup = oldGroupMap.get(group.id);
      if (!oldGroup || JSON.stringify(group.bidsParams) !== JSON.stringify(oldGroup.bidsParams)) {
        changedGroupIds.add(group.id);
      }
    }

    for (const oldGroup of snapshot.metadataGroups) {
      if (!currentGroupIds.has(oldGroup.id)) {
        changedGroupIds.add(oldGroup.id);
      }
    }
  }

  if (JSON.stringify(currentState.subjectRows) !== JSON.stringify(snapshot.subjectRows)) {
    const oldRowMap = new Map(snapshot.subjectRows.map((r) => [r.id, r]));
    for (const row of currentState.subjectRows) {
      const oldRow = oldRowMap.get(row.id);
      if (!oldRow || oldRow.groupId !== row.groupId) {
        changedGroupIds.add(row.groupId);
      }
    }
  }

  const result: Record<string, boolean> = {};
  for (const subject of subjects) {
    const row = currentState.subjectRows.find((r) => r.subject === subject);
    result[subject] = row ? changedGroupIds.has(row.groupId) : false;
  }
  return result;
}

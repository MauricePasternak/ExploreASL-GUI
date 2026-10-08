import type { ProjectInspection } from "../generated/project/ProjectInspection";

export type DuplicateProjectChoice = "moved" | "copied" | "cancel";

/** Identity classification and UUID creation belong to native inspection. */
export async function resolveProjectIdentity(
  selectedPath: string,
  candidate: ProjectInspection,
  chooseDuplicate: (oldPath: string, newPath: string) => Promise<DuplicateProjectChoice>,
) {
  const choice = candidate.duplicatePath
    ? await chooseDuplicate(candidate.duplicatePath, selectedPath)
    : "moved";
  return {
    cancelled: choice === "cancel",
    copied: choice === "copied",
    replacePath: choice === "moved" ? (candidate.duplicatePath ?? candidate.movedFrom) : null,
  };
}

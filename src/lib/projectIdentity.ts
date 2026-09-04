import { readTextFile } from "@tauri-apps/plugin-fs";
import { exists } from "@tauri-apps/plugin-fs";

import type { RecentProject } from "../schemas/globalSettings";
import { parseProject } from "../schemas/project";

export type DuplicateProjectChoice = "moved" | "copied" | "cancel";

export type ProjectIdentityResolution =
  | { status: "cancelled" }
  | {
      status: "open";
      projectId: string;
      dirty: boolean;
      recentAction: { kind: "add" } | { kind: "replace"; oldPath: string };
    };

interface IdentityDependencies {
  pathExists?: (path: string) => Promise<boolean>;
  readProject?: (path: string) => Promise<string>;
  chooseDuplicate?: (oldPath: string, newPath: string) => Promise<DuplicateProjectChoice>;
  createId?: () => string;
}

export async function resolveProjectIdentity(
  selectedPath: string,
  candidateId: string,
  recentProjects: RecentProject[],
  dependencies: IdentityDependencies = {},
): Promise<ProjectIdentityResolution> {
  const pathExists = dependencies.pathExists ?? exists;
  const readProject = dependencies.readProject ?? readTextFile;
  const chooseDuplicate = dependencies.chooseDuplicate ?? (async () => "cancel" as const);
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const prior = recentProjects.find(
    (recent) => recent.projectId === candidateId && recent.path !== selectedPath,
  );

  if (!prior) {
    return { status: "open", projectId: candidateId, dirty: false, recentAction: { kind: "add" } };
  }

  if (!(await pathExists(prior.path))) {
    return {
      status: "open",
      projectId: candidateId,
      dirty: false,
      recentAction: { kind: "replace", oldPath: prior.path },
    };
  }

  try {
    const priorProject = parseProject(await readProject(prior.path));
    if (priorProject.projectMeta.id !== candidateId) {
      return {
        status: "open",
        projectId: candidateId,
        dirty: false,
        recentAction: { kind: "add" },
      };
    }
  } catch {
    return { status: "open", projectId: candidateId, dirty: false, recentAction: { kind: "add" } };
  }

  const choice = await chooseDuplicate(prior.path, selectedPath);
  if (choice === "cancel") return { status: "cancelled" };
  if (choice === "copied") {
    return {
      status: "open",
      projectId: createId(),
      dirty: true,
      recentAction: { kind: "add" },
    };
  }
  return {
    status: "open",
    projectId: candidateId,
    dirty: false,
    recentAction: { kind: "replace", oldPath: prior.path },
  };
}

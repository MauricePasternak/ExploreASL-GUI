import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { ProjectDocument } from "../../generated/project/ProjectDocument";

export const SetupModeSchema = z.enum(["bids", "dicom", "repair"]);
export type SetupMode = z.infer<typeof SetupModeSchema>;

export const SetupPlanSchema = z.object({
  planId: z.string().min(1),
  rootPath: z.string().min(1),
  mode: SetupModeSchema,
  operations: z.array(
    z.object({
      path: z.string(),
      operation: z.enum(["create", "update", "no_op"]),
      textPreview: z.string().nullable().optional(),
    }),
  ),
  warnings: z.array(z.string()),
  conflicts: z.array(z.string()),
  projectSummary: z
    .object({
      schemaVersion: z.string(),
      name: z.string(),
      projectId: z.string(),
      dataSource: z.string(),
      contentHash: z.string(),
    })
    .nullable()
    .optional(),
  preservesReadme: z.boolean(),
  temporaryArtifacts: z.array(z.string()),
});
export type SetupPlan = z.infer<typeof SetupPlanSchema>;

export type SetupCommitResult = {
  outcome: "committed";
  projectPath: string | null;
  projectDocument: ProjectDocument | null;
  candidateId: string | null;
  directorySyncSupported: boolean;
};

export const SetupCommandErrorSchema = z.object({
  kind: z.enum([
    "stale",
    "conflict",
    "rollback",
    "uncertain_durability",
    "recovery_required",
    "failed",
  ]),
  message: z.string().min(1),
});
export type SetupCommandError = z.infer<typeof SetupCommandErrorSchema>;

export async function preflightBidsProjectMutations(
  rootPath: string,
  mode: Exclude<SetupMode, "repair">,
  name: string,
  profileId: string,
): Promise<SetupPlan> {
  return SetupPlanSchema.parse(
    await invoke("preflight_bids_project_mutations", { rootPath, mode, name, profileId }),
  );
}

export async function preflightBidsSetupRepair(rootPath: string): Promise<SetupPlan> {
  return SetupPlanSchema.parse(await invoke("preflight_bids_setup_repair", { rootPath }));
}

export async function commitBidsProjectMutations(planId: string): Promise<SetupCommitResult> {
  return invoke<SetupCommitResult>("commit_bids_project_mutations", { planId });
}

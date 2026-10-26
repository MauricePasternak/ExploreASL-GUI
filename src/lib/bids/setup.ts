import { commands, unwrap } from "../ipc";
import { z } from "zod";
import type {
  SetupCommitResult_Serialize as SetupCommitResult,
  SetupMode,
  SetupPlan_Serialize as SetupPlan,
} from "../../generated/bindings";
export type {
  SetupCommitResult_Serialize as SetupCommitResult,
  SetupMode,
  SetupPlan_Serialize as SetupPlan,
} from "../../generated/bindings";

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
  details: z.string(),
});
export type SetupCommandError = z.infer<typeof SetupCommandErrorSchema>;

export async function preflightBidsProjectMutations(
  rootPath: string,
  mode: Exclude<SetupMode, "repair">,
  name: string,
  profileId: string,
): Promise<SetupPlan> {
  return unwrap(commands.preflightBidsProjectMutations(rootPath, mode, name, profileId));
}

export async function preflightBidsSetupRepair(rootPath: string): Promise<SetupPlan> {
  return unwrap(commands.preflightBidsSetupRepair(rootPath));
}

export async function commitBidsProjectMutations(planId: string): Promise<SetupCommitResult> {
  return unwrap(commands.commitBidsProjectMutations(planId));
}

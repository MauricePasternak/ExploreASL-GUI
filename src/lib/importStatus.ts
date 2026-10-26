import { commands, unwrap } from "./ipc";
import type { ImportSubjectStatus } from "../generated/bindings";
export type { ImportSubjectStatus } from "../generated/bindings";

/** Native active-project ownership derives the audit root. */
export async function readImportStatus(): Promise<ImportSubjectStatus[]> {
  return unwrap(commands.readImportStatus());
}

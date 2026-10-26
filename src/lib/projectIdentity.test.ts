import { describe, expect, it, vi } from "vitest";

import { resolveProjectIdentity } from "./projectIdentity";
import type { ProjectInspection_Serialize as ProjectInspection } from "../generated/bindings";

const candidate: ProjectInspection = {
  candidateId: "candidate",
  projectId: "same-id",
  name: "Project",
  rootPath: "/new",
  recoveredFromBackup: false,
  duplicatePath: null,
  movedFrom: null,
  setupRecovered: 0,
};

describe("project identity resolution", () => {
  it("replaces a known old path automatically when it is missing", async () => {
    const chooseDuplicate = vi.fn();

    const result = await resolveProjectIdentity(
      "/new/project.easl",
      { ...candidate, movedFrom: "/old/project.easl" },
      chooseDuplicate,
    );

    expect(result).toEqual({
      cancelled: false,
      copied: false,
      replacePath: "/old/project.easl",
    });
    expect(chooseDuplicate).not.toHaveBeenCalled();
  });

  it.each(["moved", "copied", "cancel"] as const)(
    "resolves two existing paths after the user chooses %s",
    async (choice) => {
      const result = await resolveProjectIdentity(
        "/new/project.easl",
        { ...candidate, duplicatePath: "/old/project.easl" },
        async (oldPath, newPath) => {
          expect([oldPath, newPath]).toEqual(["/old/project.easl", "/new/project.easl"]);
          return choice;
        },
      );

      expect(result).toEqual({
        cancelled: choice === "cancel",
        copied: choice === "copied",
        replacePath: choice === "moved" ? "/old/project.easl" : null,
      });
    },
  );

  it("does not guess identity for an unmatched stale legacy path", async () => {
    const chooseDuplicate = vi.fn();

    const result = await resolveProjectIdentity("/new/project.easl", candidate, chooseDuplicate);

    expect(result).toEqual({
      cancelled: false,
      copied: false,
      replacePath: null,
    });
    expect(chooseDuplicate).not.toHaveBeenCalled();
  });
});

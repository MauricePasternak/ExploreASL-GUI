import { describe, expect, it, vi } from "vitest";

import { resolveProjectIdentity } from "./projectIdentity";

function projectBytes(id: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    projectMeta: {
      id,
      name: "Project",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastOpened: "2026-01-01T00:00:00.000Z",
      currentPhase: "import",
      dataSource: "bids",
    },
    uiState: {},
    mappingState: { sourceDataPath: "." },
    dataPar: {},
  });
}

describe("project identity resolution", () => {
  it("replaces a known old path automatically when it is missing", async () => {
    const chooseDuplicate = vi.fn();

    const result = await resolveProjectIdentity(
      "/new/project.easl",
      "same-id",
      [{ path: "/old/project.easl", projectId: "same-id" }],
      { pathExists: async () => false, chooseDuplicate },
    );

    expect(result).toEqual({
      status: "open",
      projectId: "same-id",
      dirty: false,
      recentAction: { kind: "replace", oldPath: "/old/project.easl" },
    });
    expect(chooseDuplicate).not.toHaveBeenCalled();
  });

  it.each(["moved", "copied", "cancel"] as const)(
    "resolves two existing paths after the user chooses %s",
    async (choice) => {
      const result = await resolveProjectIdentity(
        "/new/project.easl",
        "same-id",
        [{ path: "/old/project.easl", projectId: "same-id" }],
        {
          pathExists: async () => true,
          readProject: async () => projectBytes("same-id"),
          chooseDuplicate: async () => choice,
          createId: () => "copy-id",
        },
      );

      expect(result).toEqual(
        choice === "cancel"
          ? { status: "cancelled" }
          : choice === "copied"
            ? {
                status: "open",
                projectId: "copy-id",
                dirty: true,
                recentAction: { kind: "add" },
              }
            : {
                status: "open",
                projectId: "same-id",
                dirty: false,
                recentAction: { kind: "replace", oldPath: "/old/project.easl" },
              },
      );
    },
  );

  it("does not guess identity for an unmatched stale legacy path", async () => {
    const pathExists = vi.fn();

    const result = await resolveProjectIdentity(
      "/new/project.easl",
      "candidate-id",
      [{ path: "/legacy/missing/project.easl" }],
      { pathExists },
    );

    expect(result).toEqual({
      status: "open",
      projectId: "candidate-id",
      dirty: false,
      recentAction: { kind: "add" },
    });
    expect(pathExists).not.toHaveBeenCalled();
  });

  it("does not treat a replaced old-path file with a different ID as a duplicate", async () => {
    const chooseDuplicate = vi.fn();

    const result = await resolveProjectIdentity(
      "/new/project.easl",
      "candidate-id",
      [{ path: "/old/project.easl", projectId: "candidate-id" }],
      {
        pathExists: async () => true,
        readProject: async () => projectBytes("different-id"),
        chooseDuplicate,
      },
    );

    expect(result).toMatchObject({ status: "open", recentAction: { kind: "add" } });
    expect(chooseDuplicate).not.toHaveBeenCalled();
  });
});

import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { atomicWriteProject } from "./projectPersistence";

describe("atomicWriteProject", () => {
  it("invokes the native writer with canonical project bytes and recovery preservation mode", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    await atomicWriteProject({
      projectPath: "/studies/demo/project.easl",
      canonicalBytes: '{\n  "schemaVersion": 1\n}',
      preserveBackup: true,
    });

    expect(invoke).toHaveBeenCalledWith("atomic_write_project", {
      projectPath: "/studies/demo/project.easl",
      canonicalBytes: '{\n  "schemaVersion": 1\n}',
      preserveBackup: true,
    });
  });

  it("preserves known native error categories and rejects unknown categories", async () => {
    vi.mocked(invoke).mockRejectedValueOnce({
      category: "insufficient_space",
      message: "temporary project write failed",
    });

    await expect(
      atomicWriteProject({
        projectPath: "/project.easl",
        canonicalBytes: "{}",
        preserveBackup: false,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        category: "insufficient_space",
        message: "temporary project write failed",
      }),
    );

    vi.mocked(invoke).mockRejectedValueOnce({ category: "not_a_real_category" });
    await expect(
      atomicWriteProject({
        projectPath: "/project.easl",
        canonicalBytes: "{}",
        preserveBackup: false,
      }),
    ).rejects.toMatchObject({ category: "temporary_write" });
  });
});

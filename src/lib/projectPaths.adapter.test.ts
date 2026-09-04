import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inspectSourcePath } from "./projectPaths";

describe("inspectSourcePath", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("uses the typed read-only native command", async () => {
    const inspection = {
      absolutePath: "/project/sourcedata",
      exists: true,
      readable: true,
      isDirectory: true,
      ownership: "internal" as const,
      projectRelativePath: "./sourcedata",
    };
    vi.mocked(invoke).mockResolvedValue(inspection);

    await expect(inspectSourcePath("/project", "/project/sourcedata")).resolves.toEqual(inspection);
    expect(invoke).toHaveBeenCalledWith("inspect_source_path", {
      projectRoot: "/project",
      sourcePath: "/project/sourcedata",
    });
  });
});

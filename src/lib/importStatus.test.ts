import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import type { ImportSubjectStatus } from "./importStatus";
import { readImportStatus } from "./importStatus";

describe("readImportStatus", () => {
  it("invokes read_import_status with projectRoot and returns parsed statuses", async () => {
    const mockStatuses: ImportSubjectStatus[] = [
      { subject: "sub-01", status: "completed" },
      { subject: "sub-02", status: "failed" },
    ];

    vi.mocked(invoke).mockResolvedValueOnce(mockStatuses);

    const result = await readImportStatus("/tmp/project");

    expect(invoke).toHaveBeenCalledWith("read_import_status", {
      projectRoot: "/tmp/project",
    });
    expect(result).toEqual(mockStatuses);
  });

  it("returns empty array when no subjects have lock files", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const result = await readImportStatus("/tmp/empty_project");

    expect(result).toEqual([]);
  });
});
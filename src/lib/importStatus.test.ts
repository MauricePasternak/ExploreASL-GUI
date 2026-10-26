import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import type { ImportSubjectStatus } from "./importStatus";
import { readImportStatus } from "./importStatus";

describe("readImportStatus", () => {
  it("invokes active-project-owned read_import_status and returns native statuses", async () => {
    const mockStatuses: ImportSubjectStatus[] = [
      { subject: "sub-01", status: "completed" },
      { subject: "sub-02", status: "failed" },
    ];

    vi.mocked(invoke).mockResolvedValueOnce(mockStatuses);

    const result = await readImportStatus();

    expect(invoke).toHaveBeenCalledWith("read_import_status");
    expect(result).toEqual(mockStatuses);
  });

  it("returns empty array when no subjects have lock files", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const result = await readImportStatus();

    expect(result).toEqual([]);
  });
});

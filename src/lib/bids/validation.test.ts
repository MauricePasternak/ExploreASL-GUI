import { beforeEach, describe, expect, it, vi } from "vitest";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isBidsProject, ensureBidsIgnore } from "./validation";

describe("validation", () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset();
    vi.mocked(readTextFile).mockReset();
    vi.mocked(writeTextFile).mockReset();
  });

  describe("isBidsProject", () => {
    it("returns true if dataset_description.json exists", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      const result = await isBidsProject("/tmp/project");
      expect(exists).toHaveBeenCalledWith("/tmp/project/dataset_description.json");
      expect(result).toBe(true);
    });

    it("returns false if dataset_description.json does not exist", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      const result = await isBidsProject("/tmp/project");
      expect(exists).toHaveBeenCalledWith("/tmp/project/dataset_description.json");
      expect(result).toBe(false);
    });

    it("returns false if exists throws an error", async () => {
      vi.mocked(exists).mockRejectedValue(new Error("FS Error"));
      const result = await isBidsProject("/tmp/project");
      expect(result).toBe(false);
    });
  });

  describe("ensureBidsIgnore", () => {
    it("creates .bidsignore with default entries when it does not exist", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await ensureBidsIgnore("/tmp/project");

      expect(exists).toHaveBeenCalledWith("/tmp/project/.bidsignore");
      expect(writeTextFile).toHaveBeenCalledWith(
        "/tmp/project/.bidsignore",
        "project.easl\n.easl_staging\n",
      );
    });

    it("appends only missing entries to an existing .bidsignore", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("some-other-file\nproject.easl");
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await ensureBidsIgnore("/tmp/project");

      expect(exists).toHaveBeenCalledWith("/tmp/project/.bidsignore");
      expect(readTextFile).toHaveBeenCalledWith("/tmp/project/.bidsignore");
      expect(writeTextFile).toHaveBeenCalledWith(
        "/tmp/project/.bidsignore",
        "some-other-file\nproject.easl\n.easl_staging\n",
      );
    });

    it("does not write if all entries already exist in .bidsignore", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("project.easl\n.easl_staging\n");

      await ensureBidsIgnore("/tmp/project");

      expect(exists).toHaveBeenCalledWith("/tmp/project/.bidsignore");
      expect(readTextFile).toHaveBeenCalledWith("/tmp/project/.bidsignore");
      expect(writeTextFile).not.toHaveBeenCalled();
    });

    it("handles trailing/leading whitespaces when matching lines", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("  project.easl \n  .easl_staging\t");

      await ensureBidsIgnore("/tmp/project");

      expect(writeTextFile).not.toHaveBeenCalled();
    });
  });
});

import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { buildImportPlan } from "./importPlan";
import { fingerprintImportPlan, preflightStagingPlan } from "./stagingPreflight";

const buildPlan = () =>
  buildImportPlan({
    rawPaths: [],
    sourceRoot: "/source",
    pathPatterns: [],
    tokenizerConfigs: {},
    subjectRenames: [],
    sessionAliases: [],
    runAliases: [],
    modalityAliases: [],
    tokenSubDelimiters: ["_"],
    bMatchDirectories: true,
    metadataGroups: [],
    subjectRows: [],
  });

describe("staging preflight client", () => {
  it("sends the native wire payload and parses a valid response", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ valid: true, issues: [] });
    await expect(preflightStagingPlan([])).resolves.toEqual({
      valid: true,
      issues: [],
    });
    expect(invoke).toHaveBeenCalledWith("preflight_staging_plan", {
      stagingEntries: [],
    });
  });

  it("fails closed on malformed native responses", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ valid: "yes", issues: [] });
    await expect(preflightStagingPlan([])).rejects.toThrow();
  });

  it("accepts the stable nested destination symlink issue", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      valid: false,
      issues: [
        {
          code: "DESTINATION_SYMLINK",
          field: "destination",
          entryIndex: 0,
          message: "Destination contains an existing symlink component.",
        },
      ],
    });

    await expect(preflightStagingPlan([])).resolves.toMatchObject({
      valid: false,
      issues: [{ code: "DESTINATION_SYMLINK", field: "destination", entryIndex: 0 }],
    });
  });

  it("changes fingerprint with root, sources, tokenizer, aliases, renames, and modalities", () => {
    const plan = buildPlan();
    expect(fingerprintImportPlan("/a", plan)).not.toBe(fingerprintImportPlan("/b", plan));
    const mutations: Array<(value: ReturnType<typeof buildPlan>) => void> = [
      (value) => value.fingerprintInput.rawPaths.push("/source/one"),
      (value) => {
        value.fingerprintInput.tokenizerConfigs.pattern = [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
        ];
      },
      (value) =>
        value.fingerprintInput.sessionAliases.push({ captured: "one", alias: "01", index: 1 }),
      (value) =>
        value.fingerprintInput.runAliases.push({ captured: "one", alias: "ASL_2", index: 1 }),
      (value) => value.fingerprintInput.subjectRenames.push({ original: "one", target: "ONE" }),
      (value) => value.fingerprintInput.modalityAliases.push({ captured: "asl", mapped: "ASL4D" }),
    ];
    for (const mutate of mutations) {
      const changed = buildPlan();
      mutate(changed);
      expect(fingerprintImportPlan("/a", plan)).not.toBe(fingerprintImportPlan("/a", changed));
    }
  });
});

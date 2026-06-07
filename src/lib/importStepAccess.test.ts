import { describe, expect, it } from "vitest";

import {
  canSelectImportStep,
  getMaxUnlockedImportStep,
  isAliasResolutionComplete,
  isIngestionComplete,
  isTokenizerComplete,
} from "./importStepAccess";
import type { PathPattern } from "../schemas/importSchemas";

const PATTERN: PathPattern = {
  signature: "VARYING/VARYING",
  samplePath: "SUB/ASL",
  blocks: ["SUB", "ASL"],
  uniqueNames: { 0: ["SUB"], 1: ["ASL"] },
  count: 1,
  depth: 2,
};

describe("importStepAccess", () => {
  it("requires ingestion results before unlocking tokenizer", () => {
    expect(
      isIngestionComplete({ ingestionComplete: false, pathPatterns: [] }),
    ).toBe(false);
    expect(
      getMaxUnlockedImportStep({
        ingestionComplete: false,
        pathPatterns: [],
        tokenizerConfigs: {},
        modalityAliases: [],
      }),
    ).toBe(0);
  });

  it("unlocks tokenizer after ingestion", () => {
    const state = {
      ingestionComplete: true,
      pathPatterns: [PATTERN],
      tokenizerConfigs: {},
      modalityAliases: [],
    };

    expect(isIngestionComplete(state)).toBe(true);
    expect(getMaxUnlockedImportStep(state)).toBe(1);
    expect(canSelectImportStep(2, state)).toBe(false);
  });

  it("unlocks alias step only after Subject and Modality are assigned", () => {
    const incomplete = {
      ingestionComplete: true,
      pathPatterns: [PATTERN],
      tokenizerConfigs: {
        "VARYING/VARYING": [{ blockIndex: 0, subBlockIndex: null, tag: "Subject" as const }],
      },
      modalityAliases: [],
    };

    expect(isTokenizerComplete(incomplete)).toBe(false);
    expect(getMaxUnlockedImportStep(incomplete)).toBe(1);

    const tokenized = {
      ...incomplete,
      tokenizerConfigs: {
        "VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" as const },
          { blockIndex: 1, subBlockIndex: null, tag: "Modality" as const },
        ],
      },
    };

    expect(isTokenizerComplete(tokenized)).toBe(true);
    expect(getMaxUnlockedImportStep(tokenized)).toBe(2);
    expect(canSelectImportStep(3, tokenized)).toBe(false);
  });

  it("requires ASL4D or T1w mapping before unlocking metadata", () => {
    const tokenized = {
      ingestionComplete: true,
      pathPatterns: [PATTERN],
      tokenizerConfigs: {
        "VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" as const },
          { blockIndex: 1, subBlockIndex: null, tag: "Modality" as const },
        ],
      },
      modalityAliases: [{ captured: "ASL", mapped: null }],
    };

    expect(isAliasResolutionComplete(tokenized)).toBe(false);
    expect(getMaxUnlockedImportStep(tokenized)).toBe(2);

    const mapped = {
      ...tokenized,
      modalityAliases: [{ captured: "ASL", mapped: "ASL4D" as const }],
    };

    expect(isAliasResolutionComplete(mapped)).toBe(true);
    expect(getMaxUnlockedImportStep(mapped)).toBe(4);
    expect(canSelectImportStep(3, mapped)).toBe(true);
  });
});

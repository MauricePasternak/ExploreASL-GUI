import { describe, expect, it } from "vitest";

import {
  canEnterStep5,
  canSelectImportStep,
  getMaxUnlockedImportStep,
  hasValidExecutionProfile,
  isAliasResolutionComplete,
  isIngestionComplete,
  isTokenizerComplete,
  TOTAL_IMPORT_STEPS,
} from "./importStepAccess";
import type { PathPattern } from "../schemas/importSchemas";
import { makeMatlabProfile } from "../test/profileFixtures";

const PATTERN: PathPattern = {
  signature: "VARYING/VARYING",
  samplePath: "SUB/ASL",
  blocks: ["SUB", "ASL"],
  uniqueNames: { 0: ["SUB"], 1: ["ASL"] },
  count: 1,
  depth: 2,
};

const VALID_METADATA = {
  id: "global-defaults",
  label: "Global Defaults",
  bidsParams: {
    ArterialSpinLabelingType: "PCASL" as const,
    PostLabelingDelay: [1.8],
    MRAcquisitionType: "3D" as const,
    MagneticFieldStrength: 3,
    Manufacturer: "Siemens" as const,
    ASLContext: "control,label",
    M0Type: "Separate" as const,
    LabelingDuration: 1.8,
    BackgroundSuppression: false,
  },
};

const profile = makeMatlabProfile({ id: "profile-1" });
const VALID_GATE = {
  executionProfiles: [profile],
  profileValidationState: {
    [profile.id]: { valid: true, errors: [] },
  },
};

const READY_FOR_PREVIEW_STATE = {
  ingestionComplete: true,
  pathPatterns: [PATTERN],
  tokenizerConfigs: {
    "VARYING/VARYING": [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" as const },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" as const },
    ],
  },
  modalityAliases: [{ captured: "ASL", mapped: "ASL4D" as const }],
  sessionAliases: [],
  runAliases: [],
  bMatchDirectories: true,
  metadataGroups: [VALID_METADATA],
  subjectRows: [{ id: "SUB/01", subject: "SUB", session: "01", groupId: "global-defaults" }],
};

describe("importStepAccess", () => {
  it("defines six import wizard steps", () => {
    expect(TOTAL_IMPORT_STEPS).toBe(6);
  });

  it("requires ingestion results before unlocking tokenizer", () => {
    expect(isIngestionComplete({ ingestionComplete: false, pathPatterns: [] })).toBe(false);
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

  it("keeps run import locked until metadata and valid profile gate are satisfied", () => {
    expect(hasValidExecutionProfile(VALID_GATE)).toBe(true);
    expect(canEnterStep5(READY_FOR_PREVIEW_STATE, VALID_GATE)).toBe(true);
    expect(getMaxUnlockedImportStep(READY_FOR_PREVIEW_STATE, VALID_GATE)).toBe(5);
    expect(canSelectImportStep(5, READY_FOR_PREVIEW_STATE, VALID_GATE)).toBe(true);

    expect(
      canEnterStep5(
        {
          ...READY_FOR_PREVIEW_STATE,
          metadataGroups: [{ ...VALID_METADATA, bidsParams: {} }],
        },
        VALID_GATE,
      ),
    ).toBe(false);

    expect(
      canEnterStep5(READY_FOR_PREVIEW_STATE, {
        executionProfiles: [],
        profileValidationState: {},
      }),
    ).toBe(false);

    expect(
      canEnterStep5(READY_FOR_PREVIEW_STATE, {
        executionProfiles: [profile],
        profileValidationState: {
          [profile.id]: { valid: false, errors: ["MATLAB not found"] },
        },
      }),
    ).toBe(false);
  });
});

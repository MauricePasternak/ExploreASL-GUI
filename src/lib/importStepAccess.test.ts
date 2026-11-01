import { describe, expect, it } from "vitest";

import {
  canEnterStep5,
  hasValidExecutionProfile,
  isAliasResolutionComplete,
  isIngestionComplete,
  isTokenizerComplete,
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
const VALID_STAGING_GATE = {
  status: "valid" as const,
  fingerprint: "fingerprint",
  currentFingerprint: "fingerprint",
  localIssueCount: 0,
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
  it("requires ingestion results", () => {
    expect(isIngestionComplete({ ingestionComplete: false, pathPatterns: [] })).toBe(false);
  });

  it("accepts completed ingestion", () => {
    const state = {
      ingestionComplete: true,
      pathPatterns: [PATTERN],
      tokenizerConfigs: {},
      modalityAliases: [],
    };

    expect(isIngestionComplete(state)).toBe(true);
  });

  it("requires Subject and Modality tags to complete tokenization", () => {
    const incomplete = {
      ingestionComplete: true,
      pathPatterns: [PATTERN],
      tokenizerConfigs: {
        "VARYING/VARYING": [{ blockIndex: 0, subBlockIndex: null, tag: "Subject" as const }],
      },
      modalityAliases: [],
    };

    expect(isTokenizerComplete(incomplete)).toBe(false);

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
  });

  it("requires ASL4D or T1w mapping to complete alias resolution", () => {
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

    const mapped = {
      ...tokenized,
      modalityAliases: [{ captured: "ASL", mapped: "ASL4D" as const }],
    };

    expect(isAliasResolutionComplete(mapped)).toBe(true);
  });

  it("keeps run import locked until metadata and valid profile gate are satisfied", () => {
    expect(hasValidExecutionProfile(VALID_GATE)).toBe(true);
    expect(canEnterStep5(READY_FOR_PREVIEW_STATE, VALID_GATE, VALID_STAGING_GATE)).toBe(true);

    expect(
      canEnterStep5(
        {
          ...READY_FOR_PREVIEW_STATE,
          metadataGroups: [{ ...VALID_METADATA, bidsParams: {} }],
        },
        VALID_GATE,
        VALID_STAGING_GATE,
      ),
    ).toBe(false);

    expect(
      canEnterStep5(
        READY_FOR_PREVIEW_STATE,
        {
          executionProfiles: [],
          profileValidationState: {},
        },
        VALID_STAGING_GATE,
      ),
    ).toBe(false);

    expect(
      canEnterStep5(
        READY_FOR_PREVIEW_STATE,
        {
          executionProfiles: [profile],
          profileValidationState: {
            [profile.id]: { valid: false, errors: ["MATLAB not found"] },
          },
        },
        VALID_STAGING_GATE,
      ),
    ).toBe(false);

    for (const status of ["idle", "pending", "invalid", "failed"] as const) {
      expect(
        canEnterStep5(READY_FOR_PREVIEW_STATE, VALID_GATE, {
          ...VALID_STAGING_GATE,
          status,
        }),
      ).toBe(false);
    }
    expect(
      canEnterStep5(READY_FOR_PREVIEW_STATE, VALID_GATE, {
        ...VALID_STAGING_GATE,
        fingerprint: "stale",
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  BidsAslMetadataSchema,
  ImportProgressSchema,
  MetadataGroupSchema,
  ModalityAliasSchema,
  PathPatternSchema,
  SessionAliasSchema,
  SourcestructureJsonSchema,
  StagingEntrySchema,
  StudyParEntrySchema,
  StudyParJsonSchema,
  SubjectRenameSchema,
  SubjectRowSchema,
  TokenAssignmentSchema,
  TokenizerConfigSchema,
} from "./importSchemas";

// ---------------------------------------------------------------------------
// PathPatternSchema
// ---------------------------------------------------------------------------
describe("PathPatternSchema", () => {
  it("accepts valid path pattern", () => {
    const data = {
      signature: "SUBJECT/FIXED/VARYING",
      samplePath: "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
      blocks: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"],
      uniqueNames: {
        "0": ["BAR", "FOO"],
        "1": ["05022026_01"],
        "2": ["sernum-0001_ser-AAHead_Scout", "sernum-0002_ser-AAHead_Scout_MPR_sag"],
      },
      count: 34,
      depth: 3,
    };
    expect(PathPatternSchema.parse(data)).toMatchObject(data);
  });

  it("rejects count < 1", () => {
    const data = {
      signature: "A",
      samplePath: "a",
      blocks: ["a"],
      uniqueNames: {},
      count: 0,
      depth: 1,
    };
    expect(() => PathPatternSchema.parse(data)).toThrow();
  });

  it("rejects depth < 1", () => {
    const data = {
      signature: "A",
      samplePath: "a",
      blocks: ["a"],
      uniqueNames: {},
      count: 1,
      depth: 0,
    };
    expect(() => PathPatternSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TokenAssignmentSchema
// ---------------------------------------------------------------------------
describe("TokenAssignmentSchema", () => {
  it("accepts valid assignment with null subBlockIndex", () => {
    const data = { blockIndex: 0, subBlockIndex: null, tag: "Subject" };
    expect(TokenAssignmentSchema.parse(data)).toMatchObject(data);
  });

  it("accepts valid assignment with numeric subBlockIndex", () => {
    const data = { blockIndex: 2, subBlockIndex: 1, tag: "Modality" };
    expect(TokenAssignmentSchema.parse(data)).toMatchObject(data);
  });

  it("defaults subBlockIndex to null when omitted", () => {
    const data = { blockIndex: 0, tag: "Subject" };
    const result = TokenAssignmentSchema.parse(data);
    expect(result.subBlockIndex).toBeNull();
  });

  it("rejects invalid tag", () => {
    const data = { blockIndex: 0, subBlockIndex: null, tag: "InvalidTag" };
    expect(() => TokenAssignmentSchema.parse(data)).toThrow();
  });

  it("rejects negative blockIndex", () => {
    const data = { blockIndex: -1, subBlockIndex: null, tag: "Subject" };
    expect(() => TokenAssignmentSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TokenizerConfigSchema
// ---------------------------------------------------------------------------
describe("TokenizerConfigSchema", () => {
  it("accepts valid tokenizer config", () => {
    const data = {
      patternSignature: "SUBJECT/FIXED/VARYING",
      folderHierarchy: ["^(.*)$", "^.*$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [0, 1, 2, 3],
      assignments: [
        { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
        { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
      ],
    };
    expect(TokenizerConfigSchema.parse(data)).toMatchObject(data);
  });

  it("rejects tokenOrdering with wrong length", () => {
    const data = {
      patternSignature: "A",
      folderHierarchy: [],
      tokenOrdering: [0, 1, 2],
      assignments: [],
    };
    expect(() => TokenizerConfigSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ModalityAliasSchema
// ---------------------------------------------------------------------------
describe("ModalityAliasSchema", () => {
  it("accepts valid modality alias", () => {
    const data = { captured: "t1_mpr_tra_iso", mapped: "T1w" };
    expect(ModalityAliasSchema.parse(data)).toEqual(data);
  });

  it("accepts null mapped (Ignore)", () => {
    const data = { captured: "PhoenixZIPReport", mapped: null };
    expect(ModalityAliasSchema.parse(data)).toEqual(data);
  });

  it("rejects invalid modality name", () => {
    const data = { captured: "something", mapped: "InvalidModality" };
    expect(() => ModalityAliasSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SessionAliasSchema
// ---------------------------------------------------------------------------
describe("SessionAliasSchema", () => {
  it("accepts valid session alias", () => {
    const data = { captured: "05022026_01", alias: "ASL_1", index: 1 };
    expect(SessionAliasSchema.parse(data)).toEqual(data);
  });

  it("rejects index < 1", () => {
    const data = { captured: "a", alias: "ASL_0", index: 0 };
    expect(() => SessionAliasSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SubjectRenameSchema
// ---------------------------------------------------------------------------
describe("SubjectRenameSchema", () => {
  it("accepts valid subject rename", () => {
    const data = { original: "BAR", target: "sub-BAR" };
    expect(SubjectRenameSchema.parse(data)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// BidsAslMetadataSchema
// ---------------------------------------------------------------------------
describe("BidsAslMetadataSchema", () => {
  it("accepts full valid metadata", () => {
    const data = {
      ArterialSpinLabelingType: "PCASL",
      PostLabelingDelay: [1.8],
      MRAcquisitionType: "3D",
      MagneticFieldStrength: 3,
      LabelingDuration: 1.8,
      PCASLType: "balanced",
      BackgroundSuppression: true,
      BackgroundSuppressionNumberPulses: 4,
      BackgroundSuppressionPulseTime: [1.465, 2.1, 2.6, 2.88],
      Vendor: "Siemens",
      PulseSequenceType: "GRASE",
      M0: true,
    };
    expect(BidsAslMetadataSchema.parse(data)).toMatchObject(data);
  });

  it("accepts empty object (all fields optional)", () => {
    expect(BidsAslMetadataSchema.parse({})).toEqual({});
  });

  it("accepts PostLabelingDelay as single number", () => {
    const data = { PostLabelingDelay: 1.8 };
    expect(BidsAslMetadataSchema.parse(data)).toMatchObject(data);
  });

  it("accepts PostLabelingDelay as array of numbers", () => {
    const data = { PostLabelingDelay: [1.8, 2.0, 2.2] };
    expect(BidsAslMetadataSchema.parse(data)).toMatchObject(data);
  });

  it("allows unknown BIDS fields via passthrough", () => {
    const data = {
      ArterialSpinLabelingType: "PCASL",
      CustomField: "custom_value",
      AnotherField: 42,
    };
    const result = BidsAslMetadataSchema.parse(data);
    expect(result).toMatchObject(data);
  });

  it("rejects invalid ArterialSpinLabelingType", () => {
    expect(() =>
      BidsAslMetadataSchema.parse({ ArterialSpinLabelingType: "INVALID" }),
    ).toThrow();
  });

  it("rejects invalid Vendor", () => {
    expect(() =>
      BidsAslMetadataSchema.parse({ Vendor: "InvalidVendor" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// StudyParJsonSchema
// ---------------------------------------------------------------------------
describe("StudyParJsonSchema", () => {
  it("accepts valid studyPar with one catch-all entry", () => {
    const data = {
      StudyPars: [
        {
          ArterialSpinLabelingType: "PCASL",
          MRAcquisitionType: "3D",
          PostLabelingDelay: [1.8],
        },
      ],
    };
    expect(StudyParJsonSchema.parse(data)).toMatchObject(data);
  });

  it("accepts studyPar with catch-all + override entries", () => {
    const data = {
      StudyPars: [
        {
          ArterialSpinLabelingType: "PCASL",
          MRAcquisitionType: "3D",
        },
        {
          SubjectRegExp: "^BAR$",
          ArterialSpinLabelingType: "PASL",
          MRAcquisitionType: "2D",
        },
      ],
    };
    expect(StudyParJsonSchema.parse(data)).toMatchObject(data);
  });

  it("rejects empty StudyPars array", () => {
    expect(() => StudyParJsonSchema.parse({ StudyPars: [] })).toThrow();
  });

  it("override entry can have SubjectRegExp and SessionRegExp", () => {
    const entry = {
      SubjectRegExp: "^FOO$",
      SessionRegExp: "^01$",
      ArterialSpinLabelingType: "PCASL",
    };
    expect(StudyParEntrySchema.parse(entry)).toMatchObject(entry);
  });
});

// ---------------------------------------------------------------------------
// SourcestructureJsonSchema
// ---------------------------------------------------------------------------
describe("SourcestructureJsonSchema", () => {
  it("accepts valid 4-level sourcestructure", () => {
    const data = {
      folderHierarchy: ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [1, 0, 2, 3],
      tokenSessionAliases: ["^01$", "ASL_1"],
      tokenScanAliases: ["^T1w$", "T1w", "^ASL4D$", "ASL4D"],
      bMatchDirectories: true,
    };
    expect(SourcestructureJsonSchema.parse(data)).toMatchObject(data);
  });

  it("rejects folderHierarchy with wrong length", () => {
    const data = {
      folderHierarchy: ["^(.*)$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [1, 0, 2, 3],
      tokenSessionAliases: [],
      tokenScanAliases: [],
      bMatchDirectories: true,
    };
    expect(() => SourcestructureJsonSchema.parse(data)).toThrow();
  });

  it("rejects tokenOrdering with wrong length", () => {
    const data = {
      folderHierarchy: ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [1, 0, 2],
      tokenSessionAliases: [],
      tokenScanAliases: [],
      bMatchDirectories: true,
    };
    expect(() => SourcestructureJsonSchema.parse(data)).toThrow();
  });

  it("accepts optional dcm2nii_version", () => {
    const data = {
      folderHierarchy: ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [1, 0, 2, 3],
      tokenSessionAliases: [],
      tokenScanAliases: [],
      bMatchDirectories: true,
      dcm2nii_version: "20220720",
    };
    expect(SourcestructureJsonSchema.parse(data)).toMatchObject(data);
  });
});

// ---------------------------------------------------------------------------
// ImportProgressSchema
// ---------------------------------------------------------------------------
describe("ImportProgressSchema", () => {
  it("accepts valid pending progress", () => {
    const data = { subject: "BAR", session: "01", status: "pending" };
    expect(ImportProgressSchema.parse(data)).toMatchObject(data);
  });

  it("accepts valid running progress with step", () => {
    const data = {
      subject: "BAR",
      session: "01",
      status: "running",
      currentStep: "DCM2NII",
    };
    expect(ImportProgressSchema.parse(data)).toMatchObject(data);
  });

  it("accepts failed progress with error", () => {
    const data = {
      subject: "BAR",
      session: "01",
      status: "failed",
      error: "NII2BIDS failed for BAR",
    };
    expect(ImportProgressSchema.parse(data)).toMatchObject(data);
  });

  it("rejects invalid status", () => {
    expect(() =>
      ImportProgressSchema.parse({
        subject: "BAR",
        session: "01",
        status: "unknown",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MetadataGroupSchema
// ---------------------------------------------------------------------------
describe("MetadataGroupSchema", () => {
  it("accepts valid metadata group with defaults", () => {
    const data = {
      id: "global-defaults",
      label: "Global Defaults",
      bidsParams: { ArterialSpinLabelingType: "PCASL" },
    };
    const result = MetadataGroupSchema.parse(data);
    expect(result.subjectRegExp).toBe("");
    expect(result.sessionRegExp).toBe("");
    expect(result.runRegExp).toBe("");
  });

  it("accepts override group with regex", () => {
    const data = {
      id: "override-1",
      label: "BAR Override",
      bidsParams: { ArterialSpinLabelingType: "PASL" },
      subjectRegExp: "^BAR$",
      sessionRegExp: "^01$",
      runRegExp: "",
    };
    expect(MetadataGroupSchema.parse(data)).toMatchObject(data);
  });
});

// ---------------------------------------------------------------------------
// SubjectRowSchema
// ---------------------------------------------------------------------------
describe("SubjectRowSchema", () => {
  it("accepts valid subject row", () => {
    const data = {
      id: "BAR/01/01",
      subject: "BAR",
      session: "01",
      run: "01",
      groupId: "global-defaults",
    };
    expect(SubjectRowSchema.parse(data)).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// StagingEntrySchema
// ---------------------------------------------------------------------------
describe("StagingEntrySchema", () => {
  it("accepts valid staging entry", () => {
    const data = {
      subject: "BAR",
      session: "01",
      run: "01",
      modality: "T1w",
      sourcePath: "/path/to/BAR/05022026_01/sernum-0024_ser-t1_mpr_tra_iso",
    };
    expect(StagingEntrySchema.parse(data)).toEqual(data);
  });
});

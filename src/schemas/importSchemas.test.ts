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
  validateBidsMetadataGroup,
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
      tokenOrdering: [1, 2, 3, 4],
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
  const validBase = {
    ArterialSpinLabelingType: "PCASL" as const,
    PostLabelingDelay: 1.8,
    MRAcquisitionType: "3D" as const,
    MagneticFieldStrength: 3,
    Manufacturer: "Siemens" as const,
    M0Type: "Integrated" as const,
    ASLContext: "m0scan,deltam",
    LabelingDuration: 1.8,
  };

  it("accepts full valid metadata", () => {
    const data = {
      ...validBase,
      PCASLType: "balanced" as const,
      BackgroundSuppression: true,
      BackgroundSuppressionNumberPulses: 4,
      BackgroundSuppressionPulseTime: [1.465, 2.1, 2.6, 2.88],
      PulseSequenceType: "GRASE" as const,
      M0_GMScaleFactor: 1.5,
    };
    expect(BidsAslMetadataSchema.parse(data)).toMatchObject(data);
  });

  it("rejects empty object (required fields missing)", () => {
    expect(() => BidsAslMetadataSchema.parse({})).toThrow();
  });

  it("accepts PostLabelingDelay as single number", () => {
    const data = { ...validBase, PostLabelingDelay: 1.8 };
    expect(BidsAslMetadataSchema.parse(data)).toMatchObject(data);
  });

  it("accepts PostLabelingDelay as array of numbers", () => {
    const data = { ...validBase, PostLabelingDelay: [1.8, 2.0, 2.2] };
    expect(BidsAslMetadataSchema.parse(data)).toMatchObject(data);
  });

  it("allows unknown BIDS fields via passthrough", () => {
    const data = {
      ...validBase,
      CustomField: "custom_value",
      AnotherField: 42,
    };
    const result = BidsAslMetadataSchema.parse(data);
    expect(result).toMatchObject(data);
  });

  it("rejects invalid ArterialSpinLabelingType", () => {
    expect(() =>
      BidsAslMetadataSchema.parse({ ...validBase, ArterialSpinLabelingType: "INVALID" as any }),
    ).toThrow();
  });

  it("rejects invalid Manufacturer", () => {
    expect(() =>
      BidsAslMetadataSchema.parse({ ...validBase, Manufacturer: "InvalidManufacturer" as any }),
    ).toThrow();
  });

  it("rejects invalid BolusCutOffTechnique", () => {
    expect(() =>
      BidsAslMetadataSchema.parse({
        ...validBase,
        BolusCutOffTechnique: "InvalidTechnique" as any,
      }),
    ).toThrow();
  });

  it("rejects invalid M0_GMScaleFactor <= 0", () => {
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, M0_GMScaleFactor: 0 })).toThrow();
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, M0_GMScaleFactor: -0.5 })).toThrow();
  });

  it("accepts string representation of number or array of numbers and parses it", () => {
    // Single integer
    expect(BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: "2" })).toMatchObject({
      PostLabelingDelay: 2,
    });
    // Single float
    expect(BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: "3.14" })).toMatchObject({
      PostLabelingDelay: 3.14,
    });
    // Comma-separated floats & ints
    expect(
      BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: "1.8, 2, 2.2" }),
    ).toMatchObject({
      PostLabelingDelay: [1.8, 2, 2.2],
    });
  });

  it("rejects invalid string inputs for comma number or array fields", () => {
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: "1.a" })).toThrow();
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: "abc" })).toThrow();
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, SliceTiming: "1, a, 3" })).toThrow();
  });

  it("enforces matching number of elements between PostLabelingDelay and BolusCutOffDelayTime if multiple values are provided", () => {
    // Valid: both single values
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: 1.8,
        BolusCutOffDelayTime: 0.8,
      }),
    ).toMatchObject({
      PostLabelingDelay: 1.8,
      BolusCutOffDelayTime: 0.8,
    });

    // Valid: both arrays of same length
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: [1.8, 2.0],
        BolusCutOffDelayTime: [0.8, 0.9],
      }),
    ).toMatchObject({
      PostLabelingDelay: [1.8, 2.0],
      BolusCutOffDelayTime: [0.8, 0.9],
    });

    // Invalid: array vs single
    expect(() =>
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: [1.8, 2.0],
        BolusCutOffDelayTime: 0.8,
      }),
    ).toThrow();

    // Invalid: differing array lengths
    expect(() =>
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: [1.8, 2.0],
        BolusCutOffDelayTime: [0.8, 0.9, 1.0],
      }),
    ).toThrow();
  });

  it("enforces matching zero index positions between PostLabelingDelay and BolusCutOffDelayTime", () => {
    // Valid: matching zero positions
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: [1.8, 0, 2.0],
        BolusCutOffDelayTime: [0.8, 0, 0.9],
      }),
    ).toMatchObject({
      PostLabelingDelay: [1.8, 0, 2.0],
      BolusCutOffDelayTime: [0.8, 0, 0.9],
    });

    // Invalid: mismatching zero positions
    expect(() =>
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: [1.8, 0, 2.0],
        BolusCutOffDelayTime: [0.8, 0.9, 0],
      }),
    ).toThrow();
  });

  it("accepts ASLContext with comma-separated control,label,m0scan,deltam tokens", () => {
    expect(
      BidsAslMetadataSchema.parse({ ...validBase, ASLContext: "m0scan,deltam" }),
    ).toMatchObject({ ASLContext: "m0scan,deltam" });
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        ASLContext: "control,label",
        M0Type: "Separate",
      }),
    ).toMatchObject({ ASLContext: "control,label", M0Type: "Separate" });
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        ASLContext: "m0scan, label, control, label, control",
      }),
    ).toMatchObject({ ASLContext: "m0scan, label, control, label, control" });
  });

  it("rejects ASLContext with invalid tokens", () => {
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, ASLContext: "cbf" })).toThrow();
    expect(() =>
      BidsAslMetadataSchema.parse({ ...validBase, ASLContext: "control,label,invalid" }),
    ).toThrow();
  });

  it("rejects M0Type 'integrated' when ASLContext does not contain m0scan", () => {
    expect(() =>
      BidsAslMetadataSchema.parse({
        ...validBase,
        ASLContext: "control,label",
        M0Type: "Integrated",
      }),
    ).toThrow();
  });

  it("accepts M0Type 'separate' when ASLContext does not contain m0scan", () => {
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        ASLContext: "control,label",
        M0Type: "Separate",
      }),
    ).toMatchObject({ M0Type: "Separate" });
  });

  it("rejects PostLabelingDelay, BolusCutOffDelayTime, and LabelingDuration values outside [0.01, 10] range (excluding 0)", () => {
    // PostLabelingDelay too high (e.g. milliseconds)
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: 1800 })).toThrow();
    // PostLabelingDelay too low (excluding 0)
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, PostLabelingDelay: 0.005 })).toThrow();
    // BolusCutOffDelayTime too high
    expect(() =>
      BidsAslMetadataSchema.parse({
        ...validBase,
        ArterialSpinLabelingType: "PASL",
        BolusCutOffFlag: true,
        BolusCutOffDelayTime: 1200,
        BolusCutOffTechnique: "Q2TIPS",
      }),
    ).toThrow();
    // LabelingDuration too high
    expect(() => BidsAslMetadataSchema.parse({ ...validBase, LabelingDuration: 1500 })).toThrow();
    // Accepts 0 as a valid special value
    expect(
      BidsAslMetadataSchema.parse({
        ...validBase,
        PostLabelingDelay: [1.8, 0, 2.0],
      }),
    ).toMatchObject({ PostLabelingDelay: [1.8, 0, 2.0] });
  });
});

// ---------------------------------------------------------------------------
// validateBidsMetadataGroup
// ---------------------------------------------------------------------------
describe("validateBidsMetadataGroup", () => {
  const validData = {
    ArterialSpinLabelingType: "PCASL" as const,
    PostLabelingDelay: [1.8],
    MRAcquisitionType: "3D" as const,
    MagneticFieldStrength: 3,
    EchoTime: 0.014,
    RepetitionTimePreparation: 4,
    Manufacturer: "Siemens" as const,
    M0Type: "Integrated" as const,
    ASLContext: "m0scan,deltam",
    LabelingDuration: 1.8,
  };

  it("returns no errors for complete valid metadata", () => {
    expect(validateBidsMetadataGroup(validData)).toEqual([]);
  });

  it("flags missing required base fields", () => {
    const errors = validateBidsMetadataGroup({});
    expect(errors).toContain("Arterial Spin Labeling Type is required.");
    expect(errors).toContain("Post Labeling Delay is required.");
    expect(errors).toContain("MR Acquisition Type is required.");
    expect(errors).toContain("Magnetic Field Strength is required.");
    expect(errors).not.toContain("Echo Time is required.");
    expect(errors).not.toContain("Repetition Time Preparation is required.");
    expect(errors).toContain("Manufacturer is required.");
    expect(errors).toContain("ASL Context is required.");
    expect(errors).toContain("M0 Type is required when ASL Context does not contain 'm0scan'.");
  });

  it("flags M0Type 'integrated' as invalid when no m0scan in ASLContext", () => {
    const errors = validateBidsMetadataGroup({
      ...validData,
      ASLContext: "control,label",
      M0Type: "Integrated",
    });
    expect(errors).toContain(
      "M0 Type cannot be 'Integrated' when ASL Context does not contain 'm0scan'.",
    );
  });

  it("auto-accepts M0Type 'integrated' when m0scan is in ASLContext", () => {
    const errors = validateBidsMetadataGroup({
      ...validData,
      M0Type: "Integrated",
      ASLContext: "m0scan,deltam",
    });
    expect(errors).not.toContain(
      "M0 Type cannot be 'Integrated' when ASL Context does not contain 'm0scan'.",
    );
  });

  it("does not require M0Type when m0scan is in ASLContext", () => {
    const errors = validateBidsMetadataGroup({
      ...validData,
      M0Type: undefined,
      ASLContext: "m0scan,deltam",
    });
    expect(errors).not.toContain("M0 Type is required when ASL Context does not contain 'm0scan'.");
  });

  it("flags missing LabelingDuration for PCASL or CASL", () => {
    const data = { ...validData, LabelingDuration: undefined };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain("Labeling Duration is required for PCASL.");
  });

  it("flags missing BolusCutOffDelayTime or BolusCutOffTechnique for PASL with flag enabled", () => {
    const data = {
      ...validData,
      ArterialSpinLabelingType: "PASL" as const,
      BolusCutOffFlag: true,
      BolusCutOffDelayTime: undefined,
      BolusCutOffTechnique: undefined,
    };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain(
      "Bolus Cut Off Delay Time is required when Bolus Cut Off Flag is enabled.",
    );
    expect(errors).toContain(
      "Bolus Cut Off Technique is required when Bolus Cut Off Flag is enabled.",
    );
  });

  it("flags missing BackgroundSuppressionNumberPulses when background suppression is enabled", () => {
    const data = {
      ...validData,
      BackgroundSuppression: true,
      BackgroundSuppressionNumberPulses: undefined,
      BackgroundSuppressionPulseTime: undefined,
    };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain(
      "Background Suppression Number Pulses is required when Background Suppression is enabled.",
    );
    expect(errors).not.toContain(
      "Background Suppression Pulse Time is required when Background Suppression is enabled.",
    );
  });

  it("flags missing SliceTiming when MR Acquisition Type is 2D", () => {
    const data = {
      ...validData,
      MRAcquisitionType: "2D" as const,
      SliceTiming: undefined,
    };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain("Slice Timing is required when MR Acquisition Type is 2D.");
  });

  it("flags mismatch in number of elements for PostLabelingDelay and BolusCutOffDelayTime when multiple values are provided", () => {
    const data = {
      ...validData,
      PostLabelingDelay: [1.8, 2.0],
      BolusCutOffDelayTime: [0.8],
    };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain(
      "Post Labeling Delay and Bolus Cut Off Delay Time must have the same number of elements.",
    );
  });

  it("flags mismatch in zero positions for PostLabelingDelay and BolusCutOffDelayTime", () => {
    const data = {
      ...validData,
      PostLabelingDelay: [1.8, 0, 2.0],
      BolusCutOffDelayTime: [0.8, 0.9, 0],
    };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain(
      "Zeros in Post Labeling Delay and Bolus Cut Off Delay Time must be at the same positions.",
    );
  });

  it("flags values outside [0.01, 10] range (excluding 0) for ASL parameters", () => {
    const data = {
      ...validData,
      PostLabelingDelay: [1800], // ms instead of seconds
      LabelingDuration: [0.002], // too small
    };
    const errors = validateBidsMetadataGroup(data);
    expect(errors).toContain("Post Labeling Delay must be between 0.01 and 10 seconds.");
    expect(errors).toContain("Labeling Duration must be between 0.01 and 10 seconds.");
  });

  it("flags unsupported PulseSequenceType + MRAcquisitionType combinations", () => {
    expect(
      validateBidsMetadataGroup({
        ...validData,
        PulseSequenceType: "EPI",
        MRAcquisitionType: "3D",
      }),
    ).toContain("EPI readout with 3D acquisition is not supported by ExploreASL");

    expect(
      validateBidsMetadataGroup({
        ...validData,
        PulseSequenceType: "GRASE",
        MRAcquisitionType: "2D",
      }),
    ).toContain("GRASE readout with 2D acquisition is not supported by ExploreASL");

    expect(
      validateBidsMetadataGroup({
        ...validData,
        PulseSequenceType: "spiral",
        MRAcquisitionType: "2D",
      }),
    ).toContain("spiral readout with 2D acquisition is not supported by ExploreASL");
  });

  it("accepts supported PulseSequenceType + MRAcquisitionType combinations", () => {
    expect(
      validateBidsMetadataGroup({
        ...validData,
        PulseSequenceType: "EPI",
        MRAcquisitionType: "2D",
      }),
    ).not.toContain(expect.stringContaining("not supported by ExploreASL"));

    expect(
      validateBidsMetadataGroup({
        ...validData,
        PulseSequenceType: "GRASE",
        MRAcquisitionType: "3D",
      }),
    ).not.toContain(expect.stringContaining("not supported by ExploreASL"));

    expect(
      validateBidsMetadataGroup({
        ...validData,
        PulseSequenceType: "spiral",
        MRAcquisitionType: "3D",
      }),
    ).not.toContain(expect.stringContaining("not supported by ExploreASL"));
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
          MagneticFieldStrength: 3,
          Manufacturer: "Siemens",
          ASLContext: "control,label",
          M0Type: "Separate",
          LabelingDuration: 1.8,
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
          PostLabelingDelay: [1.8],
          MagneticFieldStrength: 3,
          Manufacturer: "Siemens",
          ASLContext: "control,label",
          M0Type: "Separate",
          LabelingDuration: 1.8,
        },
        {
          SubjectRegExp: "^BAR$",
          ArterialSpinLabelingType: "PASL",
          MRAcquisitionType: "3D",
          PostLabelingDelay: [1.8],
          MagneticFieldStrength: 3,
          Manufacturer: "Philips",
          ASLContext: "control,label",
          M0Type: "Separate",
        },
      ],
    };
    expect(StudyParJsonSchema.parse(data)).toMatchObject(data);
  });

  it("rejects empty StudyPars array", () => {
    expect(() => StudyParJsonSchema.parse({ StudyPars: [] })).toThrow();
  });

  it("override entry can have SubjectRegExp and VisitRegExp", () => {
    const entry = {
      SubjectRegExp: "^FOO$",
      VisitRegExp: "^01$",
      ArterialSpinLabelingType: "PCASL",
      MRAcquisitionType: "3D",
      PostLabelingDelay: [1.8],
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      ASLContext: "control,label",
      M0Type: "Separate",
      LabelingDuration: 1.8,
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
      tokenOrdering: [1, 2, 3, 4],
      tokenSessionAliases: ["^01$", "ASL_1"],
      tokenVisitAliases: ["01", "01", "02", "02"],
      tokenScanAliases: ["^T1w$", "T1w", "^ASL4D$", "ASL4D"],
      bMatchDirectories: true,
    };
    expect(SourcestructureJsonSchema.parse(data)).toMatchObject(data);
  });

  it("accepts sourcestructure without tokenVisitAliases (optional)", () => {
    const data = {
      folderHierarchy: ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [1, 2, 3, 4],
      tokenSessionAliases: ["^01$", "ASL_1"],
      tokenScanAliases: ["^T1w$", "T1w"],
      bMatchDirectories: true,
    };
    const parsed = SourcestructureJsonSchema.parse(data);
    expect(parsed.tokenVisitAliases).toBeUndefined();
  });

  it("accepts sourcestructure with empty tokenVisitAliases", () => {
    const data = {
      folderHierarchy: ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
      tokenOrdering: [1, 2, 3, 4],
      tokenSessionAliases: ["^01$", "ASL_1"],
      tokenVisitAliases: [],
      tokenScanAliases: [],
      bMatchDirectories: true,
    };
    expect(SourcestructureJsonSchema.parse(data).tokenVisitAliases).toEqual([]);
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

  it("accepts execution details for cancelled or failed progress", () => {
    const data = {
      subject: "BAR",
      session: "01",
      status: "cancelled",
      errorStep: "NII2BIDS",
      warnings: ["Missing optional M0 image"],
      duration: 42,
    };

    expect(ImportProgressSchema.parse(data)).toEqual(data);
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
      bidsParams: {
        ArterialSpinLabelingType: "PCASL",
        MRAcquisitionType: "3D",
        PostLabelingDelay: [1.8],
        MagneticFieldStrength: 3,
        Manufacturer: "Siemens",
        ASLContext: "control,label",
        M0Type: "Separate",
        LabelingDuration: 1.8,
      },
    };
    const result = MetadataGroupSchema.parse(data);
    expect(result.id).toBe("global-defaults");
    expect(result.label).toBe("Global Defaults");
  });

  it("accepts override group", () => {
    const data = {
      id: "override-1",
      label: "BAR Override",
      bidsParams: {
        ArterialSpinLabelingType: "PASL",
        MRAcquisitionType: "3D",
        PostLabelingDelay: [1.8],
        MagneticFieldStrength: 3,
        Manufacturer: "Philips",
        ASLContext: "control,label",
        M0Type: "Separate",
      },
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
      id: "BAR/01",
      subject: "BAR",
      session: "01",
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

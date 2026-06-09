import { describe, expect, it } from "vitest";

import {
  ATLAS_OPTIONS,
  FIELD_METADATA,
  M0_OPTIONS,
  type FieldMeta,
  type SectionId,
  type Tier,
  type WidgetType,
} from "./dataParFieldMetadata";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every key mentioned in the spec must have a FIELD_METADATA entry. */
const ALL_EXPECTED_KEYS = [
  // m0
  "M0",
  "BackgroundSuppressionNumberPulses",
  "BackgroundSuppressionPulseTime",
  "M0_GMScaleFactor",
  "bRegisterM02ASL",
  "M0_conventionalProcessing",
  "RepetitionTimePreparationM0",
  // quantification
  "nCompartments",
  "Lambda",
  "T2art",
  "T1blood",
  "T1GM",
  "T1WM",
  "T2GM",
  "T2WM",
  "T2tissueMultiTE",
  "bUseExternalQuantification",
  "ExternalQuantificationType",
  "ExternalQuantificationSmoothGaussianMM",
  "bMaskingExternal",
  "bSpatialBASIL",
  "bInferT1BASIL",
  "bInferATTBASIL",
  "ExchBASIL",
  "DispBASIL",
  "ATTSDBASIL",
  "bCleanUpExternal",
  // generalSettings
  "Quality",
  "DELETETEMP",
  "SkipIfNoFlair",
  "SkipIfNoASL",
  "SkipIfNoM0",
  "stopAfterErrors",
  "bLesionFilling",
  "bAutoACPC",
  // aslProcessing
  "motionCorrection",
  "bTopUp",
  "bPVCNativeSpace",
  "bPVCGaussianMM",
  "PVCNativeSpaceKernel",
  "SaveCBF4D",
  "SpikeRemovalThreshold",
  "SpikeRemovalAbsoluteThreshold",
  "bRegistrationContrast",
  "bAffineRegistration",
  "bDCTRegistration",
  "bUseMNIasDummyStructural",
  "bHct2BloodT1",
  "ApplyQuantification",
  // atlases
  "Atlases",
  "TissueMasking",
  "TissueThreshold",
  "bMasking",
  "MinimalROIVolume",
  "bWMH",
  "DataTypes",
  // structural
  "bRunLongReg",
  "bRunDARTEL",
  "WMHsegmAlg",
  "bSegmentSPM12",
  "bHammersCAT12",
  "bFixResolution",
  // environment
  "bAutomaticallyDetectFSL",
  "bAutomaticallyDetectVABY",
] as const;

const VALID_SECTIONS: SectionId[] = [
  "m0",
  "quantification",
  "generalSettings",
  "aslProcessing",
  "atlases",
  "structural",
  "environment",
];

const VALID_TIERS: Tier[] = ["basic", "advanced"];

const VALID_WIDGETS: WidgetType[] = [
  "toggle",
  "number",
  "select",
  "checkboxGroup",
  "tags",
  "numberTuple",
  "selectWithCustom",
];

// ---------------------------------------------------------------------------
// FIELD_METADATA coverage
// ---------------------------------------------------------------------------

describe("FIELD_METADATA", () => {
  it("has an entry for every expected schema field", () => {
    for (const key of ALL_EXPECTED_KEYS) {
      expect(FIELD_METADATA[key], `missing metadata for "${key}"`).toBeDefined();
    }
  });

  it("has no extra keys beyond the expected set", () => {
    const extra = Object.keys(FIELD_METADATA).filter(
      (k) => !ALL_EXPECTED_KEYS.includes(k as (typeof ALL_EXPECTED_KEYS)[number]),
    );
    expect(extra).toEqual([]);
  });

  it("every entry has valid section, tier, and widget", () => {
    for (const [key, meta] of Object.entries(FIELD_METADATA)) {
      expect(VALID_SECTIONS, `${key}.section invalid`).toContain(meta.section);
      expect(VALID_TIERS, `${key}.tier invalid`).toContain(meta.tier);
      expect(VALID_WIDGETS, `${key}.widget invalid`).toContain(meta.widget);
    }
  });

  it("every entry has non-empty label and description", () => {
    for (const [key, meta] of Object.entries(FIELD_METADATA)) {
      expect(meta.label.trim(), `${key}.label empty`).not.toBe("");
      expect(meta.description.trim(), `${key}.description empty`).not.toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// Condition functions
// ---------------------------------------------------------------------------

describe("BackgroundSuppressionPulseTime condition", () => {
  const meta = FIELD_METADATA["BackgroundSuppressionPulseTime"];
  const cond = meta.condition!;

  it("returns true when M0=UseControlAsM0 and pulses > 0", () => {
    expect(cond({ M0: "UseControlAsM0", BackgroundSuppressionNumberPulses: 2 })).toBe(true);
  });

  it("returns false when M0 is not UseControlAsM0", () => {
    expect(cond({ M0: "separate_scan", BackgroundSuppressionNumberPulses: 2 })).toBe(false);
  });

  it("returns false when pulses is 0", () => {
    expect(cond({ M0: "UseControlAsM0", BackgroundSuppressionNumberPulses: 0 })).toBe(false);
  });

  it("returns false when pulses is undefined", () => {
    expect(cond({ M0: "UseControlAsM0" })).toBe(false);
  });
});

describe("bPVCGaussianMM condition", () => {
  const meta = FIELD_METADATA["bPVCGaussianMM"];
  const cond = meta.condition!;

  it("returns true when bPVCNativeSpace is true", () => {
    expect(cond({ bPVCNativeSpace: true })).toBe(true);
  });

  it("returns false when bPVCNativeSpace is false", () => {
    expect(cond({ bPVCNativeSpace: false })).toBe(false);
  });

  it("returns false when bPVCNativeSpace is undefined", () => {
    expect(cond({})).toBe(false);
  });
});

describe("PVCNativeSpaceKernel condition", () => {
  const meta = FIELD_METADATA["PVCNativeSpaceKernel"];
  const cond = meta.condition!;

  it("returns true when bPVCNativeSpace is true", () => {
    expect(cond({ bPVCNativeSpace: true })).toBe(true);
  });

  it("returns false when bPVCNativeSpace is false", () => {
    expect(cond({ bPVCNativeSpace: false })).toBe(false);
  });
});

describe("External quantification subtree conditions", () => {
  const conditionedKeys = [
    "ExternalQuantificationType",
    "ExternalQuantificationSmoothGaussianMM",
    "bMaskingExternal",
    "bSpatialBASIL",
    "bInferT1BASIL",
    "bInferATTBASIL",
    "ExchBASIL",
    "DispBASIL",
    "ATTSDBASIL",
    "bCleanUpExternal",
  ] as const;

  for (const key of conditionedKeys) {
    describe(key, () => {
      const meta = FIELD_METADATA[key];
      const cond = meta.condition!;

      it("returns true when bUseExternalQuantification is true", () => {
        expect(cond({ bUseExternalQuantification: true })).toBe(true);
      });

      it("returns false when bUseExternalQuantification is false", () => {
        expect(cond({ bUseExternalQuantification: false })).toBe(false);
      });

      it("returns false when bUseExternalQuantification is undefined", () => {
        expect(cond({})).toBe(false);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Tier assignments
// ---------------------------------------------------------------------------

describe("tier assignments", () => {
  const BASIC_KEYS: Record<SectionId, string[]> = {
    m0: ["M0", "BackgroundSuppressionNumberPulses", "BackgroundSuppressionPulseTime", "M0_GMScaleFactor", "bRegisterM02ASL"],
    quantification: ["nCompartments"],
    generalSettings: ["Quality"],
    aslProcessing: ["motionCorrection", "bTopUp", "bPVCNativeSpace", "SaveCBF4D"],
    atlases: ["Atlases"],
    structural: [],
    environment: [],
  };

  for (const [section, keys] of Object.entries(BASIC_KEYS)) {
    it(`${section} basic keys are tier=basic`, () => {
      for (const key of keys) {
        expect(FIELD_METADATA[key].tier, `${key}`).toBe("basic");
      }
    });
  }

  it("m0 advanced keys are tier=advanced", () => {
    for (const key of ["M0_conventionalProcessing", "RepetitionTimePreparationM0"]) {
      expect(FIELD_METADATA[key].tier).toBe("advanced");
    }
  });

  it("structural keys are all tier=advanced", () => {
    for (const key of ["bRunLongReg", "bRunDARTEL", "WMHsegmAlg", "bSegmentSPM12", "bHammersCAT12", "bFixResolution"]) {
      expect(FIELD_METADATA[key].tier, key).toBe("advanced");
    }
  });

  it("environment keys are all tier=advanced", () => {
    for (const key of ["bAutomaticallyDetectFSL", "bAutomaticallyDetectVABY"]) {
      expect(FIELD_METADATA[key].tier, key).toBe("advanced");
    }
  });
});

// ---------------------------------------------------------------------------
// Widget assignments
// ---------------------------------------------------------------------------

describe("widget assignments", () => {
  it("boolean fields use toggle widget", () => {
    for (const key of [
      "bRegisterM02ASL",
      "M0_conventionalProcessing",
      "bTopUp",
      "bPVCNativeSpace",
      "SaveCBF4D",
      "DELETETEMP",
      "SkipIfNoFlair",
      "SkipIfNoASL",
      "SkipIfNoM0",
      "stopAfterErrors",
      "bLesionFilling",
      "bAutoACPC",
      "bUseMNIasDummyStructural",
      "bUseExternalQuantification",
      "bMaskingExternal",
      "bSpatialBASIL",
      "bInferT1BASIL",
      "bInferATTBASIL",
      "bCleanUpExternal",
      "bMasking",
      "bWMH",
      "bRunLongReg",
      "bRunDARTEL",
      "bSegmentSPM12",
      "bHammersCAT12",
      "bFixResolution",
      "bAutomaticallyDetectFSL",
      "bAutomaticallyDetectVABY",
    ]) {
      expect(FIELD_METADATA[key].widget, key).toBe("toggle");
    }
  });

  it("select fields use select widget", () => {
    for (const key of [
      "Quality",
      "nCompartments",
      "WMHsegmAlg",
      "bRegistrationContrast",
      "bAffineRegistration",
      "bDCTRegistration",
      "bHct2BloodT1",
      "ExternalQuantificationType",
      "ExchBASIL",
      "DispBASIL",
    ]) {
      expect(FIELD_METADATA[key].widget, key).toBe("select");
    }
  });

  it("ApplyQuantification uses checkboxGroup", () => {
    expect(FIELD_METADATA["ApplyQuantification"].widget).toBe("checkboxGroup");
  });

  it("DataTypes uses tags", () => {
    expect(FIELD_METADATA["DataTypes"].widget).toBe("tags");
  });

  it("PVCNativeSpaceKernel uses numberTuple", () => {
    expect(FIELD_METADATA["PVCNativeSpaceKernel"].widget).toBe("numberTuple");
  });

  it("ExternalQuantificationSmoothGaussianMM uses numberTuple", () => {
    expect(FIELD_METADATA["ExternalQuantificationSmoothGaussianMM"].widget).toBe("numberTuple");
  });

  it("M0 uses selectWithCustom", () => {
    expect(FIELD_METADATA["M0"].widget).toBe("selectWithCustom");
  });

  it("numeric fields use number widget", () => {
    for (const key of [
      "BackgroundSuppressionNumberPulses",
      "M0_GMScaleFactor",
      "Lambda",
      "T2art",
      "T1blood",
      "T1GM",
      "T1WM",
      "T2GM",
      "T2WM",
      "SpikeRemovalThreshold",
      "SpikeRemovalAbsoluteThreshold",
      "TissueThreshold",
      "MinimalROIVolume",
    ]) {
      expect(FIELD_METADATA[key].widget, key).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// ATLAS_OPTIONS
// ---------------------------------------------------------------------------

describe("ATLAS_OPTIONS", () => {
  it("has free and commercial arrays", () => {
    expect(Array.isArray(ATLAS_OPTIONS.free)).toBe(true);
    expect(Array.isArray(ATLAS_OPTIONS.commercial)).toBe(true);
  });

  it("free contains expected atlases", () => {
    expect(ATLAS_OPTIONS.free).toContain("Total");
    expect(ATLAS_OPTIONS.free).toContain("DeepWM");
  });

  it("commercial contains expected atlases", () => {
    expect(ATLAS_OPTIONS.commercial).toContain("Thalamus");
  });
});

// ---------------------------------------------------------------------------
// M0_OPTIONS
// ---------------------------------------------------------------------------

describe("M0_OPTIONS", () => {
  it("is an array of {value, label} objects", () => {
    expect(Array.isArray(M0_OPTIONS)).toBe(true);
    for (const opt of M0_OPTIONS) {
      expect(typeof opt.value).toBe("string");
      expect(typeof opt.label).toBe("string");
    }
  });

  it("contains separate_scan, UseControlAsM0, Absent, __custom__", () => {
    const values = M0_OPTIONS.map((o) => o.value);
    expect(values).toContain("separate_scan");
    expect(values).toContain("UseControlAsM0");
    expect(values).toContain("Absent");
    expect(values).toContain("__custom__");
  });
});

import { describe, expect, it } from "vitest";

import { ATLAS_OPTIONS, FIELD_METADATA, M0_OPTIONS } from "./dataParFieldMetadata";

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
  "bLesionFilling",
  "bAutoACPC",
  "enableMetadataGroupingCorrection",
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

  it("every entry has non-empty label and description", () => {
    for (const [key, meta] of Object.entries(FIELD_METADATA)) {
      expect(meta.label.trim(), `${key}.label empty`).not.toBe("");
      expect(meta.description.trim(), `${key}.description empty`).not.toBe("");
    }
  });

  it("describes processing units and distinguishes unset behavior from GUI display", () => {
    expect(FIELD_METADATA.BackgroundSuppressionPulseTime.label).toContain("ms");
    expect(FIELD_METADATA.SpikeRemovalThreshold.description).toContain("Fractional t-statistic");
    expect(FIELD_METADATA.SpikeRemovalAbsoluteThreshold.label).toContain("mm");
    expect(FIELD_METADATA.SpikeRemovalAbsoluteThreshold.description).toContain(
      "even for explicit 0",
    );
    expect(FIELD_METADATA.bWMH.label).toBe("Include existing WMH voxels in ROI masks");
    expect(FIELD_METADATA.PVCNativeSpaceKernel.description).toContain("[10, 10, 4]");
    expect(FIELD_METADATA.T2WM.defaultHint).toContain("75 at 3 T");
    expect(FIELD_METADATA.bRegistrationContrast.defaultHint).toBe("Data-dependent when unset");
    expect(FIELD_METADATA.bInferATTBASIL.description).toContain("no operative reader");
    expect(FIELD_METADATA.RepetitionTimePreparationM0.description).toContain(
      "not as a processing override",
    );
  });
});

// ---------------------------------------------------------------------------
// ATLAS_OPTIONS
// ---------------------------------------------------------------------------

describe("ATLAS_OPTIONS", () => {
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
  it("contains separate_scan, UseControlAsM0, Absent, __custom__", () => {
    const values = M0_OPTIONS.map((o) => o.value);
    expect(values).toContain("separate_scan");
    expect(values).toContain("UseControlAsM0");
    expect(values).toContain("Absent");
    expect(values).toContain("__custom__");
  });
});

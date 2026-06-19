import { describe, expect, it } from "vitest";

import {
  DataParSchema,
  M0Schema,
  ApplyQuantificationSchema,
  PVCNativeSpaceKernelSchema,
  type DataParState,
} from "./dataParSchema";

describe("DataParSchema", () => {
  it("accepts an empty object — all fields optional", () => {
    const result = DataParSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts a single M0 field", () => {
    const result = DataParSchema.parse({ M0: "UseControlAsM0" });
    expect(result.M0).toBe("UseControlAsM0");
  });

  it("accepts a numeric M0 value", () => {
    const result = DataParSchema.parse({ M0: 42 });
    expect(result.M0).toBe(42);
  });

  it("accepts fields across multiple sections", () => {
    const result = DataParSchema.parse({
      M0: "separate_scan",
      bTopUp: true,
      Quality: 1,
      Atlases: ["MNI_Structural", "Hammers"],
      bRunLongReg: false,
      bAutomaticallyDetectFSL: true,
    });
    expect(result.M0).toBe("separate_scan");
    expect(result.bTopUp).toBe(true);
    expect(result.Quality).toBe(1);
    expect(result.Atlases).toEqual(["MNI_Structural", "Hammers"]);
    expect(result.bRunLongReg).toBe(false);
    expect(result.bAutomaticallyDetectFSL).toBe(true);
  });

  it("accepts all M0 section fields", () => {
    const result = DataParSchema.parse({
      M0: "Absent",
      BackgroundSuppressionNumberPulses: 4,
      BackgroundSuppressionPulseTime: [0.5, 1.2],
      M0_GMScaleFactor: 1.0,
      bRegisterM02ASL: true,
      M0_conventionalProcessing: false,
      RepetitionTimePreparationM0: [8.0, 4.0],
    });
    expect(result.M0).toBe("Absent");
    expect(result.BackgroundSuppressionNumberPulses).toBe(4);
    expect(result.BackgroundSuppressionPulseTime).toEqual([0.5, 1.2]);
    expect(result.M0_GMScaleFactor).toBe(1.0);
    expect(result.RepetitionTimePreparationM0).toEqual([8.0, 4.0]);
  });

  it("accepts all Quantification section fields", () => {
    const result = DataParSchema.parse({
      nCompartments: 1,
      Lambda: 0.9,
      T2art: 50,
      T1blood: 1650,
      T1GM: 1300,
      T1WM: 1100,
      T2GM: 80,
      T2WM: 45,
      T2tissueMultiTE: 0.04,
      bUseExternalQuantification: true,
      ExternalQuantificationType: "BASIL",
      ExternalQuantificationSmoothGaussianMM: [5, 5, 5],
      bMaskingExternal: false,
      bSpatialBASIL: true,
      bInferT1BASIL: false,
      bInferATTBASIL: true,
      ExchBASIL: "mix",
      DispBASIL: "gamma",
      ATTSDBASIL: 1.5,
      bCleanUpExternal: false,
    });
    expect(result.nCompartments).toBe(1);
    expect(result.Lambda).toBe(0.9);
    expect(result.ExternalQuantificationSmoothGaussianMM).toEqual([5, 5, 5]);
  });

  it("accepts all ASLProcessing section fields", () => {
    const result = DataParSchema.parse({
      motionCorrection: true,
      bTopUp: false,
      bPVCNativeSpace: true,
      bPVCGaussianMM: false,
      PVCNativeSpaceKernel: [5, 5, 5],
      SaveCBF4D: true,
      SpikeRemovalThreshold: 3.0,
      SpikeRemovalAbsoluteThreshold: 100,
      bRegistrationContrast: 1,
      bAffineRegistration: 2,
      bDCTRegistration: 0,
      bUseMNIasDummyStructural: false,
      bHct2BloodT1: 1,
      ApplyQuantification: [1, 0, 1, 0, 1, 0],
    });
    expect(result.bTopUp).toBe(false);
    expect(result.PVCNativeSpaceKernel).toEqual([5, 5, 5]);
    expect(result.ApplyQuantification).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it("accepts all Atlases section fields", () => {
    const result = DataParSchema.parse({
      Atlases: ["MNI_Structural"],
      TissueMasking: ["GM", "WM"],
      TissueThreshold: [0.7, 0.7],
      bMasking: 1,
      MinimalROIVolume: 10,
      bWMH: true,
      DataTypes: ["CBF", "M0map"],
    });
    expect(result.Atlases).toEqual(["MNI_Structural"]);
    expect(result.bMasking).toBe(1);
  });

  it("accepts bMasking as tuple", () => {
    const result = DataParSchema.parse({ bMasking: [1, 0, 1, 0] });
    expect(result.bMasking).toEqual([1, 0, 1, 0]);
  });

  it("accepts bMasking as scalar 0", () => {
    const result = DataParSchema.parse({ bMasking: 0 });
    expect(result.bMasking).toBe(0);
  });

  it("accepts all Structural section fields", () => {
    const result = DataParSchema.parse({
      bRunLongReg: true,
      bRunDARTEL: false,
      WMHsegmAlg: "LPA",
      bSegmentSPM12: true,
      bHammersCAT12: false,
      bFixResolution: true,
      bLesionFilling: false,
      bAutoACPC: true,
    });
    expect(result.WMHsegmAlg).toBe("LPA");
    expect(result.bAutoACPC).toBe(true);
  });

  it("accepts all Environment section fields", () => {
    const result = DataParSchema.parse({
      bAutomaticallyDetectFSL: true,
      bAutomaticallyDetectVABY: false,
    });
    expect(result.bAutomaticallyDetectFSL).toBe(true);
    expect(result.bAutomaticallyDetectVABY).toBe(false);
  });

  it("rejects invalid M0 enum value", () => {
    expect(() => DataParSchema.parse({ M0: "InvalidValue" })).toThrow();
  });

  it("rejects ApplyQuantification with wrong length", () => {
    expect(() => DataParSchema.parse({ ApplyQuantification: [1, 0, 1] })).toThrow();
  });

  it("rejects ApplyQuantification with values outside 0-1", () => {
    expect(() => DataParSchema.parse({ ApplyQuantification: [1, 0, 2, 0, 1, 0] })).toThrow();
  });

  it("rejects PVCNativeSpaceKernel with wrong tuple length", () => {
    expect(() => DataParSchema.parse({ PVCNativeSpaceKernel: [5, 5] })).toThrow();
  });
});

describe("M0Schema", () => {
  it("accepts separate_scan", () => {
    expect(M0Schema.parse("separate_scan")).toBe("separate_scan");
  });

  it("accepts UseControlAsM0", () => {
    expect(M0Schema.parse("UseControlAsM0")).toBe("UseControlAsM0");
  });

  it("accepts Absent", () => {
    expect(M0Schema.parse("Absent")).toBe("Absent");
  });

  it("accepts a number", () => {
    expect(M0Schema.parse(0)).toBe(0);
  });

  it("rejects random string", () => {
    expect(() => M0Schema.parse("nope")).toThrow();
  });
});

describe("ApplyQuantificationSchema", () => {
  it("accepts array of 6 zeros", () => {
    expect(ApplyQuantificationSchema.parse([0, 0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("accepts array of 6 ones", () => {
    expect(ApplyQuantificationSchema.parse([1, 1, 1, 1, 1, 1])).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("rejects array with fewer than 6 elements", () => {
    expect(() => ApplyQuantificationSchema.parse([1, 0, 1])).toThrow();
  });

  it("rejects array with more than 6 elements", () => {
    expect(() => ApplyQuantificationSchema.parse([1, 0, 1, 0, 1, 0, 1])).toThrow();
  });

  it("rejects values > 1", () => {
    expect(() => ApplyQuantificationSchema.parse([1, 0, 1.5, 0, 1, 0])).toThrow();
  });

  it("rejects values < 0", () => {
    expect(() => ApplyQuantificationSchema.parse([1, 0, -1, 0, 1, 0])).toThrow();
  });
});

describe("PVCNativeSpaceKernelSchema", () => {
  it("accepts tuple of 3 numbers", () => {
    expect(PVCNativeSpaceKernelSchema.parse([5, 5, 5])).toEqual([5, 5, 5]);
  });

  it("rejects tuple of 2 numbers", () => {
    expect(() => PVCNativeSpaceKernelSchema.parse([5, 5])).toThrow();
  });

  it("rejects tuple of 4 numbers", () => {
    expect(() => PVCNativeSpaceKernelSchema.parse([5, 5, 5, 5])).toThrow();
  });
});

describe("DataParState type", () => {
  it("can be assigned an empty object", () => {
    const state: DataParState = {};
    expect(state).toEqual({});
  });

  it("can be assigned with fields", () => {
    const state: DataParState = { bTopUp: true, M0: "Absent" };
    expect(state.bTopUp).toBe(true);
    expect(state.M0).toBe("Absent");
  });
});

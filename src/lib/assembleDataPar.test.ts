import { describe, expect, it } from "vitest";

import type { DataParState } from "../schemas/dataParSchema";
import { assembleDataPar } from "./assembleDataPar";

describe("assembleDataPar", () => {
  it("returns empty x object for empty state", () => {
    const result = assembleDataPar({});
    expect(result).toEqual({ x: {} });
  });

  it("maps quantification fields to x.Q.*", () => {
    const state: DataParState = {
      Lambda: 0.9,
      T2art: 50,
      T1blood: 1650,
      T1GM: 1300,
      T1WM: 1100,
      T2GM: 80,
      T2WM: 45,
      T2tissueMultiTE: 0.04,
    };
    const result = assembleDataPar(state);
    expect(result.x.Q).toEqual({
      Lambda: 0.9,
      T2art: 50,
      T1blood: 1650,
      T1GM: 1300,
      T1WM: 1100,
      T2GM: 80,
      T2WM: 45,
      T2tissueMultiTE: 0.04,
    });
  });

  it("maps ASL module fields to x.modules.asl.*", () => {
    const state: DataParState = {
      bTopUp: true,
      motionCorrection: 0,
      bPVCNativeSpace: 1,
      bPVCGaussianMM: 0,
      PVCNativeSpaceKernel: [5, 5, 5],
      SaveCBF4D: true,
      SpikeRemovalThreshold: 3.0,
      SpikeRemovalAbsoluteThreshold: 100,
      bRegistrationContrast: 1,
      bAffineRegistration: 2,
      bDCTRegistration: 0,
      bUseMNIasDummyStructural: 0,
      bHct2BloodT1: 1,
      ApplyQuantification: [1, 0, 1, 0, 1, 0],
    };
    const result = assembleDataPar(state);
    expect(result.x.modules?.asl).toEqual({
      bTopUp: true,
      motionCorrection: 0,
      bPVCNativeSpace: 1,
      bPVCGaussianMM: 0,
      PVCNativeSpaceKernel: [5, 5, 5],
      SaveCBF4D: true,
      SpikeRemovalThreshold: 3.0,
      SpikeRemovalAbsoluteThreshold: 100,
      bRegistrationContrast: 1,
      bAffineRegistration: 2,
      bDCTRegistration: 0,
      bUseMNIasDummyStructural: 0,
      bHct2BloodT1: 1,
      ApplyQuantification: [1, 0, 1, 0, 1, 0],
    });
  });

  it("maps structural fields to x.modules.structural.*", () => {
    const state: DataParState = {
      bSegmentSPM12: 1,
      bHammersCAT12: 0,
      bFixResolution: true,
    };
    const result = assembleDataPar(state);
    expect(result.x.modules?.structural).toEqual({
      bSegmentSPM12: 1,
      bHammersCAT12: 0,
      bFixResolution: true,
    });
  });

  it("maps settings fields to x.settings.*", () => {
    const state: DataParState = {
      Quality: 1,
      DELETETEMP: 1,
      SkipIfNoFlair: 0,
      SkipIfNoASL: 1,
      SkipIfNoM0: 0,
      bLesionFilling: true,
      bAutoACPC: false,
    };
    const result = assembleDataPar(state);
    expect(result.x.settings).toEqual({
      Quality: 1,
      DELETETEMP: 1,
      SkipIfNoFlair: 0,
      SkipIfNoASL: 1,
      SkipIfNoM0: 0,
      bLesionFilling: true,
      bAutoACPC: false,
    });
  });

  it("maps atlas fields to x.S.*", () => {
    const state: DataParState = {
      Atlases: ["MNI_Structural", "Hammers"],
      TissueMasking: ["GM", "WM"],
      TissueThreshold: [0.7, 0.7],
      bMasking: [1, 1, 0, 0],
      MinimalROIVolume: 10,
      bWMH: true,
      DataTypes: ["CBF", "M0map"],
    };
    const result = assembleDataPar(state);
    expect(result.x.S).toEqual({
      Atlases: ["MNI_Structural", "Hammers"],
      TissueMasking: ["GM", "WM"],
      TissueThreshold: [0.7, 0.7],
      bMasking: [1, 1, 0, 0],
      MinimalROIVolume: 10,
      bWMH: true,
      DataTypes: ["CBF", "M0map"],
    });
  });

  it("maps external quantification fields to x.modules.asl.*", () => {
    const state: DataParState = {
      bUseExternalQuantification: true,
      ExternalQuantificationType: "BASIL",
      ExternalQuantificationSmoothGaussianMM: [5.5, 5, 1.5],
      bMaskingExternal: false,
      bSpatialBASIL: true,
      bInferT1BASIL: false,
      bInferATTBASIL: true,
      ExchBASIL: "mix",
      DispBASIL: "gamma",
      ATTSDBASIL: 1.5,
      bCleanUpExternal: false,
    };
    const result = assembleDataPar(state);
    expect(result.x.modules?.asl).toEqual({
      bUseExternalQuantification: true,
      ExternalQuantificationType: "BASIL",
      ExternalQuantificationSmoothGaussianMM: [5.5, 5, 1.5],
      bMaskingExternal: false,
      bSpatialBASIL: true,
      bInferT1BASIL: false,
      bInferATTBASIL: true,
      ExchBASIL: "mix",
      DispBASIL: "gamma",
      ATTSDBASIL: 1.5,
      bCleanUpExternal: false,
    });
  });

  it("routes sparse settings to operative MATLAB locations without filling defaults", () => {
    // ExploreASL 6dafdba4: Process.m, Structural.m, wrp_Quantify.m,
    // quant_M0.m, wrp_ProcessM0.m, and adm_GetDeprecatedFields.m.
    const cases: [DataParState, unknown][] = [
      [{ bRunLongReg: 1 }, { x: { modules: { bRunLongReg: 1 } } }],
      [{ bRunDARTEL: 0 }, { x: { modules: { bRunDARTEL: 0 } } }],
      [{ WMHsegmAlg: "LGA" }, { x: { WMHsegmAlg: "LGA" } }],
      [{ nCompartments: 2 }, { x: { Q: { nCompartments: 2 } } }],
      [
        { BackgroundSuppressionNumberPulses: 2 },
        { x: { Q: { BackgroundSuppressionNumberPulses: 2 } } },
      ],
      [
        { BackgroundSuppressionPulseTime: [2200, 2600] },
        { x: { Q: { BackgroundSuppressionPulseTime: [2200, 2600] } } },
      ],
      [{ M0_GMScaleFactor: 1 }, { x: { modules: { asl: { M0_GMScaleFactor: 1 } } } }],
      [{ bRegisterM02ASL: 1 }, { x: { modules: { asl: { bRegisterM02ASL: 1 } } } }],
      [
        { M0_conventionalProcessing: 0 },
        { x: { modules: { asl: { M0_conventionalProcessing: 0 } } } },
      ],
    ];
    for (const [state, expected] of cases) {
      const saved = JSON.parse(JSON.stringify(state));
      expect(assembleDataPar(saved)).toEqual(expected);
    }
  });

  it("maps RepetitionTimePreparationM0 to x.Q.RepetitionTimePreparationM0", () => {
    const result = assembleDataPar({ RepetitionTimePreparationM0: 8.0 });
    expect(result).toEqual({ x: { Q: { RepetitionTimePreparationM0: 8.0 } } });
  });

  it("maps environment fields to x.external.*", () => {
    const state: DataParState = {
      bAutomaticallyDetectFSL: true,
      bAutomaticallyDetectVABY: false,
    };
    const result = assembleDataPar(state);
    expect(result.x.external).toEqual(state);
  });

  it("omits sub-objects when all child keys are undefined", () => {
    const state: DataParState = {
      Quality: 1,
      bAutomaticallyDetectFSL: true,
    };
    const result = assembleDataPar(state);
    expect(result.x.Q).toBeUndefined();
    expect(result.x.modules).toBeUndefined();
    expect(result.x.S).toBeUndefined();
    expect(result.x.external).toEqual({ bAutomaticallyDetectFSL: true });
    expect(result.x.settings).toEqual({ Quality: 1 });
  });

  it("preserves numeric M0 as number, not string", () => {
    const result = assembleDataPar({ M0: 0 });
    expect(result.x.Q?.M0).toBe(0);
    expect(typeof result.x.Q?.M0).toBe("number");
  });

  it("only ASL module present — no structural", () => {
    const state: DataParState = {
      bTopUp: true,
    };
    const result = assembleDataPar(state);

    expect(result.x.modules).toBeDefined();
    expect(result.x.modules?.asl).toEqual({ bTopUp: true });
    expect(result.x.modules?.structural).toBeUndefined();
  });

  it("M0 named modes produce string output", () => {
    for (const mode of ["separate_scan", "UseControlAsM0", "Absent"] as const) {
      const result = assembleDataPar({ M0: mode });
      expect(typeof result.x.Q?.M0).toBe("string");
      expect(result.x.Q?.M0).toBe(mode);
    }
  });
});

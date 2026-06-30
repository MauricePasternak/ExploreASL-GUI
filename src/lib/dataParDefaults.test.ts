import { describe, expect, it } from "vitest";

import { getDefaultDataPar } from "./dataParDefaults";
import { DataParSchema } from "../schemas/dataParSchema";

describe("getDefaultDataPar", () => {
  it("returns an object with defaults from FIELD_METADATA", () => {
    const defaults = getDefaultDataPar();

    expect(defaults.Lambda).toBe(0.9);
    expect(defaults.T2art).toBe(165);
    expect(defaults.T1blood).toBe(1650);
    expect(defaults.nCompartments).toBe(1);
    expect(defaults.Quality).toBe(1);
    expect(defaults.DELETETEMP).toBe(1);
    expect(defaults.bTopUp).toBe(false);
    expect(defaults.bInferATTBASIL).toBe(true);
    expect(defaults.bCleanUpExternal).toBe(false);
    expect(defaults.bAutomaticallyDetectFSL).toBe(false);
    expect(defaults.bAutomaticallyDetectVABY).toBe(false);
  });

  it("includes tuple defaults", () => {
    const defaults = getDefaultDataPar();

    expect(defaults.PVCNativeSpaceKernel).toEqual([5, 5, 1]);
    expect(defaults.ExternalQuantificationSmoothGaussianMM).toEqual([5, 5, 1]);
  });

  it("includes array defaults", () => {
    const defaults = getDefaultDataPar();

    expect(defaults.Atlases).toEqual(["Total", "DeepWM"]);
    expect(defaults.TissueMasking).toEqual(["GM", "WM"]);
    expect(defaults.TissueThreshold).toEqual([0.7, 0.7]);
    expect(defaults.ApplyQuantification).toEqual([1, 1, 1, 1, 1, 1]);
    expect(defaults.DataTypes).toEqual(["qCBF"]);
  });

  it("includes flag defaults as 0 or 1", () => {
    const defaults = getDefaultDataPar();

    expect(defaults.bRegisterM02ASL).toBe(0);
    expect(defaults.M0_conventionalProcessing).toBe(0);
    expect(defaults.motionCorrection).toBe(1);
    expect(defaults.bPVCNativeSpace).toBe(0);
    expect(defaults.bPVCGaussianMM).toBe(0);
    expect(defaults.SkipIfNoFlair).toBe(0);
    expect(defaults.bUseMNIasDummyStructural).toBe(0);
    expect(defaults.bRunLongReg).toBe(0);
    expect(defaults.bRunDARTEL).toBe(0);
    expect(defaults.bSegmentSPM12).toBe(0);
    expect(defaults.bHammersCAT12).toBe(0);
  });

  it("produces a result that passes DataParSchema.parse", () => {
    const defaults = getDefaultDataPar();
    const parsed = DataParSchema.parse(defaults);
    expect(parsed).toEqual(defaults);
  });

  it("does not include fields without a default in metadata", () => {
    const defaults = getDefaultDataPar() as Record<string, unknown>;

    expect(defaults["BackgroundSuppressionPulseTime"]).toBeUndefined();
  });
});

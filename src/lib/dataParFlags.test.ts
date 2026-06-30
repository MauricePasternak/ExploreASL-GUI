import { describe, expect, it } from "vitest";

import { FLAG_FIELDS, fromFlag, toFlag } from "./dataParFlags";

describe("FLAG_FIELDS", () => {
  it("contains all 0/1 flag fields from schema", () => {
    expect(FLAG_FIELDS.has("bRegisterM02ASL")).toBe(true);
    expect(FLAG_FIELDS.has("M0_conventionalProcessing")).toBe(true);
    expect(FLAG_FIELDS.has("Quality")).toBe(true);
    expect(FLAG_FIELDS.has("DELETETEMP")).toBe(true);
    expect(FLAG_FIELDS.has("SkipIfNoFlair")).toBe(true);
    expect(FLAG_FIELDS.has("SkipIfNoASL")).toBe(true);
    expect(FLAG_FIELDS.has("SkipIfNoM0")).toBe(true);
    expect(FLAG_FIELDS.has("motionCorrection")).toBe(true);
    expect(FLAG_FIELDS.has("bPVCNativeSpace")).toBe(true);
    expect(FLAG_FIELDS.has("bPVCGaussianMM")).toBe(true);
    expect(FLAG_FIELDS.has("bUseMNIasDummyStructural")).toBe(true);
    expect(FLAG_FIELDS.has("bRunLongReg")).toBe(true);
    expect(FLAG_FIELDS.has("bRunDARTEL")).toBe(true);
    expect(FLAG_FIELDS.has("bSegmentSPM12")).toBe(true);
    expect(FLAG_FIELDS.has("bHammersCAT12")).toBe(true);
  });

  it("does not contain boolean fields", () => {
    expect(FLAG_FIELDS.has("bTopUp")).toBe(false);
    expect(FLAG_FIELDS.has("bLesionFilling")).toBe(false);
    expect(FLAG_FIELDS.has("bWMH")).toBe(false);
  });
});

describe("toFlag", () => {
  it("converts true to 1", () => {
    expect(toFlag(true)).toBe(1);
  });

  it("converts false to 0", () => {
    expect(toFlag(false)).toBe(0);
  });

  it("converts undefined to 0", () => {
    expect(toFlag(undefined)).toBe(0);
  });

  it("passes through 0", () => {
    expect(toFlag(0)).toBe(0);
  });

  it("passes through 1", () => {
    expect(toFlag(1)).toBe(1);
  });
});

describe("fromFlag", () => {
  it("converts 1 to true", () => {
    expect(fromFlag(1)).toBe(true);
  });

  it("converts 0 to false", () => {
    expect(fromFlag(0)).toBe(false);
  });

  it("converts true to true", () => {
    expect(fromFlag(true)).toBe(true);
  });

  it("converts false to false", () => {
    expect(fromFlag(false)).toBe(false);
  });

  it("returns default when undefined", () => {
    expect(fromFlag(undefined, true)).toBe(true);
    expect(fromFlag(undefined, false)).toBe(false);
  });

  it("returns false when undefined and no default", () => {
    expect(fromFlag(undefined)).toBe(false);
  });
});

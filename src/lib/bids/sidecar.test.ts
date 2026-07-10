import { describe, it, expect } from "vitest";
import {
  summarizeAslContext,
  validateBidsAslParams,
  extractFingerprint,
  deriveInjectedFields,
  parseAslContext,
} from "./sidecar";

// ── summarizeAslContext ──────────────────────────────────────────────────────

describe("summarizeAslContext", () => {
  it("returns empty string for undefined", () => {
    expect(summarizeAslContext(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(summarizeAslContext("")).toBe("");
  });

  it("run-length encodes adjacent identical tokens and uses ' x{count}' format", () => {
    expect(summarizeAslContext("m0scan,m0scan,label,label")).toBe("m0scan x2, label x2");
  });

  it("condenses alternating label-control or control-label pairs", () => {
    expect(summarizeAslContext("m0scan,label,control,m0scan")).toBe(
      "m0scan, label-control pair, m0scan",
    );
  });

  it("handles single token (omitting count suffix for count 1)", () => {
    expect(summarizeAslContext("m0scan")).toBe("m0scan");
  });

  it("handles tokens with surrounding whitespace", () => {
    expect(summarizeAslContext("m0scan , m0scan , label")).toBe("m0scan x2, label");
  });

  it("condenses label-control repeated 40 times", () => {
    const raw = Array(40).fill("label,control").join(",");
    expect(summarizeAslContext(raw)).toBe("label-control pair x40");
  });

  it("condenses control-label repeated 40 times", () => {
    const raw = Array(40).fill("control,label").join(",");
    expect(summarizeAslContext(raw)).toBe("control-label pair x40");
  });

  it("handles the user's specific example with mixed types", () => {
    const raw =
      "control, label, control, label, m0scan, m0scan, label, control, label, control, deltam";
    expect(summarizeAslContext(raw)).toBe(
      "control-label pair x2, m0scan x2, label-control pair x2, deltam",
    );
  });

  it("handles trailing unpaired alternating token", () => {
    expect(summarizeAslContext("control, label, control, label, control")).toBe(
      "control-label pair x2, control",
    );
  });

  it("handles block design without pairing (only adjacent run-length encoding)", () => {
    expect(summarizeAslContext("label, label, control, control")).toBe("label x2, control x2");
  });

  it("handles arbitrary other tokens without breaking them", () => {
    expect(summarizeAslContext("foo, bar, control, label, baz, baz")).toBe(
      "foo, bar, control-label pair, baz x2",
    );
  });

  it("handles complex interspersed sequence", () => {
    expect(summarizeAslContext("m0scan, m0scan, control, label, m0scan, label, control")).toBe(
      "m0scan x2, control-label pair, m0scan, label-control pair",
    );
  });
});

// ── parseAslContext ─────────────────────────────────────────────────────────

describe("parseAslContext", () => {
  it("splits comma-separated tokens", () => {
    expect(parseAslContext("m0scan,label,control")).toEqual(["m0scan", "label", "control"]);
  });

  it("trims whitespace", () => {
    expect(parseAslContext(" m0scan , label , control ")).toEqual(["m0scan", "label", "control"]);
  });

  it("drops empty tokens", () => {
    expect(parseAslContext("m0scan,,label,")).toEqual(["m0scan", "label"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAslContext("")).toEqual([]);
  });

  it("handles single token", () => {
    expect(parseAslContext("m0scan")).toEqual(["m0scan"]);
  });
});

// ── extractFingerprint ──────────────────────────────────────────────────────

describe("extractFingerprint", () => {
  it("extracts only present fingerprint fields from D24 list", () => {
    const params = {
      ArterialSpinLabelingType: "PCASL" as const,
      PostLabelingDelay: 1.8,
      MRAcquisitionType: "3D" as const,
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      ManufacturersModelName: "Prisma",
      PulseSequenceType: "3D_SPIRAL",
      EchoTime: 0.013,
    };
    const fp = extractFingerprint(params);
    expect(fp.ArterialSpinLabelingType).toBe("PCASL");
    expect(fp.PostLabelingDelay).toBe(1.8);
    expect(fp.MRAcquisitionType).toBe("3D");
    expect(fp.MagneticFieldStrength).toBe(3);
    expect(fp.Manufacturer).toBe("Siemens");
    expect(fp.ManufacturersModelName).toBe("Prisma");
    expect(fp.PulseSequenceType).toBe("3D_SPIRAL");
    expect(fp.EchoTime).toBe(0.013);
  });

  it("omits undefined fields", () => {
    const params = { ArterialSpinLabelingType: "PASL" as const };
    const fp = extractFingerprint(params);
    expect(fp.ArterialSpinLabelingType).toBe("PASL");
    expect(fp.PostLabelingDelay).toBeUndefined();
    expect(Object.keys(fp)).not.toContain("PostLabelingDelay");
  });

  it("does NOT include ASLContext (D7: display-only)", () => {
    const params = { ASLContext: "m0scan,label,control" };
    const fp = extractFingerprint(params);
    expect(fp.ASLContext).toBeUndefined();
    expect(Object.keys(fp)).not.toContain("ASLContext");
  });

  it("includes all 15 fingerprint fields when all present", () => {
    const params = {
      ArterialSpinLabelingType: "PCASL" as const,
      PostLabelingDelay: 1.8,
      MRAcquisitionType: "3D" as const,
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      ManufacturersModelName: "Prisma",
      M0Type: "Included" as const,
      BackgroundSuppression: false,
      BolusCutOffDelayTime: undefined, // absent
      BolusCutOffTechnique: undefined, // absent
      LabelingDuration: 1.8,
      BackgroundSuppressionNumberPulses: 0,
      RepetitionTimePreparation: 4.5,
      PulseSequenceType: "3D_SPIRAL",
      EchoTime: 0.013,
    };
    const fp = extractFingerprint(params);
    // 13 present fields (BolusCutOff* are absent)
    expect(Object.keys(fp).length).toBe(13);
  });
});

// ── deriveInjectedFields ────────────────────────────────────────────────────

describe("deriveInjectedFields", () => {
  it("derives vendor from Manufacturer via normalizeManufacturer", () => {
    const result = deriveInjectedFields({ Manufacturer: "SIEMENS TrioTim" });
    expect(result.vendor).toBe("Siemens");
  });

  it("derives sequence from acq + PulseSequenceType", () => {
    const result = deriveInjectedFields({
      PulseSequenceType: "3D_SPIRAL",
      acq: "pcasl",
    });
    expect(result.sequence).toBe("pcasl_spiral");
  });

  it("derives sequence with only PulseSequenceType (no acq)", () => {
    const result = deriveInjectedFields({ PulseSequenceType: "3D_SPIRAL" });
    expect(result.sequence).toBe("spiral");
  });

  it("derives labelingType PCASL → PCASL", () => {
    const result = deriveInjectedFields({ ArterialSpinLabelingType: "PCASL" as const });
    expect(result.labelingType).toBe("PCASL");
  });

  it("derives labelingType CASL → CASL", () => {
    const result = deriveInjectedFields({ ArterialSpinLabelingType: "CASL" as const });
    expect(result.labelingType).toBe("CASL");
  });

  it("derives labelingType PASL → PASL", () => {
    const result = deriveInjectedFields({ ArterialSpinLabelingType: "PASL" as const });
    expect(result.labelingType).toBe("PASL");
  });

  it("returns undefined labelingType for unrecognized value", () => {
    const result = deriveInjectedFields({});
    expect(result.labelingType).toBeUndefined();
  });

  it("returns undefined vendor for unrecognized manufacturer", () => {
    const result = deriveInjectedFields({ Manufacturer: "Canon" });
    expect(result.vendor).toBeUndefined();
  });

  it("returns UnknownSequence for sequence when params empty", () => {
    const result = deriveInjectedFields({});
    expect(result.vendor).toBeUndefined();
    expect(result.sequence).toBe("UnknownSequence");
    expect(result.labelingType).toBeUndefined();
  });
});

// ── validateBidsAslParams ────────────────────────────────────────────────────

describe("validateBidsAslParams", () => {
  it("returns empty array for valid params", () => {
    const params = {
      ArterialSpinLabelingType: "PCASL" as const,
      PostLabelingDelay: 1.8,
      MRAcquisitionType: "3D" as const,
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      ASLContext: "m0scan,label,control",
      BackgroundSuppression: false,
      LabelingDuration: 1.8,
      M0Type: "Included" as const,
    };
    const errors = validateBidsAslParams(params);
    expect(errors).toEqual([]);
  });

  it("returns errors for missing required fields", () => {
    const params = {};
    const errors = validateBidsAslParams(params);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("Arterial Spin Labeling Type"))).toBe(true);
    expect(errors.some((e) => e.includes("Post Labeling Delay"))).toBe(true);
  });
});

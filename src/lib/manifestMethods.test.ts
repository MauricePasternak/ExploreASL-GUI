import { describe, expect, it } from "vitest";

import { assembleDataPar } from "./assembleDataPar";
import { getDefaultDataPar } from "./dataParDefaults";
import type { DataParState } from "../schemas/dataParSchema";
import {
  flattenRunDataPar,
  generateMethodsParagraph,
  REFERENCE_DICTIONARY,
} from "./manifestMethods";

function fullState(overrides: Partial<DataParState> = {}): DataParState {
  return { ...getDefaultDataPar(), ...overrides };
}

describe("flattenRunDataPar", () => {
  it("returns empty object for null/empty input", () => {
    expect(flattenRunDataPar(null)).toEqual({});
    expect(flattenRunDataPar(undefined)).toEqual({});
    expect(flattenRunDataPar({})).toEqual({});
  });

  it("flattens nested x.Q, x.modules, x.settings, x.S, x.external", () => {
    const nested = assembleDataPar({
      M0: "separate_scan",
      nCompartments: 2,
      bTopUp: true,
      bRunLongReg: 1,
      Quality: 1,
      Atlases: ["Total"],
      bUseExternalQuantification: true,
      ExternalQuantificationType: "BASIL",
    });

    const flat = flattenRunDataPar(nested as unknown as Record<string, unknown>);
    expect(flat.M0).toBe("separate_scan");
    expect(flat.nCompartments).toBe(2);
    expect(flat.bTopUp).toBe(true);
    expect(flat.bRunLongReg).toBe(1);
    expect(flat.Quality).toBe(1);
    expect(flat.Atlases).toEqual(["Total"]);
    expect(flat.bUseExternalQuantification).toBe(true);
    expect(flat.ExternalQuantificationType).toBe("BASIL");
  });

  it("passes through already-flat input when no x key", () => {
    const flat = { M0: "Absent", bTopUp: false };
    expect(flattenRunDataPar(flat)).toEqual(flat);
  });

  it("round-trips with assembleDataPar for representative fields", () => {
    const state = fullState({
      M0: "UseControlAsM0",
      Lambda: 0.85,
      bPVCNativeSpace: 1,
      bSegmentSPM12: 1,
    });
    const nested = assembleDataPar(state);
    const flat = flattenRunDataPar(nested as unknown as Record<string, unknown>);
    expect(flat.M0).toBe("UseControlAsM0");
    expect(flat.Lambda).toBe(0.85);
    expect(flat.bPVCNativeSpace).toBe(1);
    expect(flat.bSegmentSPM12).toBe(1);
  });
});

describe("generateMethodsParagraph", () => {
  it("generates default-config paragraphs with sorted references", () => {
    const result = generateMethodsParagraph(fullState());

    expect(result.paragraphs.length).toBeGreaterThanOrEqual(4);
    expect(result.paragraphs[0]).toContain("ExploreASL 1.0.0");
    expect(result.paragraphs[0]).toContain("dcm2niiX");
    expect(result.paragraphs.join(" ")).toContain("AC-PC");
    expect(result.paragraphs.join(" ")).toContain("CAT12");
    expect(result.paragraphs.join(" ")).toContain("Geodesic Shooting");
    expect(result.paragraphs.join(" ")).not.toContain("M0 image was processed");
    expect(result.references.length).toBeGreaterThan(0);
    const sortedByCitation = [...result.references].sort((a, b) => a.localeCompare(b));
    for (let i = 1; i < sortedByCitation.length; i++) {
      expect(sortedByCitation[i - 1].localeCompare(sortedByCitation[i])).toBeLessThanOrEqual(0);
    }
  });

  it("includes fast try-out modifier when Quality is 0", () => {
    const result = generateMethodsParagraph(fullState({ Quality: 0 }));
    expect(result.paragraphs[0]).toContain("low-quality, fast try-out mode");
  });

  it("skips structural steps 2C-2G when dummy structural is enabled", () => {
    const result = generateMethodsParagraph(fullState({ bUseMNIasDummyStructural: 1 }));
    const text = result.paragraphs.join(" ");
    expect(text).toContain("dummy structural reference");
    expect(text).not.toContain("CAT12, release 1363");
    expect(text).not.toContain("Geodesic Shooting");
  });

  it("uses SPM12 segmentation branch when bSegmentSPM12 is 1", () => {
    const result = generateMethodsParagraph(fullState({ bSegmentSPM12: 1 }));
    expect(result.paragraphs.join(" ")).toContain("SPM12 unified tissue segmentation");
    expect(result.references).not.toContain(REFERENCE_DICTIONARY["Gaser 2009"]);
  });

  it("uses registration branch D when bRegistrationContrast is 1", () => {
    const result = generateMethodsParagraph(fullState({ bRegistrationContrast: 1 }));
    expect(result.paragraphs.join(" ")).toContain(
      "M0 calibration scan directly aligned to the T1w structural scan",
    );
  });

  it("uses registration branch A when bDCTRegistration is 1", () => {
    const result = generateMethodsParagraph(
      fullState({ bDCTRegistration: 1, bRegistrationContrast: 0 }),
    );
    expect(result.paragraphs.join(" ")).toContain("discrete cosine transform (DCT)");
    expect(result.references).toContain(REFERENCE_DICTIONARY["Petr 2018a"]);
  });

  it("uses registration branch B when bAffineRegistration is 1", () => {
    const result = generateMethodsParagraph(
      fullState({
        bAffineRegistration: 1,
        bDCTRegistration: 0,
        bRegistrationContrast: 0,
      }),
    );
    expect(result.paragraphs.join(" ")).toContain("affine registration");
  });

  it("handles M0 separate_scan with conventional processing", () => {
    const result = generateMethodsParagraph(
      fullState({
        M0: "separate_scan",
        M0_conventionalProcessing: 1,
        bRegisterM02ASL: 1,
      }),
    );
    const text = result.paragraphs.join(" ");
    expect(text).toContain("processed conventionally");
    expect(text).toContain("rigidly registered to the ASL space");
  });

  it("handles M0 UseControlAsM0", () => {
    const result = generateMethodsParagraph(fullState({ M0: "UseControlAsM0" }));
    expect(result.paragraphs.join(" ")).toContain("estimated directly from the ASL control images");
  });

  it("handles custom M0 strategy", () => {
    const result = generateMethodsParagraph(fullState({ M0: "custom_path.nii" as never }));
    expect(result.paragraphs.join(" ")).toContain("custom user-defined strategy");
  });

  it("uses vascular-only masking branch", () => {
    const result = generateMethodsParagraph(fullState({ bMasking: [0, 1, 1, 1] }));
    expect(result.paragraphs.join(" ")).toContain("intravascular signal");
    expect(result.paragraphs.join(" ")).not.toContain("susceptibility-induced signal dropout");
  });

  it("uses susceptibility-only masking branch", () => {
    const result = generateMethodsParagraph(fullState({ bMasking: [1, 0, 1, 1] }));
    expect(result.paragraphs.join(" ")).toContain("susceptibility-induced signal dropout");
    expect(result.paragraphs.join(" ")).not.toContain("intravascular signal");
  });

  it("includes external BASIL modifiers", () => {
    const result = generateMethodsParagraph(
      fullState({
        bUseExternalQuantification: true,
        ExternalQuantificationType: "BASIL",
        bSpatialBASIL: true,
        bInferT1BASIL: true,
        bInferATTBASIL: true,
        ATTSDBASIL: 1.5,
      }),
    );
    const text = result.paragraphs.join(" ");
    expect(text).toContain("BASIL toolbox");
    expect(text).toContain("Spatial regularization");
    expect(text).toContain("dynamically inferred local T1");
    expect(text).toContain("prior standard deviation assumption of 1.5");
  });

  it("includes native quantification hematocrit modifier", () => {
    const result = generateMethodsParagraph(fullState({ bHct2BloodT1: 1 }));
    expect(result.paragraphs.join(" ")).toContain("individual hematocrit values");
    expect(result.references).toContain(REFERENCE_DICTIONARY["Hales 2016"]);
    expect(result.references).toContain(REFERENCE_DICTIONARY["Vaclavu 2016"]);
  });

  it("includes PVC paragraph when enabled", () => {
    const result = generateMethodsParagraph(
      fullState({
        bPVCNativeSpace: 1,
        bPVCGaussianMM: 1,
        PVCNativeSpaceKernel: [5, 5, 6],
      }),
    );
    expect(result.paragraphs.join(" ")).toContain("Partial volume correction (PVC)");
    expect(result.paragraphs.join(" ")).toContain("3D Gaussian kernel with dimensions of 5x5x6 mm");
  });

  it("includes population atlas and tissue masking sentences", () => {
    const result = generateMethodsParagraph(
      fullState({
        Atlases: ["Total", "DeepWM"],
        TissueMasking: ["GM", "WM"],
        TissueThreshold: [0.7, 0.7],
        MinimalROIVolume: 2,
        bWMH: true,
      }),
    );
    const text = result.paragraphs.join(" ");
    expect(text).toContain("Whole Brain Grey and White Matter");
    expect(text).toContain("Deep White Matter");
    expect(text).toContain("tissue probability threshold of 0.7, 0.7");
    expect(text).toContain("less than 2 mL");
    expect(text).toContain("white-matter hyperintensities");
  });

  it("uses merged spike removal defaults from FIELD_METADATA", () => {
    const result = generateMethodsParagraph(fullState());
    expect(result.paragraphs.join(" ")).toContain(
      "Z-score threshold of 0.01 and an absolute threshold of 0",
    );
  });
});

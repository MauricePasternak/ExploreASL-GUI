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
  return Object.assign(getDefaultDataPar(), overrides);
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
      bRunDARTEL: 0,
      WMHsegmAlg: "LGA",
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
    expect(flat.bRunDARTEL).toBe(0);
    expect(flat.WMHsegmAlg).toBe("LGA");
    expect(flat.Quality).toBe(1);
    expect(flat.Atlases).toEqual(["Total"]);
    expect(flat.bUseExternalQuantification).toBe(true);
    expect(flat.ExternalQuantificationType).toBe("BASIL");
    expect(
      flattenRunDataPar({
        x: {
          dataset: { subjectRegexp: "^sub-A$", exclusion: ["sub-A_2"] },
          Seg: { Method: "DARTEL" },
          Pediatric_Type: "neonate",
          WhichLongReg: "DARTEL",
          modules: { population: { bNativeSpaceAnalysis: 1 } },
        },
      }),
    ).toMatchObject({
      subjectRegexp: "^sub-A$",
      exclusion: ["sub-A_2"],
      Seg: { Method: "DARTEL" },
      Pediatric_Type: "neonate",
      WhichLongReg: "DARTEL",
      bNativeSpaceAnalysis: 1,
    });
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
  it("describes explicit supplied settings with sorted, unique references", () => {
    const result = generateMethodsParagraph(
      fullState({ bAutoACPC: true, bLesionFilling: true, WMHsegmAlg: "LGA" }),
    );

    expect(result.paragraphs).toHaveLength(5);
    expect(result.disclaimer).toBe(
      "This Methods draft reflects the dataPar.json available when this manifest was generated. Authors should verify that it describes the processing performed before publication.",
    );
    expect(result.paragraphs[1]).toContain("Structural processing");
    expect(result.paragraphs[2]).toContain("CAT12");
    expect(result.paragraphs[3]).toContain("M0");
    expect(result.paragraphs[4]).toContain("Regional");
    expect(result.paragraphs.join(" ")).not.toMatch(
      /[()\u2013\u2014\u2018\u2019\u201c\u201d]|is requested|not verified|versions are unavailable/,
    );
    expect(result.paragraphs[0]).not.toContain("dcm2niiX");
    expect(result.paragraphs.join(" ")).toContain("anterior commissure-posterior commissure");
    expect(result.paragraphs.join(" ")).toContain("CAT12");
    expect(result.paragraphs.join(" ")).toContain("lesion filling");
    expect(result.references).toContain(REFERENCE_DICTIONARY["Schmidt 2012"]);
    expect(result.paragraphs.join(" ")).not.toContain("M0 image was processed");
    expect(result.references.length).toBeGreaterThan(0);
    expect(new Set(result.references).size).toBe(result.references.length);
    expect(result.references).toEqual([...result.references].sort((a, b) => a.localeCompare(b)));
  });

  it.each([0, false])(
    "includes fast try-out mode and disables BASIL modifiers for Quality=%s",
    (Quality) => {
      const result = generateMethodsParagraph({
        ...fullState({
          bUseExternalQuantification: true,
          ExternalQuantificationType: "BASIL",
          bSpatialBASIL: true,
          bInferT1BASIL: true,
        }),
        Quality,
      });
      expect(result.paragraphs[0]).toContain("low-quality, fast try-out mode");
      expect(result.paragraphs[3]).toContain("External CBF fitting used BASIL");
      expect(result.paragraphs[3]).not.toMatch(/spatial regularization|inferred T1/);
    },
  );

  it("keeps Structural processing when conditional dummy references are enabled", () => {
    const result = generateMethodsParagraph(fullState({ bUseMNIasDummyStructural: 1 }));
    const text = result.paragraphs.join(" ");
    expect(text).toContain("dummy Structural references");
    expect(text).toContain("CAT12 segmented");
    expect(text).not.toContain("CAT12, release 1363");
    expect(text).not.toContain("Geodesic Shooting");
  });

  it.each([1, true])("uses SPM12 segmentation when bSegmentSPM12=%s", (bSegmentSPM12) => {
    const result = generateMethodsParagraph({ ...fullState(), bSegmentSPM12 });
    expect(result.paragraphs.join(" ")).toContain("SPM12 unified tissue segmentation");
    expect(result.references).not.toContain(REFERENCE_DICTIONARY["Gaser 2009"]);
    expect(result).toEqual(generateMethodsParagraph(fullState({ bSegmentSPM12: 1 })));
  });

  it("describes configured CBF contrast without inventing M0 registration", () => {
    const result = generateMethodsParagraph(fullState({ bRegistrationContrast: 1 }));
    expect(result.paragraphs.join(" ")).toContain("CBF/PWI-to-pseudo-CBF registration");
  });

  it("does not apply DCT refinement without affine registration", () => {
    const result = generateMethodsParagraph(
      fullState({ bDCTRegistration: 1, bRegistrationContrast: 0 }),
    );
    expect(result.paragraphs.join(" ")).toContain(
      "Discrete cosine transform refinement required affine registration, which was disabled",
    );
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

  it.each([
    [1, 1],
    [true, 1],
    [1, false],
  ] as const)("handles conventional M0=%s and registration=%s", (conventional, registration) => {
    const result = generateMethodsParagraph({
      ...fullState(),
      M0: "separate_scan",
      M0_conventionalProcessing: conventional,
      bRegisterM02ASL: registration,
    });
    const text = result.paragraphs.join(" ");
    expect(text).toContain("conventional M0 processing");
    if (registration) expect(text).toContain("M0 image was registered to the mean control image");
    else expect(text).not.toContain("M0 image was registered");
    expect(result).toEqual(
      generateMethodsParagraph(
        fullState({
          M0: "separate_scan",
          M0_conventionalProcessing: conventional ? 1 : 0,
          bRegisterM02ASL: registration ? 1 : 0,
        }),
      ),
    );
  });

  it.each(["UseControlAsM0", "no_background_suppression"])("handles control-image M0=%s", (M0) => {
    const result = generateMethodsParagraph({ ...fullState(), M0 });
    expect(result.paragraphs.join(" ")).toContain("ASL control images supplied");
    expect(result).toEqual(generateMethodsParagraph(fullState({ M0: "UseControlAsM0" })));
  });

  it("does not invent a calibration strategy for unsupported M0 strings", () => {
    const result = generateMethodsParagraph(fullState({ M0: "custom_path.nii" as never }));
    expect(result.paragraphs[3]).not.toMatch(
      /custom user-defined strategy|M0 calibration used|M0 image supplied|ASL control images supplied/,
    );
  });

  it("uses vascular-only masking branch", () => {
    const result = generateMethodsParagraph(fullState({ bMasking: [0, 1, 1, 1] }));
    expect(result.paragraphs.join(" ")).toContain("intravascular signal");
    expect(result.paragraphs[4]).not.toContain("susceptibility masks");
  });

  it("uses susceptibility-only masking branch", () => {
    const result = generateMethodsParagraph(fullState({ bMasking: [1, 0, 1, 1] }));
    expect(result.paragraphs[4]).toContain("susceptibility masks");
    expect(result.paragraphs.join(" ")).not.toContain("intravascular signal");
  });

  it.each([1, 0])(
    "describes BASIL only when quantification position 3 is enabled: %s",
    (quantify) => {
      const result = generateMethodsParagraph(
        fullState({
          bUseExternalQuantification: true,
          ExternalQuantificationType: "BASIL",
          bSpatialBASIL: true,
          bInferT1BASIL: true,
          bInferATTBASIL: true,
          ATTSDBASIL: 1.5,
          ApplyQuantification: [quantify, quantify, quantify, quantify, quantify, quantify],
        }),
      );
      const text = result.paragraphs.join(" ");
      if (!quantify) {
        expect(text).toContain("quantification operations were disabled");
        expect(text).not.toMatch(
          /External CBF fitting|spatial regularization|inferred T1|ATT prior/,
        );
        return;
      }
      expect(text).toContain("External CBF fitting used BASIL");
      expect(text).toContain("spatial regularization");
      expect(text).toContain("For multi-delay data, BASIL inferred T1");
      expect(text).toContain("prior standard deviation was 1.5 s");
      expect(text).not.toContain("ATT inference");
    },
  );

  it("includes native quantification hematocrit modifier for provided Hct (option 1)", () => {
    const result = generateMethodsParagraph(fullState({ bHct2BloodT1: 1, T1blood: undefined }));
    expect(result.paragraphs.join(" ")).toContain(
      "individual hematocrit values in participants.tsv determined blood T1",
    );
    expect(result.references).toContain(REFERENCE_DICTIONARY["Hales 2015"]);
  });

  it("includes native quantification hematocrit modifier for derived age and sex Hct (option 2)", () => {
    const result = generateMethodsParagraph(fullState({ bHct2BloodT1: 2, T1blood: undefined }));
    expect(result.paragraphs.join(" ")).toContain(
      "Where age and sex data were available in participants.tsv, derived hematocrit determined blood T1",
    );
    expect(result.references).toContain(REFERENCE_DICTIONARY["Hales 2015"]);
    expect(result.references).toContain(REFERENCE_DICTIONARY["NCHS 1967"]);
  });

  it.each([
    [1, "Gaussian kernel of 5x5x6 mm FWHM"],
    [0, "flat kernel of 5x5x6 voxels"],
    [true, "Gaussian kernel of 5x5x6 mm FWHM"],
  ] as const)("describes PVC kernel shape %s with correct units", (shape, expected) => {
    const result = generateMethodsParagraph({
      ...fullState(),
      bPVCNativeSpace: 1,
      bPVCGaussianMM: shape,
      PVCNativeSpaceKernel: [5, 5, 6],
    });
    expect(result.paragraphs.join(" ")).toContain(
      "Native-space voxelwise partial volume correction",
    );
    expect(result.paragraphs.join(" ")).toContain(expected);
  });

  it("includes population atlas and tissue masking sentences", () => {
    const result = generateMethodsParagraph(
      fullState({
        Atlases: ["Total", "Total", "DeepWM"],
        TissueMasking: ["GM", "GM+WM", "WM"],
        TissueThreshold: [0.7, 0.5, 0.6],
        DataTypes: ["qCBF", "ATT"],
        MinimalROIVolume: 2,
        bWMH: true,
      }),
    );
    const text = result.paragraphs.join(" ");
    expect(text).toContain("Whole Brain Grey and White Matter");
    expect(text).toContain("Deep White Matter");
    expect(text).toContain("qCBF and ATT");
    expect(text).toContain(
      "Whole Brain Grey and White Matter with GM partial volume greater than 0.7",
    );
    expect(text).toContain(
      "Whole Brain Grey and White Matter with summed GM+WM partial volume greater than 0.5",
    );
    expect(text).toContain("Deep White Matter with WM partial volume greater than 0.6");
    expect(text).toContain("minimum ROI volume was 2 mL");
    expect(text).toContain("white matter hyperintensity contributions were retained");
    expect(text).not.toContain("WMH detection");
  });

  it("describes explicit relative spike threshold without calling it a Z-score", () => {
    const result = generateMethodsParagraph({ SpikeRemovalThreshold: 0.01 });
    expect(result.paragraphs.join(" ")).toContain(
      "fractional t-statistic improvement threshold of 0.01",
    );
  });

  it("uses audited sparse defaults without inventing physiological values", () => {
    const text = generateMethodsParagraph(
      { bTopUp: true },
      { dataSource: "dicom" },
    ).paragraphs.join(" ");
    expect(text).toContain("CAT12");
    expect(text).toContain("0.01");
    expect(text).toContain("qCBF");
    expect(text).toContain("minimum ROI volume was 1 mL");
    expect(text.match(/Whole Brain Grey and White Matter/g)).toHaveLength(2);
    expect(text.match(/Tatu/g)).toHaveLength(2);
    expect(text).toContain("0.5");
    expect(text).toContain("subtracted");
    expect(text).not.toMatch(/1650|1240|converted DICOM/);
  });

  it("uses exact inclusion identifiers before exclusions instead of the regex", () => {
    const text = generateMethodsParagraph({
      subjectRegexp: "^sub-Z$",
      ForceInclusionList: ["sub-A_1"],
      exclusion: ["sub-A_2"],
    }).paragraphs[1];
    expect(text).toContain('"sub-A_1"');
    expect(text).toContain('"sub-A_2"');
    expect(text).toContain("instead of");
    expect(text).toContain('"^sub-Z$"');
    expect(text).toContain("after initial selection");
  });

  it("keeps missing-input Structural skip rules independent", () => {
    const text = generateMethodsParagraph({
      SkipIfNoASL: true,
      SkipIfNoFlair: true,
      SkipIfNoM0: false,
    }).paragraphs[1];
    expect(text).toContain("ASL image");
    expect(text).toContain("FLAIR image");
    expect(text).toContain("T1w image");
    expect(text).not.toMatch(/M0 image|every ASL run|excluded from the study/);
    expect(text).toContain('"^sub-.*$"');
  });

  it("preserves an empty inclusion list and ignores unsupported skip aliases", () => {
    const text = generateMethodsParagraph({
      ForceInclusionList: [],
      SkipIfNoT1: true,
      bSkipIfNoASL: true,
    }).paragraphs[1];
    expect(text).toContain("empty inclusion list");
    expect(text).not.toMatch(/ASL image|SkipIfNoT1|bSkipIfNoASL/);
  });

  it("returns no Methods or disclaimer for an absent configuration", () => {
    expect(generateMethodsParagraph(null)).toEqual({
      paragraphs: [],
      references: [],
      disclaimer: "",
    });
  });

  it("honors disabled defaults while FLAIR segmentation remains independent of filling", () => {
    const result = generateMethodsParagraph({
      bAutoACPC: false,
      bLesionFilling: false,
      motionCorrection: 0,
      bTopUp: false,
      bPVCNativeSpace: 0,
    });
    expect(result.paragraphs[2]).toContain("FLAIR");
    expect(result.paragraphs[2]).toContain("LPA");
    expect(result.paragraphs[2]).not.toMatch(/centre-of-mass|lesion filling/);
    expect(result.paragraphs[3]).not.toMatch(/realignment|TopUp|Native-space voxelwise/);
  });

  it("describes both smoothing passes for default separate-image M0 processing", () => {
    const text = generateMethodsParagraph({ M0: "separate_scan" }).paragraphs[3];
    expect(text).toContain("two successive");
    expect(text).toContain("16 mm FWHM");
  });

  it.each([
    [0, "5x5x1 voxels"],
    [1, "10x10x4 mm FWHM"],
  ])("uses shape-specific PVC defaults for shape %s", (shape, expected) => {
    expect(
      generateMethodsParagraph({ bPVCNativeSpace: 1, bPVCGaussianMM: shape }).paragraphs[3],
    ).toContain(expected);
  });

  it("describes two kinetic compartments rather than tissue count", () => {
    const text = generateMethodsParagraph({ nCompartments: 2, bUseExternalQuantification: false })
      .paragraphs[3];
    expect(text).toContain("dual-compartment kinetic model");
    expect(text).not.toContain("tissue-compartment count");
  });

  it("describes enabled quantification operations rather than a flag array", () => {
    const text = generateMethodsParagraph({
      M0: "separate_scan",
      ApplyQuantification: [0, 1, 0, 0, 1, 0],
    }).paragraphs[3];
    expect(text).toContain("M0 scale-slope correction");
    expect(text).toContain("division by M0");
    expect(text).not.toMatch(
      /manufacturer-specific ASL|label-intensity conversion|final scaling|\[0, 1/,
    );
  });

  it("gives explicit blood T1 precedence over hematocrit estimation", () => {
    const text = generateMethodsParagraph({ T1blood: 1500, bHct2BloodT1: 2 }).paragraphs[3];
    expect(text).toContain("blood T1 of 1500 ms");
    expect(text).not.toContain("hematocrit");
  });

  it("defaults missing thresholds for matching Population choices", () => {
    const text = generateMethodsParagraph({ Atlases: ["Total"], TissueMasking: ["GM"] })
      .paragraphs[4];
    expect(text).toContain("GM partial volume greater than 0.7");
  });

  it("does not replace explicit empty extraction arrays with defaults", () => {
    const text = generateMethodsParagraph({ Atlases: [], TissueMasking: [], DataTypes: [] })
      .paragraphs[4];
    expect(text).toContain("qCBF");
    expect(text).toContain("No atlas extraction choices");
    expect(text).not.toContain("Whole Brain");
  });

  it.each([
    { Atlases: ["Total", "DeepWM"], TissueMasking: ["GM"] },
    { Atlases: ["Total"], TissueMasking: ["GM"], TissueThreshold: [0.5, 0.7] },
  ])("does not repair mismatched Population arrays: %j", (state) => {
    expect(generateMethodsParagraph(state).paragraphs[4]).toBe(
      "Population atlas, tissue, and threshold arrays have mismatched lengths.",
    );
  });

  it("does not apply tissue thresholds or regional tissue PVC when tissue masking is off", () => {
    const text = generateMethodsParagraph({
      Atlases: ["Total"],
      TissueMasking: ["GM"],
      TissueThreshold: [0.7],
      bMasking: [0, 0, 0, 0],
      MinimalROIVolume: 0,
      bPVCNativeSpace: 1,
    }).paragraphs[4];
    expect(text).not.toMatch(/greater than|tissue-based regional PVC|native-space extraction/);
    expect(text).toContain("minimum ROI volume was 0 mL");
  });

  it("selects native Population extraction independently of native ASL PVC", () => {
    expect(generateMethodsParagraph({ bNativeSpaceAnalysis: 1 }).paragraphs[4]).toContain(
      "native-space extraction",
    );
  });

  it("uses recorded versions and distinguishes existing BIDS input from conversion", () => {
    const text = generateMethodsParagraph(
      {},
      {
        populationRun: {
          profileId: "old",
          Mtime: null,
          exploreASLVersion: "2.1",
          matlabVersion: "unknown",
          guiVersion: "0.1",
        },
        dataSource: "bids",
      },
    ).paragraphs.join(" ");
    expect(text).toContain("ExploreASL version 2.1");
    expect(text).not.toMatch(/unknown|current execution profile|3\.0/);
    expect(text).toContain("existing Brain Imaging Data Structure input, or BIDS");
    expect(text).not.toMatch(/private|dcm2niiX|7219|1363|2\.0\.15/);
  });

  it("reports completed DICOM import with the verified converter but no guessed version", () => {
    const text = generateMethodsParagraph(
      {},
      { dataSource: "dicom", importCompleted: true },
    ).paragraphs.join(" ");
    expect(text).toContain(
      "completed ExploreASL import workflow converted DICOM images with dcm2niix",
    );
    expect(text).not.toContain("20240202");
  });

  it("treats numeric M0 as scalar and explicit absolute zero as fixed-threshold choice", () => {
    const text = generateMethodsParagraph({
      M0: 123,
      bRegisterM02ASL: 1,
      SpikeRemovalAbsoluteThreshold: 0,
      SpikeRemovalThreshold: 0.1,
    }).paragraphs.join(" ");
    expect(text).toContain("numeric scalar of 123");
    expect(text).not.toContain("M0 image was registered");
    expect(text).toContain("absolute threshold of 0 mm");
    expect(text).not.toContain("ENABLE");
  });
});

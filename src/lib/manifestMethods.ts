import type { DataParState } from "../schemas/dataParSchema";
import type { DataSource, LastRun_Serialize } from "../generated/bindings";
import { ATLAS_DISPLAY_LABELS } from "./dataParFieldMetadata";
import { sanitiseDataParForExport } from "./manifestExport";

export const REFERENCE_DICTIONARY: Record<string, string> = {
  "Alsop 2015":
    "Alsop, D. C., Detre, J. A., Golay, X., Günther, M., Hendrikse, J., Hernandez-Garcia, L., Lu, H., MacIntosh, B. J., Parkes, L. M., Smits, M., van Osch, M. J. P., Wang, D. J. J., Wong, E. C., & Zaharchuk, G. (2015). Recommended implementation of arterial spin-labeled perfusion MRI for clinical applications: a consensus of the ISMRM perfusion study group and the European consortium for ASL in Dementia. Magnetic Resonance in Medicine, 73(1), 102–116.",
  "Ashburner 2011":
    "Ashburner, J., & Friston, K. J. (2011). Diffeomorphic registration using geodesic shooting and Gauss-Newton optimisation. NeuroImage, 55(3), 954–967.",
  "Ashburner 2012": "Ashburner, J. (2012). SPM: a history. NeuroImage, 62(2), 791–800.",
  "Ashburner 2012b":
    "Ashburner, J., & Ridgway, G. R. (2012). Symmetric diffeomorphic modeling of longitudinal structural MRI. Frontiers in Neuroscience, 6, 197.",
  "Asllani 2008":
    "Asllani, I., Borogovac, A., & Brown, T. R. (2008). Regression algorithm correcting for partial volume effects in arterial spin labeling MRI. Magnetic Resonance in Medicine, 60(6), 1362–1371.",
  "Battaglini 2012":
    "Battaglini, M., Jenkinson, M., & De Stefano, N. (2012). Evaluating and reducing the impact of white matter lesions on brain volume measurements. Human Brain Mapping, 33(9), 2062–2071.",
  "de Sitter 2017a":
    "de Sitter, A., Steenwijk, M. D., Ruet, A., Versteeg, A., Liu, Y., van Schijndel, R. A., Pouwels, P. J. W., et al. (2017a). Performance of five research-domain automated WM lesion segmentation methods in a multi-center MS study. NeuroImage, 163, 106–114.",
  "Evans 2012":
    "Evans, A. C., Janke, A. L., Collins, D. L., & Baillet, S. (2012). Brain templates and atlases. NeuroImage, 62(2), 911–922.",
  "Flandin 2008":
    "Flandin, G., & Friston, K. (2008). Statistical parametric mapping (SPM). Scholarpedia, 3(4), 6232.",
  "Gaser 2009":
    "Gaser, C. (2009). Partial volume segmentation with adaptive maximum a posteriori (MAP) approach. NeuroImage, 47(1), S39–S41.",
  "Gorgolewski 2016":
    "Gorgolewski, K. J., Auer, T., Calhoun, V. D., Craddock, R. C., Das, S., Duff, E. P., Flandin, G., et al. (2016). The brain imaging data structure, a format for organizing and describing outputs of neuroimaging experiments. Scientific Data, 3, 160044.",
  "Hales 2015":
    "Hales, P. W., Kirkham, F. J., & Clark, C. A. (2015). A general model to calculate the spin-lattice (T1) relaxation time of blood, accounting for haematocrit, oxygen saturation and magnetic field strength. Journal of Cerebral Blood Flow & Metabolism, 36(2), 370–374.",
  "Hales 2016":
    "Hales, P. W., Kirkham, F. J., & Clark, C. A. (2015). A general model to calculate the spin-lattice (T1) relaxation time of blood, accounting for haematocrit, oxygen saturation and magnetic field strength. Journal of Cerebral Blood Flow & Metabolism, 36(2), 370–374.",
  "Li 2016":
    "Li, X., Morgan, P. S., Ashburner, J., Smith, J., & Rorden, C. (2016). The first step for neuroimaging data analysis: DICOM to NIfTI conversion. Journal of Neuroscience Methods, 264, 47–56.",
  "Maumet 2012":
    "Maumet, C., Maurel, P., Ferré, J.-C., Bannier, E., & Barillot, C. (2012). Using negative signal in mono-TI pulsed arterial spin labeling to outline pathological increases in arterial transit times. ISMRM Scientific Workshop, 40, p. 42.",
  "Mutsaerts 2018":
    "Mutsaerts, H. J. M. M., Petr, J., Thomas, D. L., De Vita, E., Cash, D. M., van Osch, M. J. P., Golay, X., et al. (2018). Comparison of arterial spin labeling registration strategies in the multi-center GENetic frontotemporal Dementia initiative (GENFI). Journal of Magnetic Resonance Imaging, 47(1), 131–140.",
  "Mutsaerts 2020":
    "Mutsaerts, H. J. M. M., Petr, J., Groot, P., Vandemaele, P., Ingala, S., Robertson, A. D., ... & Barkhof, F. (2020). ExploreASL: An image processing pipeline for multi-center ASL perfusion MRI studies. NeuroImage, 219, 117031.",
  "NCHS 1967":
    "National Center for Health Statistics (U.S.). (1967). Mean blood hematocrit of adults; United States, 1960-1962. Vital and Health Statistics, Series 11, No. 24.",
  "Oliver 2015":
    "Oliver, R. A. (2015). Improved Quantification of Arterial Spin Labelling Images Using Partial Volume Correction Techniques. UCL (University College London).",
  "Petr 2018a":
    "Petr, J., Mutsaerts, H. J. M., De Vita, E., ... & Asllani, I. (2018a). Effects of systematic partial volume errors on the estimation of gray matter cerebral blood flow with arterial spin labeling MRI. MAGMA. 31(6), 725–734.",
  "Schmidt 2012":
    "Schmidt, P., Gaser, C., Arsic, M., Buck, D., Förschler, A., Berthele, A., Hoshi, M., et al. (2012). An automated tool for detection of FLAIR-hyperintense white-matter lesions in multiple sclerosis. NeuroImage, 59(4), 3774–3783.",
  "Shirzadi 2015":
    "Shirzadi, Z., Crane, D. E., Robertson, A. D., Maralani, P. J., Aviv, R. I., Chappell, M. A., Goldstein, B. I., Black, S. E., & MacIntosh, B. J. (2015). Automated removal of spurious intermediate cerebral blood flow volumes improves image quality among older patients: a clinical arterial spin labeling investigation. Journal of Magnetic Resonance Imaging, 42(5), 1377–1385.",
  "Vaclavu 2016":
    "Vaclavu, L., van der Land, V., Heijtel, D. F. R., van Osch, M. J. P., ... & Majoie, C. B. L. M. (2016). In vivo T1 of blood measurements in children with sickle cell disease improve cerebral blood flow quantification from arterial spin-labeling MRI. AJNR Am. J. Neuroradiol. 37(9), 1727–1732.",
  "Wang 2012":
    "Wang, Z. (2012). Improving cerebral blood flow quantification for arterial spin labeled perfusion MRI by removing residual motion artifacts and global signal fluctuations. Magnetic Resonance Imaging, 30(10), 1409–1415.",
};

export interface MethodsParagraphResult {
  paragraphs: string[];
  references: string[];
  disclaimer: string;
}

function mergeSections(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
}

/** Flatten available file settings only. This does not assemble processing parameters. */
export function flattenRunDataPar(
  nested: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!nested || Object.keys(nested).length === 0) return {};
  const x = nested.x as Record<string, unknown> | undefined;
  if (!x) return { ...nested };
  const modules = x.modules as Record<string, Record<string, unknown>> | undefined;
  const flat: Record<string, unknown> = {};
  for (const section of [
    x.Q,
    modules?.asl,
    modules?.structural,
    x.settings,
    x.S,
    x.external,
    x.dataset,
    modules?.population,
  ]) {
    mergeSections(flat, section as Record<string, unknown> | undefined);
  }
  for (const key of ["bRunLongReg", "bRunDARTEL"]) {
    if (modules?.[key] !== undefined) flat[key] = modules[key];
  }
  for (const key of [
    "WMHsegmAlg",
    "Seg",
    "Pediatric_Type",
    "WhichLongReg",
    "bAutomaticallyDetectFSL",
    "bAutomaticallyDetectVABY",
  ]) {
    if (x[key] !== undefined) flat[key] = x[key];
  }
  return flat;
}

type MethodsSettings = DataParState & {
  subjectRegexp?: string;
  ForceInclusionList?: string[];
  exclusion?: string | string[];
  Seg?: { DisableDARTEL?: boolean | number; Method?: string };
  Pediatric_Type?: string;
  Pediatric_Template?: boolean | number;
  WhichLongReg?: string;
  bNativeSpaceAnalysis?: boolean | number;
};

export interface MethodsEvidence {
  populationRun?: LastRun_Serialize;
  dataSource?: DataSource;
  importCompleted?: boolean;
}

function joinParagraph(sentences: string[]): string {
  return sentences.filter(Boolean).join(" ");
}

function formatListWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Report-only defaults audited in ExploreASL 8034b79089eeb918ea3f11931c07652c5d7b364f,
// VERSION_2.0.0_BETA. Source paths below are relative to that checkout.
// Modules/xASL_module_Population.m:53-108. These arrays are indexed triples.
const DEFAULT_EXTRACTIONS = [
  ["Total", "GM", 0.7],
  ["Total", "GM", 0.5],
  ["DeepWM", "WM", 0.5],
  ["Tatu_ACA_MCA_PCA", "GM", 0.7],
  ["Tatu_ACA_MCA_PCA", "GM", 0.5],
] as const;

function generateImport(
  state: MethodsSettings,
  evidence: MethodsEvidence,
  refs: Set<string>,
): string {
  refs.add("Mutsaerts 2020");
  const sentences = ["Images were processed with ExploreASL, described by Mutsaerts et al., 2020."];
  const run = evidence.populationRun;
  const software = [
    run?.exploreASLVersion && run.exploreASLVersion !== "unknown"
      ? `ExploreASL version ${run.exploreASLVersion}`
      : "",
    run?.matlabVersion && run.matlabVersion !== "unknown" ? `MATLAB ${run.matlabVersion}` : "",
    run?.guiVersion && run.guiVersion !== "unknown"
      ? `ExploreASL GUI version ${run.guiVersion}`
      : "",
  ].filter(Boolean);
  if (software.length)
    sentences.push(`Recorded software versions were ${formatListWithAnd(software)}.`);
  if (evidence.dataSource === "bids") {
    refs.add("Gorgolewski 2016");
    sentences.push(
      "The project used existing Brain Imaging Data Structure input, or BIDS, described by Gorgolewski et al., 2016.",
    );
  } else if (evidence.dataSource === "dicom" && evidence.importCompleted === true) {
    // GUI import/pipeline.rs uses [1,1,0]; xASL_module_Import.m:153-177.
    refs.add("Li 2016");
    refs.add("Gorgolewski 2016");
    sentences.push(
      "The completed ExploreASL import workflow converted DICOM images with dcm2niix and prepared ASL-BIDS data. These methods are described by Li et al., 2016, and Gorgolewski et al., 2016.",
    );
  } else if (evidence.dataSource === "dicom") {
    sentences.push("DICOM images were the project input.");
  }
  if (state.Quality === 0)
    sentences.push(
      "Processing used a low-quality, fast try-out mode with fewer iterations and lower spatial resolution.",
    );
  return joinParagraph(sentences);
}

function generateInclusion(state: MethodsSettings): string {
  // xASL_init_SubjectList.m:50-140,171-217; xASL_module_Structural.m:70-85,145-168.
  const expression = state.subjectRegexp ?? "^sub-.*$";
  const sentences = [
    state.ForceInclusionList !== undefined
      ? `Initial dataset selection used ${state.ForceInclusionList.length ? `the exact inclusion identifiers ${state.ForceInclusionList.map((id) => `"${id}"`).join(", ")}` : "an empty inclusion list"} instead of the subject-selection expression "${expression}".`
      : `Initial dataset selection used the subject-selection expression "${expression}".`,
  ];
  const exclusions = typeof state.exclusion === "string" ? [state.exclusion] : state.exclusion;
  if (exclusions?.some(Boolean))
    sentences.push(
      `Exact identifiers ${exclusions
        .filter(Boolean)
        .map((id) => `"${id}"`)
        .join(", ")} were excluded after initial selection.`,
    );
  sentences.push(
    "Structural processing was skipped for participant visits without a resolved T1w image.",
  );
  for (const [flag, image] of [
    [state.SkipIfNoASL, "ASL"],
    [state.SkipIfNoFlair, "FLAIR"],
    [state.SkipIfNoM0, "M0"],
  ] as const) {
    if (flag)
      sentences.push(
        `Structural processing was also skipped for participant visits without a resolved ${image} image.`,
      );
  }
  return joinParagraph(sentences);
}

function generateStructural(state: MethodsSettings, refs: Set<string>): string {
  // xASL_init_Process.m:150-168; xASL_wrp_SegmentT1w.m:49-53,89-193,475-522.
  const sentences: string[] = [];
  if (state.bAutoACPC == null || state.bAutoACPC)
    sentences.push(
      "T1w images underwent centre-of-mass initialization and alignment to the anterior commissure-posterior commissure orientation.",
    );
  if (state.bFixResolution)
    sentences.push(
      "Before segmentation, coarse T1w dimensions were resampled toward 1.5 mm while finer dimensions were retained.",
    );
  if (state.bSegmentSPM12 === 1) {
    refs.add("Ashburner 2012");
    refs.add("Flandin 2008");
    sentences.push(
      "SPM12 unified tissue segmentation produced gray matter, white matter, and cerebrospinal fluid partial volume maps, as described by Ashburner, 2012, and Flandin and Friston, 2008.",
    );
  } else {
    refs.add("Gaser 2009");
    sentences.push(
      "CAT12 segmented T1w images into gray matter, white matter, and cerebrospinal fluid partial volume maps, as described by Gaser, 2009. SPM12 segmentation provided a fallback if CAT12 failed.",
    );
    if (state.bHammersCAT12) sentences.push("CAT12 also produced Hammers atlas parcellations.");
  }
  // xASL_module_Structural.m:96-129,299-342. Segmentation does not depend on filling.
  refs.add("Schmidt 2012");
  refs.add("de Sitter 2017a");
  const wmhAlgorithm = state.WMHsegmAlg?.toUpperCase() === "LGA" ? "LGA" : "LPA";
  sentences.push(
    `For participant visits with FLAIR images, white matter hyperintensities were segmented with the Lesion Segmentation Toolbox using ${wmhAlgorithm}, as described by Schmidt et al., 2012, and de Sitter et al., 2017a. Existing WMH maps took precedence over new segmentation, and previous LPA or LGA outputs could determine the algorithm.`,
  );
  if (state.bLesionFilling == null || state.bLesionFilling) {
    refs.add("Battaglini 2012");
    sentences.push(
      "Available lesion maps supported T1w lesion filling before tissue segmentation, as described by Battaglini et al., 2012.",
    );
  }
  if (state.Seg?.DisableDARTEL) {
    sentences.push(
      "Spatial normalization used affine and discrete cosine transform registration without CAT12 nonlinear normalization.",
    );
  } else if (state.bSegmentSPM12 !== 1 && !state.Pediatric_Template && !state.Pediatric_Type) {
    const method = state.Seg?.Method?.toUpperCase();
    if (method === "GS") {
      refs.add("Ashburner 2011");
      sentences.push(
        "CAT12 normalization used geodesic shooting, as described by Ashburner and Friston, 2011.",
      );
    } else if (method === "DARTEL") sentences.push("CAT12 normalization used DARTEL registration.");
    else
      sentences.push(
        "CAT12 normalized tissue maps to standard space using its geodesic shooting or DARTEL registration workflow.",
      );
  } else
    sentences.push(
      "Tissue maps were spatially normalized with the Structural registration workflow.",
    );
  if (state.bRunDARTEL)
    sentences.push(
      "Additional group DARTEL registration constructed a population-specific template.",
    );
  else if (state.bSegmentSPM12 === 1)
    sentences.push(
      "For datasets with multiple participant visits, the SPM12 branch also used group DARTEL registration.",
    );
  if (state.bRunLongReg) {
    if (state.WhichLongReg?.toUpperCase() !== "DARTEL") refs.add("Ashburner 2012b");
    sentences.push(
      state.WhichLongReg?.toUpperCase() === "DARTEL"
        ? "Multiple aligned T1w visits underwent longitudinal DARTEL registration. Transformations linked each visit to the first selected visit."
        : "Multiple aligned T1w visits underwent SPM12 longitudinal registration, as described by Ashburner and Ridgway, 2012. Transformations linked each visit through the longitudinal average to the first selected visit.",
    );
  }
  if (state.bUseMNIasDummyStructural)
    sentences.push(
      "For ASL processing without raw or processed Structural images, an MNI template supplied dummy Structural references. Existing Structural derivatives were retained when available.",
    );
  return joinParagraph(sentences);
}

function generateASL(state: MethodsSettings, refs: Set<string>): string {
  const sentences: string[] = [];
  // xASL_module_ASL.m:301-337,645-652; xASL_wrp_RealignASL.m:71-94,134-184.
  if (state.motionCorrection === undefined || state.motionCorrection) {
    refs.add("Wang 2012");
    sentences.push(
      "Eligible ASL time series underwent SPM12 realignment with a zig-zag regressor for control-label contrast differences, as described by Wang, 2012. Realignment required multiple frames per echo and did not apply to Look-Locker or subtraction-only input.",
    );
    if (state.SpikeRemovalAbsoluteThreshold !== undefined)
      sentences.push(
        `For eligible single-delay, single-echo data, control-label pairs with motion above an absolute threshold of ${state.SpikeRemovalAbsoluteThreshold} mm were removed.`,
      );
    else {
      refs.add("Shirzadi 2015");
      sentences.push(
        `For eligible single-delay, single-echo series with at least five control-label pairs, ENABLE removed outliers using a fractional t-statistic improvement threshold of ${state.SpikeRemovalThreshold ?? 0.01}, as described by Shirzadi et al., 2015.`,
      );
    }
    sentences.push("Outlier exclusion was disabled for multi-delay and multi-echo data.");
  }
  // xASL_module_ASL.m:258-296. TopUp has input-dependent defaults.
  if (state.bTopUp == null || state.bTopUp)
    sentences.push(
      "For runs with M0 and reversed phase-encoding images, FSL TopUp corrected susceptibility distortion. TopUp was disabled when ASL runs were merged.",
    );
  refs.add("Mutsaerts 2018");
  const contrasts = [
    "control-to-T1w registration",
    "CBF/PWI-to-pseudo-CBF registration",
    "control-to-T1w registration followed by CBF-to-pseudo-CBF attempts according to image contrast",
    "control-to-T1w registration followed by forced CBF-to-pseudo-CBF attempts",
  ];
  sentences.push(
    state.bDCTRegistration
      ? "ASL registration used control and forced CBF-to-pseudo-CBF attempts."
      : state.bRegistrationContrast !== undefined
        ? `ASL alignment used ${contrasts[state.bRegistrationContrast] ?? "contrast-dependent registration"}, as described by Mutsaerts et al., 2018.`
        : "ASL alignment used CBF-to-pseudo-CBF registration for single-volume input, or control-to-T1w followed by contrast-dependent CBF registration for time series, as described by Mutsaerts et al., 2018.",
  );
  if (state.bRegistrationContrast !== 1)
    sentences.push(
      "When mean control images were unavailable, M0 could supply the initial registration contrast.",
    );
  // xASL_wrp_RegisterASL.m:124-141,403-598.
  if (state.bAffineRegistration)
    sentences.push(
      state.bDCTRegistration
        ? "Affine registration included a discrete cosine transform refinement when the registration quality checks permitted it."
        : `Additional affine registration ${state.bAffineRegistration === 2 ? "depended on spatial CBF heterogeneity and registration quality" : "was evaluated against image-overlap quality"}.`,
    );
  else if (state.bDCTRegistration)
    sentences.push(
      "Discrete cosine transform refinement required affine registration, which was disabled.",
    );
  // xASL_adm_LoadParms.m:183-190; xASL_quant_M0.m:49-60.
  const m0 =
    typeof state.M0 === "string" && state.M0.toLowerCase() === "no_background_suppression"
      ? "UseControlAsM0"
      : state.M0;
  if (typeof m0 === "number") sentences.push(`M0 calibration used a numeric scalar of ${m0}.`);
  else if (m0 === "separate_scan" || m0 === "UseControlAsM0") {
    sentences.push(
      m0 === "separate_scan"
        ? "A separate M0 image supplied calibration."
        : "ASL control images supplied the M0 calibration image.",
    );
    if (m0 === "separate_scan" && state.bRegisterM02ASL !== 0)
      sentences.push(
        "For eligible non-spiral acquisitions, the M0 image was registered to the mean control image, or to T1w when no mean control image was available.",
      );
    if (state.M0_conventionalProcessing === 1)
      sentences.push(
        "For compatible two-dimensional acquisitions, conventional M0 processing masked the image in native and standard space. Three-dimensional acquisitions used the standard M0 processing workflow instead.",
      );
    else
      sentences.push(
        "M0 processing masked and eroded the calibration image, applied two successive Gaussian smoothing passes at 16 mm FWHM, extrapolated missing values, and rescaled to the median gray matter M0 signal.",
      );
    if (state.M0_GMScaleFactor !== undefined)
      sentences.push(
        `M0 image quantification used an additional scale factor of ${state.M0_GMScaleFactor}.`,
      );
  } else if (m0 === "Absent")
    sentences.push(
      "M0 processing, M0 scale-slope correction, M0 relaxation correction, and division by M0 were disabled.",
    );
  else if (m0 === undefined)
    sentences.push(
      "M0 calibration followed the available calibration image or acquisition-specific strategy.",
    );
  // xASL_module_ASL.m:803-840,1015-1033; xASL_quant_ASL.m:127-361,403-436.
  const flags = state.ApplyQuantification;
  if (flags?.length) {
    const operations = [
      "manufacturer-specific ASL scaling",
      "M0 scale-slope correction",
      "label-intensity conversion with kinetic modeling",
      "M0 relaxation correction",
      "division by M0",
      "final scaling",
    ];
    const enabled = operations.filter(
      (_, i) => flags[i] && !(m0 === "Absent" && [1, 3, 4].includes(i)),
    );
    if (enabled.length)
      sentences.push(
        `Quantification included ${formatListWithAnd(enabled)} where applicable to the acquisition.`,
      );
    else sentences.push("The supplied quantification operations were disabled.");
  } else
    sentences.push(
      "Quantification applied acquisition-specific scaling and calibration unless the input already contained quantified CBF images.",
    );
  const external =
    state.bUseExternalQuantification ??
    /^(basil|fabber|vaby)$/i.test(state.ExternalQuantificationType ?? "");
  // xASL_quant_ASL.m:127-132,196-200 gates external fitting on position 3.
  if (external && flags?.[2] !== 0) {
    const engine = state.ExternalQuantificationType;
    sentences.push(
      engine
        ? `External CBF fitting used ${engine}.`
        : "External CBF fitting used the acquisition-dependent quantification engine.",
    );
    if (engine?.toUpperCase() === "BASIL" && state.Quality !== 0) {
      if (state.bSpatialBASIL) sentences.push("BASIL used spatial regularization.");
      if (state.bInferT1BASIL)
        sentences.push("For multi-delay data, BASIL inferred T1 relaxation values.");
      if (state.ATTSDBASIL !== undefined)
        sentences.push(
          `For multi-delay fitting, the ATT prior standard deviation was ${state.ATTSDBASIL} s.`,
        );
    }
  } else if (flags?.[2] !== 0) {
    if (state.nCompartments !== 2) refs.add("Alsop 2015");
    sentences.push(
      `When native label-intensity conversion was enabled, single-delay quantification used a ${state.nCompartments === 2 ? "dual-compartment kinetic model" : "single-compartment kinetic model, as described by Alsop et al., 2015"}.`,
    );
    if (state.bUseExternalQuantification == null)
      sentences.push(
        "Multi-delay or multi-echo acquisitions could instead use BASIL or FABBER fitting.",
      );
  }
  // xASL_quant_DefineQuantificationParameters.m:150-190. Do not insert field-dependent T1s.
  if (state.Lambda !== undefined)
    sentences.push(`The blood-brain partition coefficient was ${state.Lambda} mL/g.`);
  if (state.T1blood != null)
    sentences.push(`Quantification used an arterial blood T1 of ${state.T1blood} ms.`);
  else if (state.bHct2BloodT1 === 1 || state.bHct2BloodT1 === 2) {
    refs.add("Hales 2015");
    if (state.bHct2BloodT1 === 2) refs.add("NCHS 1967");
    sentences.push(
      state.bHct2BloodT1 === 1
        ? "Where available, individual hematocrit values in participants.tsv determined blood T1, as described by Hales et al., 2015."
        : "Where age and sex data were available in participants.tsv, derived hematocrit determined blood T1, as described by Hales et al., 2015, and the National Center for Health Statistics, 1967.",
    );
  }
  if (state.T1GM !== undefined) sentences.push(`Gray matter T1 was ${state.T1GM} ms.`);
  // xASL_wrp_PVC.m:48-58,104-120; xASL_module_ASL.m:645-648.
  if (state.bPVCNativeSpace) {
    refs.add("Asllani 2008");
    refs.add("Oliver 2015");
    const gaussian = state.bPVCGaussianMM === 1;
    const kernel = state.PVCNativeSpaceKernel?.length
      ? state.PVCNativeSpaceKernel
      : gaussian
        ? [10, 10, 4]
        : [5, 5, 1];
    sentences.push(
      `Native-space voxelwise partial volume correction used linear regression with a ${gaussian ? "Gaussian" : "flat"} kernel of ${kernel.join("x")} ${gaussian ? "mm FWHM" : "voxels"}, as described by Asllani et al., 2008, and Oliver, 2015.`,
    );
  }
  return joinParagraph(sentences);
}

function generatePopulation(state: MethodsSettings): string {
  let atlases = state.Atlases;
  let tissues = state.TissueMasking;
  let thresholds = state.TissueThreshold;
  if (atlases === undefined && tissues === undefined) {
    // Population.m:58-65 also supports thresholds supplied without atlas/tissue arrays.
    const defaults =
      thresholds === undefined
        ? DEFAULT_EXTRACTIONS
        : [DEFAULT_EXTRACTIONS[0], DEFAULT_EXTRACTIONS[2], DEFAULT_EXTRACTIONS[3]];
    atlases = defaults.map(([atlas]) => atlas);
    tissues = defaults.map(([, tissue]) => tissue);
    thresholds ??= defaults.map(([, , threshold]) => threshold);
  }
  if (
    !atlases ||
    !tissues ||
    atlases.length !== tissues.length ||
    (thresholds !== undefined && thresholds.length !== tissues.length)
  )
    return "Population atlas, tissue, and threshold arrays have mismatched lengths.";
  thresholds ??= tissues.map(() => 0.7);
  const dataTypes = state.DataTypes?.length ? state.DataTypes : ["qCBF"];
  // xASL_stat_GetROIstatistics.m:155-182,767-815,857-900. Masks control extraction.
  const masking = state.bMasking as number[] | number | undefined;
  const masks =
    Array.isArray(masking) && masking.length
      ? masking
      : masking === 0
        ? [0, 0, 0, 0]
        : [1, 1, 1, 1];
  const sentences = [
    `Regional statistics were extracted for ${formatListWithAnd(dataTypes)} in standard space${state.bNativeSpaceAnalysis ? ", with additional native-space extraction" : ""}.`,
  ];
  if (!atlases.length) sentences.push("No atlas extraction choices were specified.");
  else
    sentences.push(
      `Each image type used the following atlas choices. Tissue criteria applied only to tissue-masked ASL extraction: ${atlases.map((atlas, i) => `${ATLAS_DISPLAY_LABELS[atlas] ?? atlas} with ${masks[2] ? `${tissues[i].includes("+") || tissues[i] === "WB" ? "summed " : ""}${tissues[i] === "WB" ? "GM+WM" : tissues[i]} partial volume greater than ${thresholds[i]}` : "tissue masking disabled"}`).join("; ")}.`,
    );
  if (masks[0])
    sentences.push(
      "For standard-space extraction, susceptibility masks excluded regions affected by signal dropout.",
    );
  if (masks[1])
    sentences.push("Vascular masks excluded intravascular signal from regional mean estimates.");
  if (masks[3]) sentences.push("Whole-brain masks constrained extraction to brain tissue.");
  if (masks[2])
    sentences.push(
      "For ASL image types, tissue masks constrained extraction using the specified partial volumes. Tissue masking was disabled for non-ASL image types.",
    );
  sentences.push(
    state.bWMH
      ? "Existing white matter hyperintensity contributions were retained in tissue partial volumes."
      : "Where WMH maps were available, their contributions were subtracted from tissue partial volumes.",
  );
  sentences.push(
    `The minimum ROI volume was ${state.MinimalROIVolume ?? 1} mL for ordinary atlas extraction.`,
  );
  return joinParagraph(sentences);
}

/** Generate one manuscript draft from available configuration, not GUI placeholders. */
export function generateMethodsParagraph(
  rawState: Record<string, unknown> | null,
  evidence: MethodsEvidence = {},
): MethodsParagraphResult {
  if (rawState === null) return { paragraphs: [], references: [], disclaimer: "" };
  const fileSettings = sanitiseDataParForExport(rawState);
  // These binary source flags accept both logical and numeric JSON values.
  // Preserve omitted values and leave multivalued settings unchanged.
  for (const key of [
    "bSegmentSPM12",
    "M0_conventionalProcessing",
    "bRegisterM02ASL",
    "bPVCGaussianMM",
    "Quality",
  ]) {
    if (typeof fileSettings[key] === "boolean") fileSettings[key] = Number(fileSettings[key]);
  }
  const state = fileSettings as MethodsSettings;
  const refs = new Set<string>();
  const paragraphs = [
    generateImport(state, evidence, refs),
    generateInclusion(state),
    generateStructural(state, refs),
    generateASL(state, refs),
    generatePopulation(state),
  ];
  return {
    paragraphs,
    references: [...new Set([...refs].map((id) => REFERENCE_DICTIONARY[id]).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    ),
    disclaimer:
      "This Methods draft reflects the dataPar.json available when this manifest was generated. Authors should verify that it describes the processing performed before publication.",
  };
}

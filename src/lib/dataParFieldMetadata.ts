// ---------------------------------------------------------------------------
// Data.par field metadata — labels, help, hints, and defaults
// ---------------------------------------------------------------------------

export interface FieldMeta {
  label: string;
  description: string;
  defaultHint: string;
  default?: unknown;
}

// ---------------------------------------------------------------------------
// FIELD_METADATA
// ---------------------------------------------------------------------------

export const FIELD_METADATA: Record<string, FieldMeta> = {
  // === m0 ===
  M0: {
    label: "M0 source",
    description:
      "Select M0 equilibrium magnetization calibration: a separate scan, control images, or a numeric scalar calibration value. 'Absent' skips M0 processing. The GUI initially displays 'Absent'; when unset, ExploreASL chooses from available data.",
    default: "Absent",
    defaultHint: "Absent",
  },
  BackgroundSuppressionNumberPulses: {
    label: "Background suppression pulses",
    description:
      "The number of background suppression pulses applied to reduce background tissue signal and improve contrast-to-noise ratio.",
    default: 0,
    defaultHint: "0",
  },
  BackgroundSuppressionPulseTime: {
    label: "Background suppression pulse times (ms)",
    description:
      "Pulse times in milliseconds after the start of labeling, as a scalar or comma-separated list. These are ExploreASL processing units, not BIDS seconds.",
    defaultHint: "",
  },
  M0_GMScaleFactor: {
    label: "M0 grey-matter scale factor",
    description:
      "A scaling factor applied to the M0 image to calibrate the signal in grey matter regions.",
    default: 1,
    defaultHint: "1",
  },
  bRegisterM02ASL: {
    label: "Register M0 to ASL",
    description:
      "Allow M0 registration to mean control, or T1w if mean control is unavailable. Explicit 0 skips registration; when unset, ExploreASL decides from M0 source and sequence. Registration is skipped for control-as-M0 and spiral sequences.",
    default: 0,
    defaultHint: "Data-dependent when unset",
  },
  M0_conventionalProcessing: {
    label: "Legacy / Conventional M0 calibration",
    description:
      "Use conventional native-space M0 masking and minor smoothing instead of erosion, smoothing and extrapolation. ExploreASL disables this option for 3D acquisitions.",
    default: 0,
    defaultHint: "false",
  },
  RepetitionTimePreparationM0: {
    label: "Legacy M0 repetition time (s)",
    description:
      "Legacy value retained for saved projects. The audited ExploreASL 2.0.0_BETA processing code does not read x.Q.RepetitionTimePreparationM0; M0 recovery correction reads RepetitionTimePreparation or RepetitionTime from scan metadata. This key is used during import, not as a processing override.",
    default: [],
    defaultHint: "",
  },

  // === quantification ===
  nCompartments: {
    label: "Tissue compartment kinetic model",
    description:
      "The number of physical/tissue compartments modeled in the kinetic quantification. Usually set to 1 (single-compartment model).",
    default: 1,
    defaultHint: "Single compartment model",
  },
  Lambda: {
    label: "Blood-brain partition coefficient (λ)",
    description:
      "The blood-brain partition coefficient (water solubility ratio between brain tissue and blood). Standard value is 0.9 mL/g.",
    default: 0.9,
    defaultHint: "0.9",
  },
  T2art: {
    label: "T2 of arterial blood",
    description: "The transverse relaxation time (T2) of arterial blood in milliseconds.",
    default: 165,
    defaultHint: "165 at 3 T; field-dependent",
  },
  T1blood: {
    label: "T1 of arterial blood",
    description:
      "The longitudinal relaxation time (T1) of arterial blood in milliseconds. Typically 1650 ms at 3 Tesla.",
    default: 1650,
    defaultHint: "1650 at 3 T; field-dependent",
  },
  T1GM: {
    label: "T1 of grey matter",
    description:
      "The longitudinal relaxation time (T1) of grey matter tissue in milliseconds (typically 1240 ms).",
    default: 1240,
    defaultHint: "1240 at 3 T; field-dependent",
  },
  T1WM: {
    label: "T1 of white matter",
    description:
      "The longitudinal relaxation time (T1) of white matter tissue in milliseconds (typically 800 ms).",
    default: 800,
    defaultHint: "800 at 3 T; field-dependent",
  },
  T2GM: {
    label: "T2 of grey matter",
    description:
      "The transverse relaxation time (T2) of grey matter tissue in milliseconds (typically 85 ms).",
    default: 85,
    defaultHint: "85 at 3 T; field-dependent",
  },
  T2WM: {
    label: "T2 of white matter",
    description:
      "White-matter T2 in milliseconds. ExploreASL defaults to 75 ms at 3 T and 86 ms at 1.5 T when unset.",
    default: 76,
    defaultHint: "75 at 3 T; field-dependent",
  },
  T2tissueMultiTE: {
    label: "T2 tissue (multi-TE)",
    description:
      "The transverse relaxation time (T2) of brain tissue in milliseconds, used specifically for multi-echo-time (multi-TE) ASL sequences.",
    default: 85,
    defaultHint: "85 at 3 T; field-dependent",
  },
  bUseExternalQuantification: {
    label: "Use external quantification",
    description:
      "Request external quantification with BASIL, FABBER or VABY. When unset, ExploreASL can select external quantification from the data, including multi-PLD or multi-TE acquisitions.",
    default: false,
    defaultHint: "Data-dependent when unset",
  },
  ExternalQuantificationType: {
    label: "External quantification type",
    description:
      "The specific external quantification engine to run (e.g. BASIL, FABBER, or VABY).",
    default: "BASIL",
    defaultHint: "Data-dependent when unset",
  },
  ExternalQuantificationSmoothGaussianMM: {
    label: "External quantification smoothing (mm)",
    description:
      "Optional extra Gaussian smoothing of PWI input, with FWHM in millimeters. When unset, no extra smoothing is requested. ExploreASL rounds the width to voxel units.",
    default: [5, 5, 1],
    defaultHint: "No extra smoothing when unset",
  },
  bMaskingExternal: {
    label: "Mask external quantification",
    description:
      "Enable spatial brain masking during external quantification to limit calculations to brain tissue.",
    default: true,
    defaultHint: "true",
  },
  bSpatialBASIL: {
    label: "Spatial regularization (BASIL)",
    description:
      "Enable spatial regularization/smoothing in the BASIL model to improve signal coherence across neighboring voxels.",
    default: false,
    defaultHint: "false",
  },
  bInferT1BASIL: {
    label: "Infer T1 in BASIL",
    description:
      "Infer variable T1 values in BASIL for multi-PLD data. This option is ignored for single-PLD data and disabled in low-quality mode.",
    default: false,
    defaultHint: "false",
  },
  bInferATTBASIL: {
    label: "Infer ATT in BASIL (legacy, unsupported in audited checkout)",
    description:
      "Retained for saved-project compatibility. ExploreASL 2.0.0_BETA lists this legacy key but has no operative reader. It does not control ATT inference in that checkout and is not the distinct bInferArtBASIL arterial-component option.",
    default: true,
    defaultHint: "No operative default in audited checkout",
  },
  ExchBASIL: {
    label: "BASIL exchange model",
    description:
      "Specify the water exchange model between blood vessels and brain tissue (e.g. simple single-stage or multi-compartment model).",
    default: "simple",
    defaultHint: "Simple single-compartment model with T1 of blood",
  },
  DispBASIL: {
    label: "BASIL model of the label bolus dispersion",
    description:
      "Specify how the arterial bolus dispersion is modeled as it travels through the vasculature (e.g. none, Gaussian, or Gamma distribution).",
    default: "none",
    defaultHint: "None",
  },
  ATTSDBASIL: {
    label: "BASIL ATT prior standard deviation (s)",
    description:
      "Standard deviation of the arterial transit time prior in seconds, passed to BASIL as --batsd for multi-PLD data.",
    default: 1.0,
    defaultHint: "1.0",
  },
  bCleanUpExternal: {
    label: "Clean up external quantification",
    description:
      "Delete external quantification intermediates after processing. ExploreASL defaults to true when unset; the GUI switch initially displays false without writing it.",
    default: false,
    defaultHint: "true when unset; GUI initially off",
  },

  // === generalSettings ===
  Quality: {
    label: "Processing quality",
    description:
      "Specify processing quality level. Select 'Normal processing' for full-quality final analysis, or 'Fast try-out mode' for rapid testing with reduced resolution and iterations.",
    default: 1,
    defaultHint: "Normal processing",
  },
  DELETETEMP: {
    label: "Delete temporary files",
    description:
      "Automatically remove intermediate files and temporary data after processing is complete to save storage space.",
    default: 1,
    defaultHint: "1",
  },
  SkipIfNoFlair: {
    label: "Skip if no FLAIR",
    description:
      "Skip the structural module for a subject/session without a FLAIR image. This does not skip the ASL module.",
    default: 0,
    defaultHint: "0",
  },
  SkipIfNoASL: {
    label: "Skip if no ASL",
    description: "Skip the structural module for a subject/session without an ASL image.",
    default: 0,
    defaultHint: "0",
  },
  SkipIfNoM0: {
    label: "Skip if no M0",
    description:
      "Skip the structural module for a subject/session without an M0 calibration image.",
    default: 0,
    defaultHint: "0",
  },
  bLesionFilling: {
    label: "Lesion filling",
    description:
      "Fill white-matter lesions with surrounding normal tissue signal before structural segmentation. ExploreASL defaults to true when unset. The GUI switch initially displays false without writing it.",
    default: false,
    defaultHint: "true when unset; GUI initially off",
  },
  bAutoACPC: {
    label: "Auto AC-PC alignment",
    description:
      "Automatically orient and align anatomical images along the Anterior Commissure - Posterior Commissure (AC-PC) line.",
    default: true,
    defaultHint: "true",
  },
  enableMetadataGroupingCorrection: {
    label: "Enable Metadata-grouping difference correction",
    description:
      "Generate or modify participants.tsv (at derivatives/ExploreASL/participants.tsv) and participants.json before starting the pipeline. Columns participant_id, session, and site (whitespace replaced with underscores, mapped from your metadata groups and subject row assignments) will be ensured.",
    default: false,
    defaultHint: "false",
  },

  // === aslProcessing ===
  motionCorrection: {
    label: "Motion correction",
    description: "Enable head motion correction for the ASL timeseries using SPM realignment.",
    default: 1,
    defaultHint: "1",
  },
  bTopUp: {
    label: "FSL Topup distortion correction",
    description:
      "Request FSL TopUp distortion correction. When unset, ExploreASL enables it if reversed phase-encoding scans exist, except when merging ASL sessions. The GUI switch initially displays false without writing it.",
    default: false,
    defaultHint: "Automatic when unset",
  },
  bPVCNativeSpace: {
    label: "Native-space partial volume correction (PVC)",
    description:
      "Correct partial volume effects in native space. The GUI initially displays this switch on; unset values remain omitted, and ExploreASL defaults to off. Toggle explicitly to request a value.",
    default: 0,
    defaultHint: "0",
  },
  bPVCGaussianMM: {
    label: "PVC smoothing kernel shape",
    description: "Select the type of kernel used for partial volume correction.",
    default: 0,
    defaultHint: "0",
  },
  PVCNativeSpaceKernel: {
    label: "PVC native-space kernel",
    description:
      "Flat kernel dimensions are in voxels, default [5, 5, 1]. Gaussian kernel FWHM is in millimeters, default [10, 10, 4]. Unset kernel values let ExploreASL choose according to kernel shape.",
    default: [5, 5, 1],
    defaultHint: "5, 5, 1",
  },
  SaveCBF4D: {
    label: "Save 4D CBF",
    description:
      "Save individual cerebral blood flow (CBF) volumes sequentially as a 4D timeseries rather than just the averaged 3D map.",
    default: false,
    defaultHint: "false",
  },
  SpikeRemovalThreshold: {
    label: "Relative spike removal threshold",
    description:
      "Fractional t-statistic improvement threshold for ENABLE, not a Z-score. Default 0.01 means 1%. Used when no absolute motion threshold is provided; outlier exclusion is disabled for multi-PLD and multi-TE in the audited checkout.",
    default: 0.01,
    defaultHint: "0.01",
  },
  SpikeRemovalAbsoluteThreshold: {
    label: "Absolute motion threshold (mm)",
    description:
      "Motion threshold in millimeters, between 0 and 1. Providing this field selects fixed-threshold removal instead of ENABLE, even for explicit 0. Leave unset for the relative-threshold approach. This is not a signal-intensity threshold.",
    default: 0,
    defaultHint: "Unset: use relative threshold",
  },
  bRegistrationContrast: {
    label: "ASL-to-Structural registration contrast",
    description:
      "0: control to T1w. 1: CBF/PWI to pseudo-CBF. 2: combined control and CBF registration, with data-dependent CBF attempts. 3: combined registration with forced CBF attempts. Subtracted data and DCT options can alter the strategy.",
    default: 2,
    defaultHint: "Data-dependent when unset",
  },
  bAffineRegistration: {
    label: "Registration method",
    description:
      "Method to use for linear alignment between ASL and structural images (e.g. rigid-body, affine, or automatic based on perfusion variation).",
    default: 0,
    defaultHint: "Rigid-body",
  },
  bDCTRegistration: {
    label: "DCT registration",
    description:
      "Whether to use Discrete Cosine Transform (DCT) on top of affine registration to improve registration accuracy.",
    default: 0,
    defaultHint: "Disabled (no DCT)",
  },
  bUseMNIasDummyStructural: {
    label: "Use MNI as dummy structural",
    description:
      "Use a standard MNI template brain as a dummy structural placeholder for subjects that lack a high-resolution T1/structural scan.",
    default: 0,
    defaultHint: "0",
  },
  bHct2BloodT1: {
    label: "Blood T1 relaxation estimation method",
    description:
      'Blood T1 estimation: 0 disables hematocrit conversion; 1 uses "hematocrit" from participants.tsv; 2 estimates from "age" and "sex". When unset, ExploreASL can infer this choice from available participant data. It is not universally disabled by default.',
    default: 0,
    defaultHint: "Data-dependent when unset",
  },
  ApplyQuantification: {
    label: "Apply quantification steps",
    description:
      "Select which scaling, calibration, and division steps to execute during CBF quantification:\n• 1) Apply pixel intensity scaling to ASL timeseries\n• 2) Apply pixel intensity scaling to M0 image\n• 3) Convert perfusion-weighted signal to label volume\n• 4) Calibrate M0 intensity (correct T1 relaxation)\n• 5) Divide perfusion signal by M0\n• 6) Apply global scaling factors to final CBF map",
    default: [1, 1, 1, 1, 1, 1],
    defaultHint: "1, 1, 1, 1, 1, 1",
  },

  // === atlases ===
  Atlases: {
    label: "Brain atlases",
    description:
      "The anatomical brain atlases (e.g., automated anatomical labeling, vascular territories, or deep white matter masks) to use for regional/ROI cerebral blood flow analysis.",
    default: ["Total", "DeepWM"],
    defaultHint: "Total, DeepWM",
  },
  TissueMasking: {
    label: "Tissue masking",
    description:
      "Atlas ROI regions are typically imperfect in covering their tissues of interest. Therefore, ExploreASL employs an additional filter criteria where ROI values will be derived from the intersection of the atlas ROI and a tissue mask (GM, WM, CSF, or combined) defined by the tissue value(s) summing to the indicated threshold.",
    default: ["GM", "WM"],
    defaultHint: "GM, WM",
  },
  TissueThreshold: {
    label: "Tissue probability threshold",
    description:
      "Unitless tissue probability threshold from 0 to 1 for atlas ROI masking. The summed probabilities of selected tissues must exceed this value. For GM+WM at 0.7, this means above 70%, not a volume in mL.",
    default: [0.7, 0.7],
    defaultHint: "0.7, 0.7",
  },
  bMasking: {
    label: "Subject-specific ROI exclusion masks",
    description:
      "Select which subject-specific masks to apply to regional analyses: Susceptibility masking (removes artifacts/signal dropouts), Vascular masking (removes large blood vessels), Tissue-masking (limits ROIs to GM/WM/CSF tissue), or WholeBrain masking (reduces memory usage).",
    default: [1, 1, 1, 1],
    defaultHint: "1",
  },
  MinimalROIVolume: {
    label: "Minimal ROI volume",
    description:
      "The minimum volume (in milliliters) an anatomical region (ROI) must occupy in a subject to be included in regional analysis statistics.",
    default: 1,
    defaultHint: "1",
  },
  bWMH: {
    label: "Include existing WMH voxels in ROI masks",
    description:
      "Include voxels from existing white-matter hyperintensity maps in ROI masks. When false, these voxels are excluded. This does not enable WMH detection or segmentation.",
    default: false,
    defaultHint: "false",
  },
  DataTypes: {
    label: "Data types",
    description:
      "Existing statistical maps to include in population ROI analysis, such as qCBF. This selection does not generate quantification outputs.",
    default: ["qCBF"],
    defaultHint: "qCBF",
  },

  // === structural ===
  bRunLongReg: {
    label: "Multi-visit longitudinal registration",
    description:
      "Enable specialized longitudinal registration to register and track anatomical changes across multiple timepoints/scans per subject.",
    default: 0,
    defaultHint: "0",
  },
  bRunDARTEL: {
    label: "DARTEL high-dimensional MNI normalization",
    description:
      "Enable DARTEL (SPM's high-dimensional diffeomorphic registration) to align brains more accurately to standard MNI space.",
    default: 0,
    defaultHint: "0",
  },
  WMHsegmAlg: {
    label: "WMH segmentation algorithm",
    description:
      "The algorithm used for segmenting white-matter hyperintensities (e.g., LST LPA or LST LGA).",
    default: "LPA",
    defaultHint: "LPA",
  },
  bSegmentSPM12: {
    label: "SPM12 segmentation",
    description:
      "Enable standard SPM12 tissue segmentation to partition structural T1 images into grey matter, white matter, and CSF.",
    default: 0,
    defaultHint: "0",
  },
  bHammersCAT12: {
    label: "Hammers atlas via CAT12",
    description: "Use CAT12 to generate Hammers atlas parcellation.",
    default: 0,
    defaultHint: "0",
  },
  bFixResolution: {
    label: "Fix resolution",
    description:
      "Adjust T1w voxel dimensions coarser than about 1.5 mm for CAT12 segmentation. Finer voxel dimensions are retained; this is not resampling to 1 mm isotropic resolution.",
    default: false,
    defaultHint: "false",
  },

  // === environment ===
  bAutomaticallyDetectFSL: {
    label: "Auto-detect FSL",
    description:
      "Allow automatic FSL installation detection. When unset and no FSL directory is already available, ExploreASL defaults to automatic search. The GUI switch initially displays true without writing it.",
    default: false,
    defaultHint: "Automatic search when needed",
  },
  bAutomaticallyDetectVABY: {
    label: "Auto-detect VABY (unsupported in audited checkout)",
    description:
      "Retained for saved-project compatibility. ExploreASL 2.0.0_BETA reads this flag but does not implement automatic VABY discovery or use it to locate FABBER. Requested VABY quantification requires a configured x.external.VABYdir. The GUI switch initially displays true without writing it; this does not enable discovery in that checkout.",
    default: false,
    defaultHint: "Automatic discovery not implemented in audited checkout",
  },
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export const ATLAS_OPTIONS = {
  free: [
    "WholeBrain",
    "Total",
    "DeepWM",
    "Supratentorial_GM_WM",
    "AAL3v1",
    "MNI_Structural",
    "Tatu_ACA_MCA_PCA",
    "Mindboggle_OASIS_DKT31_CMA",
    "Schaefer_100Parcels_7Networks",
    "Schaefer_100Parcels_17Networks",
    "Desikan_Killiany_MNI_SPM12",
  ],
  commercial: ["HOcort_CONN", "HOsub_CONN", "Thalamus", "Hammers"],
};

export const ATLAS_DISPLAY_LABELS: Record<string, string> = {
  WholeBrain: "Whole Brain Combined Grey & White Matter",
  Total: "Whole Brain Grey and White Matter",
  DeepWM: "Deep White Matter",
  Supratentorial_GM_WM: "Supratentorial Grey & White Matter",
  AAL3v1: "Automated Anatomical Labeling (AAL) Atlas - Version 3",
  MNI_Structural: "MNI Structural Atlas",
  Tatu_ACA_MCA_PCA: "Vascular Territories by Tatu et al.",
  Mindboggle_OASIS_DKT31_CMA: "Mindboggle-101 Cortical Atlas",
  Schaefer_100Parcels_7Networks: "Schaefer's Atlas with 100 parcels and 7 networks",
  Schaefer_100Parcels_17Networks: "Schaefer's Atlas with 100 parcels and 17 networks",
  Desikan_Killiany_MNI_SPM12: "Desikan-Killiany Atlas",
  HOcort_CONN: "Harvard-Oxford Cortical Atlas",
  HOsub_CONN: "Harvard-Oxford Subcortical Atlas",
  Thalamus: "Harvard-Oxford Thalamic Atlas",
  Hammers: "Alexander Hammers's Brain Atlas",
};

export const M0_OPTIONS = [
  { value: "separate_scan", label: "Separate M0 scan" },
  { value: "UseControlAsM0", label: "Use control as M0" },
  { value: "Absent", label: "Absent — skip M0 processing" },
  { value: "__custom__", label: "Custom value" },
];

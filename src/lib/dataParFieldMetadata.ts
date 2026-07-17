// ---------------------------------------------------------------------------
// Data.par field metadata — drives conditional visibility, widgets, tiers
// ---------------------------------------------------------------------------

export type SectionId =
  | "m0"
  | "quantification"
  | "generalSettings"
  | "aslProcessing"
  | "atlases"
  | "structural"
  | "environment";

export type Tier = "basic" | "advanced";

export type WidgetType =
  "toggle" | "number" | "select" | "checkboxGroup" | "tags" | "numberTuple" | "selectWithCustom";

export interface FieldMeta {
  label: string;
  description: string;
  defaultHint: string;
  default?: unknown;
  section: SectionId;
  tier: Tier;
  widget: WidgetType;
  condition?: (state: Record<string, unknown>) => boolean;
}

// ---------------------------------------------------------------------------
// Condition helpers
// ---------------------------------------------------------------------------

const isUseControlAsM0WithPulses = (s: Record<string, unknown>): boolean =>
  s.M0 === "UseControlAsM0" && ((s.BackgroundSuppressionNumberPulses as number) ?? 0) > 0;

const isPVCEnabled = (s: Record<string, unknown>): boolean => s.bPVCNativeSpace === true;

const isExternalQuant = (s: Record<string, unknown>): boolean =>
  s.bUseExternalQuantification === true;

// ---------------------------------------------------------------------------
// FIELD_METADATA
// ---------------------------------------------------------------------------

export const FIELD_METADATA: Record<string, FieldMeta> = {
  // === m0 ===
  M0: {
    label: "M0 source",
    description:
      "Select the M0 (equilibrium magnetization) calibration strategy. Choose 'Separate M0 scan' if you acquired a dedicated calibration scan, 'Use control as M0' to estimate it from control images, or 'Absent' to skip M0 processing entirely.",
    default: "Absent",
    defaultHint: "Absent",
    section: "m0",
    tier: "basic",
    widget: "selectWithCustom",
  },
  BackgroundSuppressionNumberPulses: {
    label: "Background suppression pulses",
    description:
      "The number of background suppression pulses applied to reduce background tissue signal and improve contrast-to-noise ratio.",
    default: 0,
    defaultHint: "0",
    section: "m0",
    tier: "basic",
    widget: "number",
  },
  BackgroundSuppressionPulseTime: {
    label: "Background suppression pulse times",
    description:
      "The exact timing (in seconds or comma-separated list of seconds) of each background suppression pulse relative to the start of labeling.",
    defaultHint: "",
    section: "m0",
    tier: "basic",
    widget: "numberTuple",
    condition: isUseControlAsM0WithPulses,
  },
  M0_GMScaleFactor: {
    label: "M0 grey-matter scale factor",
    description:
      "A scaling factor applied to the M0 image to calibrate the signal in grey matter regions.",
    default: 1,
    defaultHint: "1",
    section: "m0",
    tier: "basic",
    widget: "number",
  },
  bRegisterM02ASL: {
    label: "Register M0 to ASL",
    description:
      "Align/register the M0 calibration scan to the ASL space before performing blood flow quantification to correct for head movement between scans.",
    default: 0,
    defaultHint: "false",
    section: "m0",
    tier: "basic",
    widget: "toggle",
  },
  M0_conventionalProcessing: {
    label: "Legacy / Conventional M0 calibration",
    description:
      "Enable legacy (conventional) processing of the M0 calibration scan instead of the newer standard pipeline.",
    default: 0,
    defaultHint: "false",
    section: "m0",
    tier: "advanced",
    widget: "toggle",
  },
  RepetitionTimePreparationM0: {
    label: "M0 repetition time (TR)",
    description:
      "The repetition time (TR) of the M0 preparation scan (in seconds), which is used to correct for T1 relaxation effects.",
    default: [],
    defaultHint: "",
    section: "m0",
    tier: "advanced",
    widget: "number",
  },

  // === quantification ===
  nCompartments: {
    label: "Tissue compartment kinetic model",
    description:
      "The number of physical/tissue compartments modeled in the kinetic quantification. Usually set to 1 (single-compartment model).",
    default: 1,
    defaultHint: "Single compartment model",
    section: "quantification",
    tier: "basic",
    widget: "select",
  },
  Lambda: {
    label: "Blood-brain partition coefficient (λ)",
    description:
      "The blood-brain partition coefficient (water solubility ratio between brain tissue and blood). Standard value is 0.9 mL/g.",
    default: 0.9,
    defaultHint: "0.9",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2art: {
    label: "T2 of arterial blood",
    description: "The transverse relaxation time (T2) of arterial blood in milliseconds.",
    default: 165,
    defaultHint: "165",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T1blood: {
    label: "T1 of arterial blood",
    description:
      "The longitudinal relaxation time (T1) of arterial blood in milliseconds. Typically 1650 ms at 3 Tesla.",
    default: 1650,
    defaultHint: "1650",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T1GM: {
    label: "T1 of grey matter",
    description:
      "The longitudinal relaxation time (T1) of grey matter tissue in milliseconds (typically 1240 ms).",
    default: 1240,
    defaultHint: "1240",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T1WM: {
    label: "T1 of white matter",
    description:
      "The longitudinal relaxation time (T1) of white matter tissue in milliseconds (typically 800 ms).",
    default: 800,
    defaultHint: "800",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2GM: {
    label: "T2 of grey matter",
    description:
      "The transverse relaxation time (T2) of grey matter tissue in milliseconds (typically 85 ms).",
    default: 85,
    defaultHint: "85",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2WM: {
    label: "T2 of white matter",
    description:
      "The transverse relaxation time (T2) of white matter tissue in milliseconds (typically 76 ms).",
    default: 76,
    defaultHint: "76",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2tissueMultiTE: {
    label: "T2 tissue (multi-TE)",
    description:
      "The transverse relaxation time (T2) of brain tissue in milliseconds, used specifically for multi-echo-time (multi-TE) ASL sequences.",
    default: 85,
    defaultHint: "85",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  bUseExternalQuantification: {
    label: "Use external quantification",
    description:
      "Enable external toolboxes (like FSL BASIL) for blood flow quantification instead of the built-in ExploreASL quantification model.",
    default: false,
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
  },
  ExternalQuantificationType: {
    label: "External quantification type",
    description:
      "The specific external quantification engine to run (e.g. BASIL, FABBER, or VABY).",
    default: "BASIL",
    defaultHint: "BASIL",
    section: "quantification",
    tier: "advanced",
    widget: "select",
    condition: isExternalQuant,
  },
  ExternalQuantificationSmoothGaussianMM: {
    label: "External quantification smoothing (mm)",
    description:
      "Apply Gaussian smoothing (Full Width at Half Maximum in millimeters) during the external quantification process.",
    default: [5, 5, 1],
    defaultHint: "5, 5, 1",
    section: "quantification",
    tier: "advanced",
    widget: "numberTuple",
    condition: isExternalQuant,
  },
  bMaskingExternal: {
    label: "Mask external quantification",
    description:
      "Enable spatial brain masking during external quantification to limit calculations to brain tissue.",
    default: true,
    defaultHint: "true",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  bSpatialBASIL: {
    label: "Spatial regularization (BASIL)",
    description:
      "Enable spatial regularization/smoothing in the BASIL model to improve signal coherence across neighboring voxels.",
    default: false,
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  bInferT1BASIL: {
    label: "Infer T1 in BASIL",
    description:
      "Allow the BASIL quantification model to dynamically estimate/infer the local T1 relaxation values rather than using a fixed assumption.",
    default: false,
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  bInferATTBASIL: {
    label: "Infer ATT in BASIL",
    description:
      "Allow the BASIL model to dynamically estimate/infer the arterial transit time (ATT / blood arrival time).",
    default: true,
    defaultHint: "true",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  ExchBASIL: {
    label: "BASIL exchange model",
    description:
      "Specify the water exchange model between blood vessels and brain tissue (e.g. simple single-stage or multi-compartment model).",
    default: "simple",
    defaultHint: "Simple single-compartment model with T1 of blood",
    section: "quantification",
    tier: "advanced",
    widget: "select",
    condition: isExternalQuant,
  },
  DispBASIL: {
    label: "BASIL model of the label bolus dispersion",
    description:
      "Specify how the arterial bolus dispersion is modeled as it travels through the vasculature (e.g. none, Gaussian, or Gamma distribution).",
    default: "none",
    defaultHint: "None",
    section: "quantification",
    tier: "advanced",
    widget: "select",
    condition: isExternalQuant,
  },
  ATTSDBASIL: {
    label: "BASIL ATT standard deviation",
    description:
      "The expected variation/standard deviation of the arterial transit time (ATT) prior assumption within BASIL.",
    default: 1.0,
    defaultHint: "1.0",
    section: "quantification",
    tier: "advanced",
    widget: "number",
    condition: isExternalQuant,
  },
  bCleanUpExternal: {
    label: "Clean up external quantification",
    description:
      "Delete temporary and intermediate calculation files generated by the external quantification engine once finished.",
    default: false,
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },

  // === generalSettings ===
  Quality: {
    label: "Processing quality",
    description:
      "Specify processing quality level. Select 'Normal processing' for full-quality final analysis, or 'Fast try-out mode' for rapid testing with reduced resolution and iterations.",
    default: 1,
    defaultHint: "Normal processing",
    section: "generalSettings",
    tier: "basic",
    widget: "select",
  },
  DELETETEMP: {
    label: "Delete temporary files",
    description:
      "Automatically remove intermediate files and temporary data after processing is complete to save storage space.",
    default: 1,
    defaultHint: "1",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  SkipIfNoFlair: {
    label: "Skip if no FLAIR",
    description: "Skip processing for any subjects/sessions that do not have a FLAIR image.",
    default: 0,
    defaultHint: "0",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  SkipIfNoASL: {
    label: "Skip if no ASL",
    description: "Skip processing for any subjects/sessions that do not have an ASL image.",
    default: 0,
    defaultHint: "0",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  SkipIfNoM0: {
    label: "Skip if no M0",
    description:
      "Skip processing for any subjects/sessions that do not have an M0 calibration image.",
    default: 0,
    defaultHint: "0",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  bLesionFilling: {
    label: "Lesion filling",
    description:
      "Fill white-matter lesions with surrounding normal tissue signal before structural segmentation, reducing tissue segmentation errors.",
    default: false,
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  bAutoACPC: {
    label: "Auto AC-PC alignment",
    description:
      "Automatically orient and align anatomical images along the Anterior Commissure - Posterior Commissure (AC-PC) line.",
    default: true,
    defaultHint: "true",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  enableMetadataGroupingCorrection: {
    label: "Enable Metadata-grouping difference correction",
    description:
      "Generate or modify participants.tsv (at derivatives/ExploreASL/participants.tsv) and participants.json before starting the pipeline. Columns participant_id, session, and site (whitespace replaced with underscores, mapped from your metadata groups and subject row assignments) will be ensured.",
    default: false,
    defaultHint: "false",
    section: "generalSettings",
    tier: "basic",
    widget: "toggle",
  },

  // === aslProcessing ===
  motionCorrection: {
    label: "Motion correction",
    description: "Enable head motion correction for the ASL timeseries using SPM realignment.",
    default: 1,
    defaultHint: "1",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  bTopUp: {
    label: "FSL Topup distortion correction",
    description:
      "Enable FSL TopUp distortion correction if a calibration scan with reversed phase encoding direction is available.",
    default: false,
    defaultHint: "false",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  bPVCNativeSpace: {
    label: "Native-space partial volume correction (PVC)",
    description:
      "Correct for partial volume effects (mixing of grey matter, white matter, and CSF within a voxel) in native space before standardizing the images.",
    default: 0,
    defaultHint: "0",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  bPVCGaussianMM: {
    label: "PVC smoothing kernel shape",
    description: "Select the type of kernel used for partial volume correction.",
    default: 0,
    defaultHint: "0",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
    condition: isPVCEnabled,
  },
  PVCNativeSpaceKernel: {
    label: "PVC native-space kernel",
    description:
      "Define the dimensions (Left-Right [LR], Anterior-Posterior [AP], Inferior-Superior [IS]) of the local kernel used for native-space partial volume correction.",
    default: [5, 5, 1],
    defaultHint: "5, 5, 1",
    section: "aslProcessing",
    tier: "advanced",
    widget: "numberTuple",
    condition: isPVCEnabled,
  },
  SaveCBF4D: {
    label: "Save 4D CBF",
    description:
      "Save individual cerebral blood flow (CBF) volumes sequentially as a 4D timeseries rather than just the averaged 3D map.",
    default: false,
    defaultHint: "false",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  SpikeRemovalThreshold: {
    label: "Spike removal threshold",
    description:
      "The statistical threshold (Z-score) used to detect and filter out sudden signal spikes (e.g. due to motion or scanner instability) in the ASL timeseries.",
    default: 0.01,
    defaultHint: "0.01",
    section: "aslProcessing",
    tier: "advanced",
    widget: "number",
  },
  SpikeRemovalAbsoluteThreshold: {
    label: "Absolute spike removal threshold",
    description:
      "The absolute signal value threshold above which any timeseries volume is classified as a spike and removed.",
    default: 0,
    defaultHint: "0",
    section: "aslProcessing",
    tier: "advanced",
    widget: "number",
  },
  bRegistrationContrast: {
    label: "ASL-to-Structural registration contrast",
    description:
      "Select the image contrast type for aligning the ASL scans to structural anatomical scans.",
    default: 2,
    defaultHint: "Automatic based on spatial CoV of PWI",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  bAffineRegistration: {
    label: "Registration method",
    description:
      "Method to use for linear alignment between ASL and structural images (e.g. rigid-body, affine, or automatic based on perfusion variation).",
    default: 0,
    defaultHint: "Rigid-body",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  bDCTRegistration: {
    label: "DCT registration",
    description:
      "Whether to use Discrete Cosine Transform (DCT) on top of affine registration to improve registration accuracy.",
    default: 0,
    defaultHint: "Disabled (affine only)",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  bUseMNIasDummyStructural: {
    label: "Use MNI as dummy structural",
    description:
      "Use a standard MNI template brain as a dummy structural placeholder for subjects that lack a high-resolution T1/structural scan.",
    default: 0,
    defaultHint: "0",
    section: "aslProcessing",
    tier: "advanced",
    widget: "toggle",
  },
  bHct2BloodT1: {
    label: "Blood T1 relaxation estimation method",
    description:
      'Configure hematocrit estimation and its influence on blood T1:\n• Default: Disable hematocrit estimation and any subsequent influence on blood T1.\n• Provided Hct: To use provided hematocrit data per subject present as the column "hematocrit" (case-sensitive) in participants.tsv and subsequently calculate the influence on blood T1.\n• Age & Sex: To derive hematocrit data using age and sex information from "age" and "sex" (values "male" or "female" within) columns (case-sensitive) in participants.tsv, and subsequently calculate the influence on blood T1.',
    default: 0,
    defaultHint: "Disabled (use fixed blood T1)",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  ApplyQuantification: {
    label: "Apply quantification steps",
    description:
      "Select which scaling, calibration, and division steps to execute during CBF quantification:\n• 1) Apply pixel intensity scaling to ASL timeseries\n• 2) Apply pixel intensity scaling to M0 image\n• 3) Convert perfusion-weighted signal to label volume\n• 4) Calibrate M0 intensity (correct T1 relaxation)\n• 5) Divide perfusion signal by M0\n• 6) Apply global scaling factors to final CBF map",
    default: [1, 1, 1, 1, 1, 1],
    defaultHint: "1, 1, 1, 1, 1, 1",
    section: "aslProcessing",
    tier: "advanced",
    widget: "checkboxGroup",
  },

  // === atlases ===
  Atlases: {
    label: "Brain atlases",
    description:
      "The anatomical brain atlases (e.g., automated anatomical labeling, vascular territories, or deep white matter masks) to use for regional/ROI cerebral blood flow analysis.",
    default: ["Total", "DeepWM"],
    defaultHint: "Total, DeepWM",
    section: "atlases",
    tier: "basic",
    widget: "select",
  },
  TissueMasking: {
    label: "Tissue masking",
    description:
      "Atlas ROI regions are typically imperfect in covering their tissues of interest. Therefore, ExploreASL employs an additional filter criteria where ROI values will be derived from the intersection of the atlas ROI and a tissue mask (GM, WM, CSF, or combined) defined by the tissue value(s) summing to the indicated threshold.",
    default: ["GM", "WM"],
    defaultHint: "GM, WM",
    section: "atlases",
    tier: "advanced",
    widget: "select",
  },
  TissueThreshold: {
    label: "Tissue probability threshold",
    description:
      "Minimum tissue probability threshold (0.0 to 1.0) for atlas ROI masking. Voxels are included if the summed probabilities of the specified tissue type(s) meet or exceed this value (e.g., selecting GM+WM with 0.7 means all voxels where the summed probabilities of grey or white matter add up to 70% or more are considered).",
    default: [0.7, 0.7],
    defaultHint: "0.7, 0.7",
    section: "atlases",
    tier: "advanced",
    widget: "number",
  },
  bMasking: {
    label: "Subject-specific ROI exclusion masks",
    description:
      "Select which subject-specific masks to apply to regional analyses: Susceptibility masking (removes artifacts/signal dropouts), Vascular masking (removes large blood vessels), Tissue-masking (limits ROIs to GM/WM/CSF tissue), or WholeBrain masking (reduces memory usage).",
    default: [1, 1, 1, 1],
    defaultHint: "1",
    section: "atlases",
    tier: "advanced",
    widget: "checkboxGroup",
  },
  MinimalROIVolume: {
    label: "Minimal ROI volume",
    description:
      "The minimum volume (in milliliters) an anatomical region (ROI) must occupy in a subject to be included in regional analysis statistics.",
    default: 1,
    defaultHint: "1",
    section: "atlases",
    tier: "advanced",
    widget: "number",
  },
  bWMH: {
    label: "WMH lesion detection & regional analysis",
    description:
      "Enable automated detection, segmentation, and regional analysis of white-matter hyperintensities (lesions).",
    default: false,
    defaultHint: "false",
    section: "atlases",
    tier: "advanced",
    widget: "toggle",
  },
  DataTypes: {
    label: "Data types",
    description:
      "The statistical maps and output metric types to generate from quantification (e.g. quantitative CBF, arterial transit time, etc.).",
    default: ["qCBF"],
    defaultHint: "qCBF",
    section: "atlases",
    tier: "advanced",
    widget: "tags",
  },

  // === structural ===
  bRunLongReg: {
    label: "Multi-visit longitudinal registration",
    description:
      "Enable specialized longitudinal registration to register and track anatomical changes across multiple timepoints/scans per subject.",
    default: 0,
    defaultHint: "0",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  bRunDARTEL: {
    label: "DARTEL high-dimensional MNI normalization",
    description:
      "Enable DARTEL (SPM's high-dimensional diffeomorphic registration) to align brains more accurately to standard MNI space.",
    default: 0,
    defaultHint: "0",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  WMHsegmAlg: {
    label: "WMH segmentation algorithm",
    description:
      "The algorithm used for segmenting white-matter hyperintensities (e.g., LST LPA or LST LGA).",
    default: "LPA",
    defaultHint: "LPA",
    section: "structural",
    tier: "advanced",
    widget: "select",
  },
  bSegmentSPM12: {
    label: "SPM12 segmentation",
    description:
      "Enable standard SPM12 tissue segmentation to partition structural T1 images into grey matter, white matter, and CSF.",
    default: 0,
    defaultHint: "0",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  bHammersCAT12: {
    label: "Hammers atlas via CAT12",
    description: "Use CAT12 to generate Hammers atlas parcellation.",
    default: 0,
    defaultHint: "0",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  bFixResolution: {
    label: "Fix resolution",
    description:
      "Automatically resample high-resolution structural scans to a standard 1mm isotropic resolution if they deviate.",
    default: false,
    defaultHint: "false",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },

  // === environment ===
  bAutomaticallyDetectFSL: {
    label: "Auto-detect FSL",
    description:
      "Allow the processing pipeline to automatically locate the FSL (FMRIB Software Library) installation path on your system.",
    default: false,
    defaultHint: "false",
    section: "environment",
    tier: "advanced",
    widget: "toggle",
  },
  bAutomaticallyDetectVABY: {
    label: "Auto-detect Vaby",
    description:
      "Allow the processing pipeline to automatically locate the Vaby/FABBER installation path on your system.",
    default: false,
    defaultHint: "false",
    section: "environment",
    tier: "advanced",
    widget: "toggle",
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

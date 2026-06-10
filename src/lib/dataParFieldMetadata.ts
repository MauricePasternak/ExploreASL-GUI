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
  | "toggle"
  | "number"
  | "select"
  | "checkboxGroup"
  | "tags"
  | "numberTuple"
  | "selectWithCustom";

export interface FieldMeta {
  label: string;
  description: string;
  defaultHint: string;
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

const isPVCEnabled = (s: Record<string, unknown>): boolean =>
  s.bPVCNativeSpace === true;

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
      "M0 handling strategy. separate_scan: use a separate M0 scan. UseControlAsM0: use control image as M0. Absent: skip M0 processing.",
    defaultHint: "Absent",
    section: "m0",
    tier: "basic",
    widget: "selectWithCustom",
  },
  BackgroundSuppressionNumberPulses: {
    label: "Background suppression pulses",
    description:
      "Number of background suppression inversion pulses applied before readout.",
    defaultHint: "0",
    section: "m0",
    tier: "basic",
    widget: "number",
  },
  BackgroundSuppressionPulseTime: {
    label: "Background suppression pulse times",
    description:
      "Timing (s) of each background suppression pulse relative to labeling start.",
    defaultHint: "",
    section: "m0",
    tier: "basic",
    widget: "numberTuple",
    condition: isUseControlAsM0WithPulses,
  },
  M0_GMScaleFactor: {
    label: "M0 grey-matter scale factor",
    description:
      "Scaling factor applied to the M0 image based on grey-matter segmentation.",
    defaultHint: "1",
    section: "m0",
    tier: "basic",
    widget: "number",
  },
  bRegisterM02ASL: {
    label: "Register M0 to ASL",
    description: "Register the M0 scan to the ASL space before quantification.",
    defaultHint: "true",
    section: "m0",
    tier: "basic",
    widget: "toggle",
  },
  M0_conventionalProcessing: {
    label: "Conventional M0 processing",
    description:
      "Use conventional (legacy) M0 processing instead of the default pipeline.",
    defaultHint: "false",
    section: "m0",
    tier: "advanced",
    widget: "toggle",
  },
  RepetitionTimePreparationM0: {
    label: "TR of M0 preparation",
    description:
      "Repetition time (s) of the M0 preparation scan. Used for T1 relaxation correction.",
    defaultHint: "",
    section: "m0",
    tier: "advanced",
    widget: "number",
  },

  // === quantification ===
  nCompartments: {
    label: "Number of compartments",
    description:
      "Number of tissue compartments for kinetic model quantification.",
    defaultHint: "1",
    section: "quantification",
    tier: "basic",
    widget: "select",
  },
  Lambda: {
    label: "Blood-brain partition coefficient",
    description: "Blood-brain partition coefficient. Default: 0.9 mL/g.",
    defaultHint: "0.9",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2art: {
    label: "T2 of arterial blood",
    description: "T2 relaxation time (ms) of arterial blood.",
    defaultHint: "50",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T1blood: {
    label: "T1 of arterial blood",
    description: "T1 relaxation time (ms) of arterial blood. @3T: 1650",
    defaultHint: "1650",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T1GM: {
    label: "T1 of grey matter",
    description: "T1 relaxation time (ms) of grey matter.",
    defaultHint: "1240",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T1WM: {
    label: "T1 of white matter",
    description: "T1 relaxation time (ms) of white matter.",
    defaultHint: "800",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2GM: {
    label: "T2 of grey matter",
    description: "T2 relaxation time (ms) of grey matter.",
    defaultHint: "85",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2WM: {
    label: "T2 of white matter",
    description: "T2 relaxation time (ms) of white matter.",
    defaultHint: "76",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  T2tissueMultiTE: {
    label: "T2 tissue (multi-TE)",
    description: "T2 tissue value (ms) for multi-TE ASL sequences.",
    defaultHint: "85",
    section: "quantification",
    tier: "advanced",
    widget: "number",
  },
  bUseExternalQuantification: {
    label: "Use external quantification",
    description: "Enable an external quantification method instead of the built-in model.",
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
  },
  ExternalQuantificationType: {
    label: "External quantification type",
    description: "Select the external quantification method to use.",
    defaultHint: "BASIL",
    section: "quantification",
    tier: "advanced",
    widget: "select",
    condition: isExternalQuant,
  },
  ExternalQuantificationSmoothGaussianMM: {
    label: "External quantification smoothing (mm)",
    description:
      "Gaussian smoothing kernel (mm FWHM) applied during external quantification.",
    defaultHint: "",
    section: "quantification",
    tier: "advanced",
    widget: "numberTuple",
    condition: isExternalQuant,
  },
  bMaskingExternal: {
    label: "Mask external quantification",
    description: "Apply brain masking during external quantification.",
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  bSpatialBASIL: {
    label: "Spatial BASIL",
    description: "Enable spatial regularization in BASIL quantification.",
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  bInferT1BASIL: {
    label: "Infer T1 in BASIL",
    description: "Infer T1 relaxation values within the BASIL model.",
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  bInferATTBASIL: {
    label: "Infer ATT in BASIL",
    description: "Infer arterial transit time within the BASIL model.",
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },
  ExchBASIL: {
    label: "BASIL exchange model",
    description: "Water exchange model used in BASIL quantification.",
    defaultHint: "simple",
    section: "quantification",
    tier: "advanced",
    widget: "select",
    condition: isExternalQuant,
  },
  DispBASIL: {
    label: "BASIL dispersion model",
    description: "Arterial dispersion model used in BASIL quantification.",
    defaultHint: "none",
    section: "quantification",
    tier: "advanced",
    widget: "select",
    condition: isExternalQuant,
  },
  ATTSDBASIL: {
    label: "BASIL ATT standard deviation",
    description: "Standard deviation of arterial transit time prior in BASIL.",
    defaultHint: "1.0",
    section: "quantification",
    tier: "advanced",
    widget: "number",
    condition: isExternalQuant,
  },
  bCleanUpExternal: {
    label: "Clean up external quantification",
    description: "Remove intermediate files after external quantification.",
    defaultHint: "false",
    section: "quantification",
    tier: "advanced",
    widget: "toggle",
    condition: isExternalQuant,
  },

  // === generalSettings ===
  Quality: {
    label: "Processing quality",
    description: "1 = Normal processing, 0 = Fast try-out mode.",
    defaultHint: "1",
    section: "generalSettings",
    tier: "basic",
    widget: "select",
  },
  DELETETEMP: {
    label: "Delete temporary files",
    description: "Delete intermediate/temporary files after processing.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  SkipIfNoFlair: {
    label: "Skip if no FLAIR",
    description: "Skip subject if FLAIR image is missing.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  SkipIfNoASL: {
    label: "Skip if no ASL",
    description: "Skip subject if ASL image is missing.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  SkipIfNoM0: {
    label: "Skip if no M0",
    description: "Skip subject if M0 image is missing.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  stopAfterErrors: {
    label: "Stop after errors",
    description: "Stop the pipeline after encountering errors.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  bLesionFilling: {
    label: "Lesion filling",
    description: "Perform white-matter lesion filling before processing.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },
  bAutoACPC: {
    label: "Auto AC-PC alignment",
    description: "Automatically align images to AC-PC orientation.",
    defaultHint: "false",
    section: "generalSettings",
    tier: "advanced",
    widget: "toggle",
  },

  // === aslProcessing ===
  motionCorrection: {
    label: "Motion correction",
    description: "Enable ASL motion correction using SPM.",
    defaultHint: "true",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  bTopUp: {
    label: "FSL TopUp",
    description:
      "True to explicitly turn ON or OFF the FSL TopUp option if the M0 scan with reversed phase encoding direction is present.",
    defaultHint: "true",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  bPVCNativeSpace: {
    label: "Partial volume correction (native)",
    description:
      "Perform partial volume correction in native space before registration to standard space.",
    defaultHint: "true",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  bPVCGaussianMM: {
    label: "PVC Gaussian kernel (mm)",
    description: "Gaussian smoothing kernel size (mm) for partial volume correction.",
    defaultHint: "false",
    section: "aslProcessing",
    tier: "advanced",
    widget: "number",
    condition: isPVCEnabled,
  },
  PVCNativeSpaceKernel: {
    label: "PVC native-space kernel",
    description: "Kernel dimensions [x, y, z] for native-space PVC.",
    defaultHint: "5, 5, 1",
    section: "aslProcessing",
    tier: "advanced",
    widget: "numberTuple",
    condition: isPVCEnabled,
  },
  SaveCBF4D: {
    label: "Save 4D CBF",
    description: "Save individual CBF volumes as a 4D timeseries.",
    defaultHint: "false",
    section: "aslProcessing",
    tier: "basic",
    widget: "toggle",
  },
  SpikeRemovalThreshold: {
    label: "Spike removal threshold",
    description: "Z-score threshold for spike removal in ASL timeseries.",
    defaultHint: "",
    section: "aslProcessing",
    tier: "advanced",
    widget: "number",
  },
  SpikeRemovalAbsoluteThreshold: {
    label: "Absolute spike removal threshold",
    description: "Absolute value threshold for spike removal.",
    defaultHint: "",
    section: "aslProcessing",
    tier: "advanced",
    widget: "number",
  },
  bRegistrationContrast: {
    label: "Registration contrast",
    description:
      "Select which image contrast to use for ASL-to-structural registration.",
    defaultHint: "2",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  bAffineRegistration: {
    label: "Affine registration",
    description: "Enable affine registration step.",
    defaultHint: "0",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  bDCTRegistration: {
    label: "DCT registration",
    description: "Enable discrete cosine transform (non-linear) registration.",
    defaultHint: "0",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  bUseMNIasDummyStructural: {
    label: "Use MNI as dummy structural",
    description:
      "Use the MNI template as a placeholder when no structural image is available.",
    defaultHint: "false",
    section: "aslProcessing",
    tier: "advanced",
    widget: "toggle",
  },
  bHct2BloodT1: {
    label: "Hct to blood T1 conversion",
    description:
      "Method for converting hematocrit to blood T1 relaxation time.",
    defaultHint: "0",
    section: "aslProcessing",
    tier: "advanced",
    widget: "select",
  },
  ApplyQuantification: {
    label: "Apply quantification",
    description:
      "Select which quantification methods to apply (e.g., single-compartment, multi-compartment).",
    defaultHint: "",
    section: "aslProcessing",
    tier: "advanced",
    widget: "checkboxGroup",
  },

  // === atlases ===
  Atlases: {
    label: "Brain atlases",
    description: "Brain atlases for ROI analysis. Default: Total, DeepWM.",
    defaultHint: "Total, DeepWM",
    section: "atlases",
    tier: "basic",
    widget: "select",
  },
  TissueMasking: {
    label: "Tissue masking",
    description: "Tissue type(s) used for masking during atlas-based analysis.",
    defaultHint: "",
    section: "atlases",
    tier: "advanced",
    widget: "select",
  },
  TissueThreshold: {
    label: "Tissue probability threshold",
    description: "Minimum tissue probability to include a voxel in the mask.",
    defaultHint: "",
    section: "atlases",
    tier: "advanced",
    widget: "number",
  },
  bMasking: {
    label: "ROI masking",
    description:
      "Vector specifying if we should mask a ROI with a subject-specific mask (1 = yes, 0 = no): [1 0 0 0] = susceptibility mask, [0 1 0 0] = vascular mask, [0 0 1 0] = subject-specific tissue-masking (e.g. pGM>0.5), [0 0 0 1] = WholeBrain masking (memory compression). Can also be used as boolean: 1 = [1 1 1 1], 0 = [0 0 0 0].",
    defaultHint: "1",
    section: "atlases",
    tier: "advanced",
    widget: "checkboxGroup",
  },
  MinimalROIVolume: {
    label: "Minimal ROI volume",
    description: "Minimum volume (mm³) for an ROI to be included in analysis.",
    defaultHint: "",
    section: "atlases",
    tier: "advanced",
    widget: "number",
  },
  bWMH: {
    label: "White-matter hyperintensity analysis",
    description: "Enable white-matter hyperintensity detection and analysis.",
    defaultHint: "false",
    section: "atlases",
    tier: "advanced",
    widget: "toggle",
  },
  DataTypes: {
    label: "Data types",
    description: "Output data types to generate (e.g., CBF, ATT).",
    defaultHint: "",
    section: "atlases",
    tier: "advanced",
    widget: "tags",
  },

  // === structural ===
  bRunLongReg: {
    label: "Longitudinal registration",
    description: "Run longitudinal registration for multi-timepoint studies.",
    defaultHint: "false",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  bRunDARTEL: {
    label: "DARTEL registration",
    description: "Run DARTEL for improved inter-subject registration.",
    defaultHint: "false",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  WMHsegmAlg: {
    label: "WMH segmentation algorithm",
    description: "Algorithm for white-matter hyperintensity segmentation.",
    defaultHint: "LPA",
    section: "structural",
    tier: "advanced",
    widget: "select",
  },
  bSegmentSPM12: {
    label: "SPM12 segmentation",
    description: "Run SPM12 tissue segmentation on structural images.",
    defaultHint: "false",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  bHammersCAT12: {
    label: "Hammers atlas via CAT12",
    description: "Use CAT12 to generate Hammers atlas parcellation.",
    defaultHint: "false",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },
  bFixResolution: {
    label: "Fix resolution",
    description: "Resample images to a uniform voxel resolution.",
    defaultHint: "false",
    section: "structural",
    tier: "advanced",
    widget: "toggle",
  },

  // === environment ===
  bAutomaticallyDetectFSL: {
    label: "Auto-detect FSL",
    description: "Automatically detect FSL installation.",
    defaultHint: "true",
    section: "environment",
    tier: "advanced",
    widget: "toggle",
  },
  bAutomaticallyDetectVABY: {
    label: "Auto-detect Vaby",
    description: "Automatically detect Vaby installation.",
    defaultHint: "true",
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
  commercial: [
    "HOcort_CONN",
    "HOsub_CONN",
    "Thalamus",
    "Hammers",
  ],
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

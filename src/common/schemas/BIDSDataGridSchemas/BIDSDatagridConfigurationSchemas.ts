import {
  BIDSBooleanFieldNamesType,
  BIDSBooleanSchemaType,
  BIDSEnumFieldNamesType,
  BIDSEnumSchemaType,
  BIDSFieldNamesType,
  BIDSNumericalFieldNamesType,
  BIDSNumericalSchemaType,
  BIDSTextFieldNamesType,
  BIDSTextSchemaType,
} from "../../types/BIDSDatagridTypes";

export const BIDSEnumSchema: BIDSEnumSchemaType = {
  ArterialSpinLabelingType: {
    type: "Enum",
    colName: "ASL Labeling Strategy",
    enumOptions: [
      { label: "CASL", value: "CASL" },
      { label: "PCASL", value: "PCASL" },
      { label: "PASL", value: "PASL" },
    ],
    defaultValue: "PCASL",
  },
  Manufacturer: {
    type: "Enum",
    colName: "Manufacturer",
    enumOptions: [
      { label: "General Electric", value: "GE" },
      { label: "Siemens", value: "Siemens" },
      { label: "Philips", value: "Philips" },
    ],
    defaultValue: "SIEMENS",
  },
  M0Type: {
    type: "Enum",
    colName: "M0 Scan Type",
    enumOptions: [
      { label: "Separate m0scan.nii", value: "Separate" },
      { label: "Inside asl.nii", value: "Included" },
      { label: "Single Value Estimate", value: "Estimate" },
      { label: "Use mean Control ASL as substitute", value: "Absent" },
    ],
    defaultValue: "Separate",
  },
  MRAcquisitionType: {
    type: "Enum",
    colName: "MRI Readout Dimensionality",
    enumOptions: [
      { label: "2D", value: "2D" },
      { label: "3D", value: "3D" },
    ],
    defaultValue: "3D",
  },
  CASLType: {
    type: "Enum",
    colName: "CASL Type",
    enumOptions: [
      { label: "Single Coil", value: "single-coil" },
      { label: "Double Coil", value: "double-coil" },
    ],
    defaultValue: "single-coil",
  },
  PCASLType: {
    type: "Enum",
    colName: "PCASL Type",
    enumOptions: [
      { label: "Balanced", value: "balanced" },
      { label: "Unbalanced", value: "unbalanced" },
    ],
    defaultValue: "balanced",
  },
  PASLType: {
    type: "Enum",
    colName: "PASL Type",
    enumOptions: [
      { label: "FAIR", value: "FAIR" },
      { label: "EPISTAR", value: "EPISTAR" },
      { label: "PICORE", value: "PICORE" },
    ],
    defaultValue: "FAIR",
  },
  PhaseEncodingDirection: {
    type: "Enum",
    colName: "Phase Encoding Direction",
    enumOptions: [
      { label: "First Axis", value: "i" },
      { label: "Second Axis", value: "j" },
      { label: "Third Axis", value: "k" },
      { label: "First Axis in Reverse", value: "i-" },
      { label: "Second Axis in Reverse", value: "j-" },
      { label: "Third Axis in Reverse", value: "k-" },
    ],
    defaultValue: "k",
  },
  SliceEncodingDirection: {
    type: "Enum",
    colName: "Slice Encoding Direction",
    enumOptions: [
      { label: "First Axis", value: "i" },
      { label: "Second Axis", value: "j" },
      { label: "Third Axis", value: "k" },
      { label: "First Axis in Reverse", value: "i-" },
      { label: "Second Axis in Reverse", value: "j-" },
      { label: "Third Axis in Reverse", value: "k-" },
    ],
    defaultValue: "k",
  },
  BolusCutOffTechnique: {
    type: "Enum",
    colName: "Bolus Cut-Off Technique",
    enumOptions: [
      { label: "Q2TIPS", value: "Q2TIPS" },
      { label: "QUIPSS", value: "QUIPSS" },
      { label: "QUIPSSII", value: "QUIPSSII" },
    ],
    defaultValue: "Q2TIPS",
  },
};

export const BIDSNumericalSchema: BIDSNumericalSchemaType = {
  EchoTime: {
    type: "Numerical",
    colName: "Echo Time (TE)",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    defaultValue: 0.01,
  },
  RepetitionTimePreparation: {
    type: "Numerical",
    colName: "Repetition Time (TR)",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    defaultValue: 4.5,
  },
  FlipAngle: {
    type: "Numerical",
    colName: "Flip Angle",
    unit: "degree",
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 90,
  },
  MagneticFieldStrength: {
    type: "Numerical",
    colName: "Magnetic Field Strength",
    unit: "T",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    defaultValue: 3,
  },
  PostLabelingDelay: {
    type: "Numerical",
    colName: "Post-Labeling Delay",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    defaultValue: 1.8,
  },
  LabelingDuration: {
    type: "Numerical",
    colName: "Labeling Duration",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    defaultValue: 0.8,
  },
  M0_GMScaleFactor: {
    type: "Numerical",
    colName: "M0 Gray Matter Scale Factor",
    unit: "a.u.",
    min: 0.000001,
    max: 10000000,
    step: 0.000001,
    defaultValue: 1,
  },
  M0Estimate: {
    type: "Numerical",
    colName: "M0 Single Value Estimate",
    unit: "a.u.",
    min: 0.0001,
    max: 10000000,
    step: 0.0001,
    defaultValue: 1,
  },
};

export const BIDSBooleanSchema: BIDSBooleanSchemaType = {
  BackgroundSuppression: {
    type: "Boolean",
    colName: "Background Suppression",
    defaultValue: true,
  },
  BolusCutOffFlag: {
    type: "Boolean",
    colName: "ASL Bolus Cut-off Technique Was Used",
    defaultValue: true,
  },
  SkullStripped: {
    type: "Boolean",
    colName: "Skull Stripped?",
    defaultValue: false,
  },
  VascularCrushing: {
    type: "Boolean",
    colName: "Vascular Crushing Was Used?",
    defaultValue: false,
  },
};

export const BIDSTextSchema: BIDSTextSchemaType = {
  AttenuationCorrection: {
    type: "Text",
    colName: "Attenuation Correction Description",
    defaultValue: "",
  },
  BodyPart: {
    type: "Text",
    colName: "Body Part Scanned Description",
    defaultValue: "Brain",
  },
};

export const BIDSEnumSet = new Set(Object.keys(BIDSEnumSchema)) as Set<BIDSEnumFieldNamesType>;
export const BIDSNumericalSet = new Set(Object.keys(BIDSNumericalSchema)) as Set<BIDSNumericalFieldNamesType>;
export const BIDSBooleanSet = new Set(Object.keys(BIDSBooleanSchema)) as Set<BIDSBooleanFieldNamesType>;
export const BIDSTextSet = new Set(Object.keys(BIDSTextSchema)) as Set<BIDSTextFieldNamesType>;

/**
 * @description These are the names of BIDS fields (i.e. PASLType, PhaseEncodingDirection, etc.) that this program
 * supports and will render as columns.
 *
 * These **DO NOT** include "ID", "File", and "Baseline"
 */
export const BIDSFieldNames = [
  ...Object.keys(BIDSEnumSchema),
  ...Object.keys(BIDSNumericalSchema),
  ...Object.keys(BIDSBooleanSchema),
  ...Object.keys(BIDSTextSchema),
] as BIDSFieldNamesType[];

export const BIDSCompleteSchema = {
  ...BIDSEnumSchema,
  ...BIDSNumericalSchema,
  ...BIDSBooleanSchema,
  ...BIDSTextSchema,
};

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
} from "../types/BIDSDatagridTypes";

export const BIDSEnumSchema: BIDSEnumSchemaType = {
  ArterialSpinLabelingType: {
    type: "Enum",
    colName: "ASL Labeling Strategy",
    enumOptions: [
      { label: "CASL", value: "CASL" },
      { label: "PCASL", value: "PCASL" },
      { label: "PASL", value: "PASL" },
    ],
    mapValue: "PCASL",
  },
  Manufacturer: {
    type: "Enum",
    colName: "Manufacturer",
    enumOptions: [
      { label: "General Electric", value: "GE" },
      { label: "Siemens", value: "Siemens" },
      { label: "Philips", value: "Philips" },
    ],
    mapValue: "SIEMENS",
  },
  M0Type: {
    type: "Enum",
    colName: "M0 Type",
    enumOptions: [
      { label: "Separate m0scan.nii", value: "Separate" },
      { label: "Inside asl.nii", value: "Included" },
      { label: "Single Value Estimate", value: "Estimate" },
      { label: "Use mean Control ASL as substitute", value: "Absent" },
    ],
    mapValue: "Separate",
  },
  MRAcquisitionType: {
    type: "Enum",
    colName: "MRI Readout Dimensionality",
    enumOptions: [
      { label: "2D", value: "2D" },
      { label: "3D", value: "3D" },
    ],
    mapValue: "3D",
  },
  CASLType: {
    type: "Enum",
    colName: "CASL Type",
    enumOptions: [
      { label: "Single Coil", value: "single-coil" },
      { label: "Double Coil", value: "double-coil" },
    ],
    mapValue: "single-coil",
  },
  PCASLType: {
    type: "Enum",
    colName: "PCASL Type",
    enumOptions: [
      { label: "Balanced", value: "balanced" },
      { label: "Unbalanced", value: "unbalanced" },
    ],
    mapValue: "balanced",
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
    mapValue: "k",
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
    mapValue: "k",
  },
  BolusCutOffTechnique: {
    type: "Enum",
    colName: "Bolus Cut-Off Technique",
    enumOptions: [
      { label: "Q2TIPS", value: "Q2TIPS" },
      { label: "QUIPSS", value: "QUIPSS" },
      { label: "QUIPSSII", value: "QUIPSSII" },
    ],
    mapValue: "Q2TIPS",
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
    mapValue: 0.01,
  },
  RepetitionTime: {
    type: "Numerical",
    colName: "Repetition Time (TR)",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    mapValue: 4.5,
  },
  FlipAngle: {
    type: "Numerical",
    colName: "Flip Angle",
    unit: "degree",
    min: 0,
    max: 360,
    step: 1,
    mapValue: 90,
  },
  MagneticFieldStrength: {
    type: "Numerical",
    colName: "Magnetic Field Strength",
    unit: "T",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    mapValue: 3,
  },
  PostLabelingDelay: {
    type: "Numerical",
    colName: "Post-Labeling Delay",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    mapValue: 1.8,
  },
  LabelingDuration: {
    type: "Numerical",
    colName: "Labeling Duration",
    unit: "s",
    min: 0.0001,
    max: 1000,
    step: 0.0001,
    mapValue: 0.8,
  },

  M0_GMScaleFactor: {
    type: "Numerical",
    colName: "M0 GM Scale Factor",
    unit: "a.u.",
    min: 0.0001,
    max: 10000000,
    step: 0.0001,
    mapValue: 1,
  },
  M0Estimate: {
    type: "Numerical",
    colName: "M0 Single Value Estimate",
    unit: "a.u.",
    min: 0.0001,
    max: 10000000,
    step: 0.0001,
    mapValue: 1,
  },
};

export const BIDSBooleanSchema: BIDSBooleanSchemaType = {
  BackgroundSuppression: {
    type: "Boolean",
    colName: "Background Suppression",
    mapValue: true,
  },
  BolusCutOffFlag: {
    type: "Boolean",
    colName: "ASL Bolus Cut-off Technique Was Used?",
    mapValue: true,
  },
  SkullStripped: {
    type: "Boolean",
    colName: "Skull Stripped?",
    mapValue: false,
  },
  VascularCrushing: {
    type: "Boolean",
    colName: "Vascular Crushing Was Used?",
    mapValue: false,
  },
};

export const BIDSTextSchema: BIDSTextSchemaType = {
  AttenuationCorrection: {
    type: "Text",
    colName: "Attenuation Correction Description",
    mapValue: "",
  },
  BodyPart: {
    type: "Text",
    colName: "Body Part Scanned Description",
    mapValue: "Brain",
  },
};

export const BIDSEnumSet = new Set(Object.keys(BIDSEnumSchema)) as Set<BIDSEnumFieldNamesType>;
export const BIDSNumericalSet = new Set(Object.keys(BIDSNumericalSchema)) as Set<BIDSNumericalFieldNamesType>;
export const BIDSBooleanSet = new Set(Object.keys(BIDSBooleanSchema)) as Set<BIDSBooleanFieldNamesType>;
export const BIDSTextSet = new Set(Object.keys(BIDSTextSchema)) as Set<BIDSTextFieldNamesType>;

export const BIDSNames = [
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

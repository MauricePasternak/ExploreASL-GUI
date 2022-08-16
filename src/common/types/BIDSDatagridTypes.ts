export type BIDSEnumFieldNamesType =
  | "ArterialSpinLabelingType"
  | "Manufacturer"
  | "M0Type"
  | "MRAcquisitionType"
  | "CASLType"
  | "PCASLType"
  | "PhaseEncodingDirection"
  | "SliceEncodingDirection"
  | "BolusCutOffTechnique";

export type BIDSEnumConfig = {
  type: "Enum";
  colName: string;
  enumOptions: Array<{ label: string; value: string }>;
  mapValue: unknown;
};

export type BIDSEnumSchemaType = Record<BIDSEnumFieldNamesType, BIDSEnumConfig>;

export type BIDSNumericalFieldNamesType =
  | "RepetitionTime"
  | "EchoTime"
  | "FlipAngle"
  | "MagneticFieldStrength"
  | "PostLabelingDelay"
  | "LabelingDuration"
  | "M0_GMScaleFactor"
  | "M0Estimate";

export type BIDSNumericalConfig = {
  type: "Numerical";
  colName: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  mapValue: number;
};

export type BIDSNumericalSchemaType = Record<BIDSNumericalFieldNamesType, BIDSNumericalConfig>;

export type BIDSBooleanFieldNamesType =
  | "BackgroundSuppression"
  | "BolusCutOffFlag"
  | "SkullStripped"
  | "VascularCrushing";

export type BIDSBooleanConfig = {
  type: "Boolean";
  colName: string;
  mapValue: boolean;
};

export type BIDSBooleanSchemaType = Record<BIDSBooleanFieldNamesType, BIDSBooleanConfig>;

export type BIDSTextFieldNamesType = "AttenuationCorrection" | "BodyPart";

export type BIDSTextConfig = {
  type: "Text";
  colName: string;
  mapValue: string;
};

export type BIDSTextSchemaType = Record<BIDSTextFieldNamesType, BIDSTextConfig>;

export type BIDSFieldNamesType =
  | BIDSEnumFieldNamesType
  | BIDSNumericalFieldNamesType
  | BIDSBooleanFieldNamesType
  | BIDSTextFieldNamesType;

export type BIDSSchemaType = BIDSEnumSchemaType & BIDSNumericalSchemaType & BIDSBooleanSchemaType & BIDSTextSchemaType;

export type BIDSSchemaValueType<TKey extends keyof BIDSSchemaType> = {
  [K in keyof BIDSSchemaType]: BIDSSchemaType[K];
}[TKey];

export type BIDSRow = {
  [K in keyof BIDSSchemaType]: BIDSSchemaType[K]["type"] extends "Enum"
    ? "string"
    : BIDSSchemaType[K]["type"] extends "Numerical"
    ? number
    : BIDSSchemaType[K]["type"] extends "Boolean"
    ? boolean
    : string;
} & {
  ID: number;
  File: string;
};

export type BIDSTypes = BIDSSchemaType[keyof BIDSSchemaType]["type"];

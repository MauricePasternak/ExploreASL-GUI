export type BIDSEnumFieldNamesType =
  | "ArterialSpinLabelingType"
  | "Manufacturer"
  | "M0Type"
  | "MRAcquisitionType"
  | "CASLType"
  | "PCASLType"
  | "PASLType"
  | "PhaseEncodingDirection"
  | "SliceEncodingDirection"
  | "BolusCutOffTechnique";

export type BIDSEnumConfig = {
  type: "Enum";
  colName: string;
  enumOptions: Array<{ label: string; value: string | null }>;
  defaultValue: unknown;
};

export type BIDSEnumSchemaType = Record<BIDSEnumFieldNamesType, BIDSEnumConfig>;

export type BIDSNumericalFieldNamesType =
  | "RepetitionTimePreparation"
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
  defaultValue: number;
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
  defaultValue: boolean;
};

export type BIDSBooleanSchemaType = Record<BIDSBooleanFieldNamesType, BIDSBooleanConfig>;

export type BIDSTextFieldNamesType = "AttenuationCorrection" | "BodyPart";

export type BIDSTextConfig = {
  type: "Text";
  colName: string;
  defaultValue: string;
};

export type BIDSTextSchemaType = Record<BIDSTextFieldNamesType, BIDSTextConfig>;

/**
 * BIDS-specific field name (i.e. PCASLType). This is NOT the prettified field name/description.
 */
export type BIDSFieldNamesType =
  | BIDSEnumFieldNamesType
  | BIDSNumericalFieldNamesType
  | BIDSBooleanFieldNamesType
  | BIDSTextFieldNamesType;

/**
 * Names that correspond to the `keys` of RDG `Column`s in the BIDS datagrid. These are used to add/remove columns.
 * Most of these are BIDS-specific field names (i.e. PCASLType), but include the frozen column keys ID, File, and
 * Filename
 */
export type BIDSColumnName = BIDSFieldNamesType | "ID" | "File" | "Filename";

export type BIDSSchemaType = BIDSEnumSchemaType & BIDSNumericalSchemaType & BIDSBooleanSchemaType & BIDSTextSchemaType;

export type BIDSSchemaValueType<TKey extends keyof BIDSSchemaType> = {
  [K in keyof BIDSSchemaType]: BIDSSchemaType[K];
}[TKey];

/**
 * Mapping of all the possible BIDS fields to the value type they map to (i.e. string, number, etc.)
 */
export type BIDSRow = {
  [K in keyof BIDSSchemaType]: BIDSSchemaType[K]["type"] extends "Enum"
    ? unknown
    : BIDSSchemaType[K]["type"] extends "Numerical"
    ? number
    : BIDSSchemaType[K]["type"] extends "Boolean"
    ? boolean
    : string;
} & {
  ID: number;
  File: string;
  Filename: string;
};

export type BIDSTypes = BIDSSchemaType[keyof BIDSSchemaType]["type"];

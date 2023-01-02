import { GridValidRowModel } from "@mui/x-data-grid";
import { BIDSBooleanFields, BIDSBooleanFieldsNameType, isBIDSBooleanField } from "./BIDSBooleanColDefs";
import { BIDSEnumFields, BIDSEnumFieldsNameType, isBIDSEnumField } from "./BIDSEnumColDefs";
import { isMiscField, MiscFields, MiscFieldsNameType } from "./BIDSMiscColDefs";
import {
	BIDSNumericArrayFields,
	BIDSNumericArrayFieldsNameType,
	isBIDSNumericArrayField,
} from "./BIDSNumericArrayColDefs";
import { BIDSNumericFields, BIDSNumericFieldsNameType, isBIDSNumericField } from "./BIDSNumericColDefs";
import { BIDSTextFields, BIDSTextFieldsNameType, isBIDSTextField } from "./BIDSTextColDefs";

// ^ Field Names
export type BIDSAllNonMiscFieldsNameType =
	| BIDSNumericFieldsNameType
	| BIDSNumericArrayFieldsNameType
	| BIDSTextFieldsNameType
	| BIDSEnumFieldsNameType
	| BIDSBooleanFieldsNameType;
export type BIDSAllFieldsNameType = MiscFieldsNameType | BIDSAllNonMiscFieldsNameType;

export const BIDSAllNonMiscFieldsSet = new Set([
	...BIDSNumericFields,
	...BIDSNumericArrayFields,
	...BIDSTextFields,
	...BIDSEnumFields,
	...BIDSBooleanFields,
]);
export const BIDSAllFieldsSet = new Set([
	...MiscFields,
	...BIDSNumericFields,
	...BIDSNumericArrayFields,
	...BIDSTextFields,
	...BIDSEnumFields,
	...BIDSBooleanFields,
]);

// ^ Type Guards
export function isBIDSNonMiscField(fieldName: string): fieldName is BIDSAllNonMiscFieldsNameType {
	return BIDSAllNonMiscFieldsSet.has(fieldName as BIDSAllNonMiscFieldsNameType);
}
export function isBIDSField(fieldName: string): fieldName is BIDSAllFieldsNameType {
	return (
		isMiscField(fieldName) ||
		isBIDSNumericField(fieldName) ||
		isBIDSNumericArrayField(fieldName) ||
		isBIDSTextField(fieldName) ||
		isBIDSEnumField(fieldName) ||
		isBIDSBooleanField(fieldName)
	);
}

// ^ BIDSRowSchema
type BIDSValidRowModel = GridValidRowModel & Partial<Record<BIDSAllFieldsNameType, unknown>>;
export interface BIDSRow extends BIDSValidRowModel {
	// Misc Fields
	ID: number;
	Filepath: string;
	Filename: string;
	// Numeric Fields
	BackgroundSuppressionNumberPulses?: number;
	BolusCutOffDelayTime?: number | number[];
	EchoTime?: number;
	FlipAngle?: number;
	InversionTime?: number;
	MagneticFieldStrength?: number;
	M0Estimate?: number;
	M0_GMScaleFactor?: number;
	RepetitionTimePreparation?: number;
	TotalAcquiredPairs?: number;
	TotalReadoutTime?: number;
	// Numeric Array Fields
	BackgroundSuppressionPulseTime?: number[];
	PostLabelingDelay?: number | number[];
	LabelingDuration?: number | number[];
	SliceTiming?: number | number[];
	// Text Fields
	PulseSequenceDetails?: string;
	ReceiveCoilName?: string;
	ScanningSequence?: string;
	SequenceName?: string;
	SequenceVariant?: string;
	SoftwareVersions?: string;
	// Enum Fields
	ArterialSpinLabelingType?: "CASL" | "PCASL" | "PASL";
	BolusCutOffTechnique?: "QUIPSS" | "QUIPSSII" | "Q2TIPS";
	CASLType?: "single-coil" | "double-coil";
	Manufacturer?: "Siemens" | "Philips" | "GE";
	M0Type?: "Separate" | "Included" | "Estimate" | "Absent";
	MRAcquisitionType?: "2D" | "3D";
	PASLType?: "FAIR" | "EPISTAR" | "PICORE";
	PCASLType?: "balanced" | "unbalanced";
	PulseSequenceType?: "3D_spiral" | "2D_EPI" | "3D_GRASE";
	PhaseEncodingDirection?: "i" | "j" | "k" | "i-" | "j-" | "k-";
	SliceEncodingDirection?: "i" | "j" | "k" | "i-" | "j-" | "k-";
	// Boolean Fields
	BackgroundSuppression?: boolean;
	BolusCutOffFlag?: boolean;
	SkullStripped?: boolean;
}

// ^ FieldNameToDisplayName
export const BIDSFieldNameToDisplayName: Record<BIDSAllFieldsNameType, string> = {
	// Misc Fields
	ID: "ID",
	Filepath: "Filepath",
	Filename: "Filename",
	// Numeric Fields
	BackgroundSuppressionNumberPulses: "Background Suppression Number Pulses",
	BolusCutOffDelayTime: "Bolus Cut Off Delay Time (s)",
	EchoTime: "Echo Time (s)",
	FlipAngle: "Flip Angle (deg)",
	InversionTime: "Inversion Time (s)",
	MagneticFieldStrength: "Magnetic Field Strength (T)",
	M0Estimate: "M0 Estimate (a.u.)",
	M0_GMScaleFactor: "M0 GM Scale Factor (a.u.)",
	RepetitionTimePreparation: "Repetition Time Preparation (s)",
	TotalAcquiredPairs: "Total Acquired Pairs",
	TotalReadoutTime: "Total Readout Time (s)",
	// Numeric Array Fields
	BackgroundSuppressionPulseTime: "Background Suppression Pulse Timings (s)",
	PostLabelingDelay: "Post Labeling Delay (s)",
	LabelingDuration: "Labeling Duration (s)",
	SliceTiming: "Slice Timing (s)",
	// Text Fields
	PulseSequenceDetails: "Pulse Sequence Details",
	ReceiveCoilName: "Receive Coil Name",
	ScanningSequence: "Scanning Sequence",
	SequenceName: "Sequence Name",
	SequenceVariant: "Sequence Variant",
	SoftwareVersions: "Software Versions",
	// Enum Fields
	ArterialSpinLabelingType: "Arterial Spin Labeling Type",
	BolusCutOffTechnique: "Bolus Cut Off Technique",
	CASLType: "CASL Type",
	Manufacturer: "Manufacturer",
	M0Type: "M0 Type",
	MRAcquisitionType: "MR Acquisition Type",
	PASLType: "PASL Type",
	PCASLType: "PCASL Type",
	PulseSequenceType: "Pulse Sequence Type",
	PhaseEncodingDirection: "Phase Encoding Direction",
	SliceEncodingDirection: "Slice Encoding Direction",
	// Boolean Fields
	BackgroundSuppression: "Background Suppression",
	BolusCutOffFlag: "Bolus Cut Off Flag",
	SkullStripped: "Skull Stripped",
};

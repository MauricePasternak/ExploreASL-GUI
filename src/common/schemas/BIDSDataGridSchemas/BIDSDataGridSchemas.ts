import * as Yup from "yup";
import { ObjectShape } from "yup/lib/object";
import {
	BIDSBooleanFieldsNameType,
	BIDSEnumFieldsNameType,
	BIDSNumericFieldsNameType,
	BIDSTextFieldsNameType,
} from "../../../pages/BIDSDataGrid/BIDSColumnDefs";

type ObjectShapeValues = ObjectShape extends Record<string, infer V> ? V : never;
export type YupShape<T extends Record<any, any>> = Partial<Record<keyof T, ObjectShapeValues>>;

//^ BOOLEAN FIELDS
const BIDSSchema__BackgroundSuppression = Yup.boolean().when("BackgroundSupppressionNumberPulses", {
	is: (val: number) => !!val && val > 0,
	then: Yup.boolean()
		.required("BackgroundSuppression ")
		.isTrue("BackgroundSuppression must be true if BackgroundSupppressionNumberPulses is greater than 0"),
	otherwise: Yup.boolean().optional(),
});
const BIDSSchema__BolusCutOffFlag = Yup.boolean().when("BolusCutOffTechnique", {
	is: (val: string) => !!val && ["QUIPSS", "QUIPSSII", "Q2TIPS"].includes(val),
	then: Yup.boolean()
		.required()
		.isTrue("BolusCutOffFlag must be true if BolusCutOffTechnique is QUIPSS, QUIPSSII, or Q2TIPS"),
	otherwise: Yup.boolean().optional(),
});
const BIDSSchema__SkullStripped = Yup.boolean().optional();

const BIDSBooleanFieldsSchema = Yup.object().shape<YupShape<Record<BIDSBooleanFieldsNameType, boolean>>>({
	BackgroundSuppression: BIDSSchema__BackgroundSuppression,
	BolusCutOffFlag: BIDSSchema__BolusCutOffFlag,
	SkullStripped: BIDSSchema__SkullStripped,
});

//^ TEXT FIELDS
const BIDSSchema__PulseSequenceDetails = Yup.string()
	.optional()
	.typeError("PulseSequenceDetails must be a text string");
const BIDSSchema__ReceiveCoilName = Yup.string().optional().typeError("ReceiveCoilName must be a text string");
const BIDSSchema__SequenceName = Yup.string().optional().typeError("SequenceName must be a text string");
const BIDSSchema__SequenceVariant = Yup.string().optional().typeError("SequenceVariant must be a text string");
const BIDSSchema__ScanningSequence = Yup.string().optional().typeError("ScanningSequence must be a text string");
const BIDSSchema__SoftwareVersions = Yup.string().optional().typeError("SoftwareVersions must be a text string");

export const BIDSTextFieldsSchema = Yup.object().shape<YupShape<Record<BIDSTextFieldsNameType, string>>>({
	PulseSequenceDetails: BIDSSchema__PulseSequenceDetails,
	ReceiveCoilName: BIDSSchema__ReceiveCoilName,
	ScanningSequence: BIDSSchema__ScanningSequence,
	SequenceName: BIDSSchema__SequenceName,
	SequenceVariant: BIDSSchema__SequenceVariant,
	SoftwareVersions: BIDSSchema__SoftwareVersions,
});

//^ NUMERIC FIELDS

export const BIDSNumericFieldsSchema = Yup.object().shape<
	YupShape<Record<BIDSNumericFieldsNameType, number | number[]>>
>({
	BackgroundSuppressionNumberPulses: Yup.number().when("BackgroundSuppression", {
		is: (val: boolean) => val && val === true,
		then: (schema) =>
			schema
				.required(
					"Detected a row where the Background Suppression was indicated to be true," +
						" but the number of background suppression pulses was blank"
				)
				.typeError("BackgroundSuppressionNumberPulses must be a number")
				.min(
					1,
					"The number of background suppression pulses must be greater than 0 if Background Suppression is true." +
						" Change either one or the other to fulfill BIDS requirements."
				),
		otherwise: (schema) => schema.optional().typeError("BackgroundSuppressionNumberPulses must be a number"),
	}),
	BolusCutOffDelayTime: Yup.mixed().when("BolusCutOffTechnique", {
		is: (val: string) => !!val && ["QUIPSS", "QUIPSSII", "Q2TIPS"].includes(val),
		then: (schema) =>
			schema
				.required()
				.test(
					"BolusCutOffDelayTime",
					"BolusCutOffDelayTime must be a number",
					(val: number | number[] | undefined, helpers) => {
						if (helpers.parent?.BolusCutOffTechnique === "Q2TIPS" && !Array.isArray(val)) {
							return helpers.createError({
								message: "BolusCutOffDelayTime must be an array of numbers if BolusCutOffTechnique is Q2TIPS",
							});
						}

						if (helpers.parent?.BolusCutOffTechnique !== "Q2TIPS" && Array.isArray(val)) {
							return helpers.createError({
								message: "BolusCutOffDelayTime must be a number if BolusCutOffTechnique is not Q2TIPS",
							});
						}

						return true;
					}
				),
		otherwise: (schema) => schema.optional(),
	}),
	EchoTime: Yup.number().optional().typeError("EchoTime must be a number"),
	FlipAngle: Yup.number().optional().typeError("FlipAngle must be a number"),
	InversionTime: Yup.number().optional().typeError("InversionTime must be a number"),
	RepetitionTimePreparation: Yup.number().optional().typeError("RepetitionTime must be a number"),
	LabelingDuration: Yup.number().optional().typeError("LabelingDuration must be a number"),
	MagneticFieldStrength: Yup.number()
		.optional()
		.typeError("MagneticFieldStrength must be a number")
		.max(50, "MagneticFieldStrength must be less than 50"),
	M0Estimate: Yup.number().when("M0Type", {
		is: (val: string) => !!val && val === "Estimate",
		then: (schema) => schema.required().typeError("M0Estimate must be a number"),
		otherwise: (schema) => schema.optional().typeError("M0Estimate must be a number"),
	}),
	M0_GMScaleFactor: Yup.number().optional().typeError("M0_GMScaleFactor must be a number"),
	PostLabelingDelay: Yup.number().optional().typeError("PostLabelingDelay must be a number"),
	TotalAcquiredPairs: Yup.number().optional().typeError("TotalAcquiredPairs must be a number"),
	TotalReadoutTime: Yup.number().optional().typeError("TotalReadoutTime must be a number"),
});

//^ ENUM FIELDS
export const BIDSEnumFieldsSchema = Yup.object().shape<YupShape<Record<BIDSEnumFieldsNameType, string>>>({
	ArterialSpinLabelingType: Yup.string().optional().oneOf(["CASL", "PCASL", "PASL"]),
	BolusCutOffTechnique: Yup.string().optional().oneOf(["QUIPSS", "QUIPSSII", "Q2TIPS"]),
	CASLType: Yup.string().optional().oneOf(["single-coil", "double-coil"]),
	Manufacturer: Yup.string().optional().oneOf(["Siemens", "GE", "Philips"]),
	M0Type: Yup.string().optional().oneOf(["Separate", "Included", "Absent", "Estimate"]),
	MRAcquisitionType: Yup.string().optional().oneOf(["2D", "3D"]),
	PASLType: Yup.string().optional().oneOf(["FAIR", "PICORE", "EPISTAR"]),
	PCASLType: Yup.string().optional().oneOf(["balanced", "unbalanced"]),
	PulseSequenceType: Yup.string().optional().oneOf(["2D_EPI", "3D_GRASE", "3D_spiral"]),
	PhaseEncodingDirection: Yup.string().optional().oneOf(["i", "i-", "j", "j-", "k", "k-"]),
	SliceEncodingDirection: Yup.string().optional().oneOf(["i", "i-", "j", "j-", "k", "k-"]),
});

export const BIDSRowSchema = BIDSBooleanFieldsSchema.concat(BIDSTextFieldsSchema)
	.concat(BIDSNumericFieldsSchema)
	.concat(BIDSEnumFieldsSchema);

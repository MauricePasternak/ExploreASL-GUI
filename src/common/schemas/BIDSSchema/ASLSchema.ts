import { isNumber as lodashIsNumber, isUndefined as lodashIsUndefined } from "lodash";
import { yupCreateError } from "../../utils/formFunctions";
import * as Yup from "yup";

/** Minimal schema to ensure ASLType is an **optional** string enum */
export const SchemaMin_ArterialSpinLabelingType = Yup.string()
	.typeError(`Arterial Spin Labeling Type must be one of the following: "PCASL", "CASL", "PASL`)
	.oneOf(["PCASL", "CASL", "PASL"], `Arterial Spin Labeling Type must be one of the following: "PCASL", "CASL", "PASL`);

/** Expanded ASLType schema to include its required status */
export const Schema_ArterialSpinLabelingType = SchemaMin_ArterialSpinLabelingType.required(
	"Arterial Spin Labeling Type is a required field"
);

/** Minimal schema to ensure PLD is an **optional** positive number */
export const SchemaMin_PostLabelingDelay = Yup.mixed()
	.optional()
	.test(
		"PostLabelingDelay__Lenient",
		"Post Labeling Delay must be either a positive number or a collection of positive numbers",
		(postLabelingDelay: unknown, context: Yup.TestContext) => {
			if (lodashIsUndefined(postLabelingDelay) || lodashIsNumber(postLabelingDelay)) return true;
			if (Array.isArray(postLabelingDelay) && postLabelingDelay.every((value) => lodashIsNumber(value))) return true;
			return false;
		}
	);

/** Expanded PLD schema to include its required status */
export const Schema_PostLabelingDelay = SchemaMin_PostLabelingDelay.required(
	"Post Labeling Delay is a required field"
).test(
	"PostLabelingDelay__Strict",
	"Post Labeling Delay must be either a single positive number of a collection of positive numbers",
	(postLabelingDelay: unknown, context: Yup.TestContext) => {
		if (lodashIsNumber(postLabelingDelay)) {
			if (postLabelingDelay <= 0) {
				return yupCreateError(
					context,
					"Post Labeling Delay cannot be a non-positive number. It must be either a single positive number of a collection of such numbers (typically, separated by commas)"
				);
			}
			return true; // Single positive number; early exit
		}

		if (!Array.isArray(postLabelingDelay))
			return yupCreateError(
				context,
				"Post Labeling Delay must be either a single positive number of a collection of such numbers (typically, separated by commas)"
			);

		if (postLabelingDelay.length === 0)
			return yupCreateError(context, "Post Labeling Delay is a required field and cannot be empty");

		if (!postLabelingDelay.every((value) => lodashIsNumber(value) && value > 0))
			return yupCreateError(context, "One or more of the Post Labeling Delay values is not a positive number");

		return true;
	}
);

export const SchemaMin_SliceTiming = Yup.mixed().test(
	"SliceTiming__Lenient",
	"Slice Timing must be either a single positive number or a collection of such",
	(sliceTiming: unknown, context: Yup.TestContext) => {
		if (lodashIsUndefined(sliceTiming) || lodashIsNumber(sliceTiming)) return true;
		if (Array.isArray(sliceTiming) && sliceTiming.every((value) => lodashIsNumber(value))) return true;
		return false;
	}
);

export const Schema_SliceTiming = Yup.mixed().when("MRAcquisitionType", {
	is: "2D",
	then: (schema) =>
		schema
			.required("Slice Timing is a required field for 2D ASL acquisitions")
			.test(
				"SliceTiming__Strict__2D",
				"Slice Timing must be either a single positive number or a collection of such",
				(sliceTiming: unknown, context: Yup.TestContext) => {
					if (lodashIsNumber(sliceTiming)) {
						if (sliceTiming <= 0) {
							return yupCreateError(
								context,
								"Slice Timing cannot be a single negative number. Provide either a single positive number or a collection of incrementing non-negative numbers (separated by commas)"
							);
						}
						return true; // Single positive number; early exit
					}

					if (!Array.isArray(sliceTiming) || sliceTiming.length === 0) return false;
					if (!sliceTiming.every((value) => lodashIsNumber(value) && value >= 0))
						return yupCreateError(context, "One or more of the Slice Timing values is not a positive number");
					return true;
				}
			),
	otherwise: (schema) =>
		schema.test(
			"SliceTiming__Strict__Not2D",
			"Slice Timing should not be provided for 3D ASL acquisitions",
			(sliceTiming: unknown, context: Yup.TestContext) => lodashIsUndefined(sliceTiming)
		),
});

/** Schema to ensure LabelingDistance is an **optional** positive number */
export const Schema_LabelingDistance = Yup.number()
	.optional()
	.typeError("Labeling Distance is optional, but must be a number if provided")
	.positive("Labeling Distance must be a positive number");

/** Schema to ensure VascularCrushing is an **optional** boolean */
export const Schema_VascularCrushing = Yup.boolean()
	.optional()
	.typeError("Vascular Crushing must be true or false, if provided");

/** Schema to ensure TotalAcquiredPairs is an **optional** positive number */
export const Schema_TotalAcquiredPairs = Yup.number()
	.positive("Total Acquired Pairs must be a positive number")
	.optional()
	.typeError("Total Acquired Pairs must be a number, if provided");

/** Schema to ensure TotalReadoutTime is an **optional** positive number */
export const Schema_TotalReadoutTime = Yup.number()
	.positive("Total Readout Time must be a positive number")
	.optional()
	.typeError("Total Readout Time must be a number, if provided");

/** Minimal schema to ensure PCASLType is an **optional** enum */
export const SchemaMin_PCASLType = Yup.string()
	.optional()
	.oneOf(["gradient", "balanced"], `If provided, PCASL Type must be one of the following: "Gradient", "Balanced'"`)
	.typeError(`PCASL Type, if present, must be one of the following: "Gradient", "Balanced"`);

/** Expanded schema to ensure PCASLType is also sensitive to ASLType field */
export const Schema_PCASLType = SchemaMin_PCASLType.when("ArterialSpinLabelingType", {
	is: "PCASL",
	then: (schema) => schema,
	otherwise: (schema) =>
		schema.test(
			"PCASLType__NotPCASL",
			"PCASL Type should not be provided for non-PCASL ASL acquisitions",
			(caslType: unknown, context: Yup.TestContext) => {
				// Because this is a conditional schema, we know ASLType is not PCASL
				const ASLType = context.parent.ArterialSpinLabelingType;
				if (lodashIsUndefined(caslType)) return true;

				if (lodashIsUndefined(ASLType)) {
					return yupCreateError(
						context,
						`PCASL Type cannot be provided without first indicating the "Arterial Spin Labeling Type"`
					);
				} else {
					return yupCreateError(context, `PCASL Type should not be provided for non-PCASL ASL acquisitions`);
				}
			}
		),
});

/** Minimal schema to ensure CASLType is an **optional** enum */
export const SchemaMin_CASLType = Yup.string()
	.oneOf(
		["single-coil", "double-coil"],
		`If provided, CASL Type must be one of the following: "Single Coil", "Double Coil"`
	)
	.optional()
	.typeError(`CASL Type, if present, must be one of the following: "Single Coil", "Double Coil"`);

/** Expanded schema to ensure CASLType is also sensitive to ASLType field */
export const Schema_CASLType = SchemaMin_CASLType.when("ArterialSpinLabelingType", {
	is: "CASL",
	then: (schema) => schema,
	otherwise: (schema) =>
		schema.test(
			"CASLType__NotCASL",
			"CASL Type should not be provided for non-CASL ASL acquisitions",
			(caslType: unknown, context: Yup.TestContext) => {
				// Because this is a conditional schema, we know ASLType is not CASL
				const ASLType = context.parent.ArterialSpinLabelingType;
				if (lodashIsUndefined(caslType)) return true;

				if (lodashIsUndefined(ASLType)) {
					return yupCreateError(
						context,
						`CASL Type cannot be provided without first indicating the "Arterial Spin Labeling Type"`
					);
				} else {
					return yupCreateError(context, `CASL Type should not be provided for non-CASL ASL acquisitions`);
				}
			}
		),
});

/** Minimal schema to ensure Labeling Duration is an **optional** positive number */
export const SchemaMin_LabelingDuration = Yup.mixed()
	.optional()
	.test((labelingDuration: unknown, context: Yup.TestContext) => {
		if (lodashIsUndefined(labelingDuration) || typeof labelingDuration === "number") return true;
		if (Array.isArray(labelingDuration) && labelingDuration.every((v) => lodashIsNumber(v) && v >= 0)) return true;
		return yupCreateError(context, "Labeling Duration must be a number or an array of non-negative numbers");
	});

/**
 * Expanded schema to ensure Labeling Duration is a conditionally **optional** positive number or array of positive
 * numbers, depending on the value of ArterialSpinLabelingType
 */
export const Schema_LabelingDuration = Yup.mixed()
	.transform((value) => {
		return value === 0 ? undefined : value;
	})
	.when("ArterialSpinLabelingType", {
		is: "PASL",
		then: (schema) =>
			schema
				.optional()
				.test(
					"LabelingDuration",
					"Labeling Duration should not be present when Arterial Spin Labeling Type is PASL",
					(value: unknown) => lodashIsUndefined(value)
				),
		otherwise: (schema) =>
			schema
				.required("Labeling Duration is a required field for CASL/PCASL processing")
				.test((labelingDuration, context) => {
					if (typeof labelingDuration === "number") {
						if (labelingDuration <= 0) {
							return yupCreateError(context, "Labeling Duration cannot be a non-positive number");
						}
						return true;
					}
					if (Array.isArray(labelingDuration)) {
						if (labelingDuration.length === 0) {
							return yupCreateError(
								context,
								"This field cannot be empty unless the Arterial Spin Labeling Type is PASL"
							);
						}
						if (labelingDuration.some((v) => !lodashIsNumber(v) || v <= 0)) {
							return yupCreateError(context, "Labeling Duration cannot contain non-finite or non-positive numbers");
						}
						return true;
					}
					return yupCreateError(context, "Labeling Duration must be a number or an array of numbers if provided");
				}),
	});

/** Minimal schema to ensure that PASLType is an **optional** string enum */
export const SchemaMin_PASLType = Yup.string()
	.oneOf(
		["FAIR", "EPISTAR", "PICORE"],
		`If provided, PASL Type must be one of the following: "FAIR", "EPISTAR", "PICORE"`
	)
	.optional()
	.typeError(`PASL Type must be one of the following: "FAIR", "EPISTAR", "PICORE"`);

/** Expanded schema to ensure PASLType is also sensitive to ASLType field */
export const Schema_PASLType = SchemaMin_PASLType.when("ArterialSpinLabelingType", {
	is: "PASL",
	then: (schema) => schema,
	otherwise: (schema) =>
		schema.test(
			"PASLType__NotPASL",
			"PASL Type should not be provided for non-PASL ASL acquisitions",
			(caslType: unknown, context: Yup.TestContext) => {
				// Because this is a conditional schema, we know ASLType is not PASL
				const ASLType = context.parent.ArterialSpinLabelingType;
				if (lodashIsUndefined(caslType)) return true;

				if (lodashIsUndefined(ASLType)) {
					return yupCreateError(
						context,
						`PASL Type cannot be provided without first indicating the "Arterial Spin Labeling Type"`
					);
				} else {
					return yupCreateError(context, `PASL Type should not be provided for non-PASL ASL acquisitions`);
				}
			}
		),
});

/** Minimal schema to ensure BolusCutOffFlag is an **optional** boolean */
export const SchemaMin_BolusCutOffFlag = Yup.boolean()
	.optional()
	.typeError("Bolus Cut Off Flag must be a boolean, if provided");

/** Expanded schema to ensure BolusCutOffFlag is also sensitive to ASLType field */
export const Schema_BolusCutOffFlag = Yup.boolean().when("ArterialSpinLabelingType", {
	is: "PASL",
	then: Yup.boolean()
		.required("Bolus Cut Off Flag is a required field for PASL processing")
		.typeError("Bolus Cut Off Flag must be a boolean"),
	otherwise: SchemaMin_BolusCutOffFlag.test(
		"BolusCutOffFlag",
		"Bolus Cut Off Flag should not be present when Arterial Spin Labeling Type is not PASL",
		(value) => lodashIsUndefined(value)
	),
});

/** Minimal schema to ensure BolusCutOffTechnique is an **optional** string enum */
export const SchemaMin_BolusCutOffTechnique = Yup.string()
	.oneOf(["QUIPSS", "QUIPSSII", "Q2TIPS"])
	.typeError(`Bolus Cut Off Technique must be one of the following, if provided: "QUIPSS", "QUIPSSII", "Q2TIPS"`);

/** Expanded schema to ensure BolusCutOffTechnique responds to BolusCutOffFlag */
export const Schema_BolusCutOffTechnique = Yup.string().when("BolusCutOffFlag", {
	is: true,
	then: SchemaMin_BolusCutOffTechnique.required(
		"Bolus Cut Off Technique is a required field when Bolus Cut Off Flag is true"
	),
	otherwise: SchemaMin_BolusCutOffTechnique.test(
		"BolusCutOffTechnique",
		"Bolus Cut Off Technique should not be present when Bolus Cut Off Flag is false",
		(value) => lodashIsUndefined(value)
	),
});

/** Minimal schema to ensure BolusCutOffDelayTime is either undefined, a number, or tuple of two numbers */
export const SchemaMin_BolusCutOffDelayTime = Yup.mixed().test(
	"SchemaMin_BolusCutOffDelayTime",
	"Bolus Cut Off Delay Time must be either omitted, a non-negative number, or a collection of two non-negative numbers depending on the value of Bolus Cut Off Technique",
	(cutOffDelayTime) => {
		return (
			lodashIsUndefined(cutOffDelayTime) ||
			(lodashIsNumber(cutOffDelayTime) && cutOffDelayTime >= 0) ||
			(Array.isArray(cutOffDelayTime) &&
				cutOffDelayTime.length === 2 &&
				cutOffDelayTime.every((v) => lodashIsNumber(v) && v >= 0))
		);
	}
);

/** Expanded schema to ensure BolusCutOffDelayTime responds to BolusCutOffFlag and BolusCutOffTechnique */
export const Schema_BolusCutOffDelayTime = Yup.mixed()
	.transform((value) => (value === 0 ? undefined : value))
	.test(
		"BolusCutOffDelayTime",
		"Bolus Cut Off Delay Time must be either a number of a collection of two numbers depending on the values of Bolus Cut Off Technique",
		(delayTime: number | number[] | undefined, context) => {
			const {
				BolusCutOffFlag,
				BolusCutOffTechnique,
			}: {
				BolusCutOffFlag: boolean | undefined;
				BolusCutOffTechnique: "QUIPSS" | "QUIPSSII" | "Q2TIPS" | undefined;
			} = context.parent;
			if (!BolusCutOffFlag || lodashIsUndefined(BolusCutOffTechnique)) {
				if (!!delayTime) {
					return yupCreateError(
						context,
						`Bolus Cut Off Delay Time should not be present when Bolus Cut Off Flag is false or Bolus Cut Off Technique is undefined`
					);
				}
				return true;
			}

			if (BolusCutOffTechnique === "Q2TIPS") {
				if (
					!Array.isArray(delayTime) ||
					!(delayTime.length === 2) ||
					!delayTime.every((t) => typeof t === "number" && t >= 0)
				) {
					return yupCreateError(
						context,
						`Bolus Cut Off Delay Time must be an array of two numbers when Bolus Cut Off Technique is "Q2TIPS"; instead got ${delayTime}`
					);
				}
			} else {
				if (typeof delayTime !== "number" || delayTime < 0) {
					return yupCreateError(
						context,
						`Bolus Cut Off Delay Time must be a number when Bolus Cut Off Technique is "QUIPSS" or "QUIPSSII"; instead got ${delayTime}`
					);
				}
			}

			return true;
		}
	);

/**
 * Minimal schema representing ASL-related fields.
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid
 */
export const SchemaMin_ASLSpecificFields = Yup.object().shape({
	ArterialSpinLabelingType: SchemaMin_ArterialSpinLabelingType,
	PostLabelingDelay: SchemaMin_PostLabelingDelay,
	// ^ Optional ASL-related Fields
	LabelingDistance: Schema_LabelingDistance, // full schema is not a required field
	VascularCrushing: Schema_VascularCrushing, // full schema is not a required field
	TotalAcquiredPairs: Schema_TotalAcquiredPairs, // full schema is not a required field
	TotalReadoutTime: Schema_TotalReadoutTime, // full schema is not a required field
	// ^ PCASL & CASL Specific Fields
	PCASLType: SchemaMin_PCASLType,
	CASLType: SchemaMin_CASLType,
	LabelingDuration: SchemaMin_LabelingDuration,
	// ^ PASL Specific Fields
	PASLType: SchemaMin_PASLType,
	BolusCutOffFlag: SchemaMin_BolusCutOffFlag,
	BolusCutOffTechnique: SchemaMin_BolusCutOffTechnique,
	BolusCutOffDelayTime: SchemaMin_BolusCutOffDelayTime,
	// ^ 2D Acquisition Specific Fields
	SliceTiming: SchemaMin_SliceTiming,
});

/**
 * Expanded schema representing ASL-related fields.
 * These fields are interdependent.
 * @see https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#common-metadata-fields-applicable-to-both-pcasl-and-pasl
 */
export const Schema_ASLSpecificFields = Yup.object().shape({
	ArterialSpinLabelingType: Schema_ArterialSpinLabelingType,
	PostLabelingDelay: Schema_PostLabelingDelay,
	// ^ Optional ASL-related Fields
	LabelingDistance: Schema_LabelingDistance,
	VascularCrushing: Schema_VascularCrushing,
	TotalAcquiredPairs: Schema_TotalAcquiredPairs,
	TotalReadoutTime: Schema_TotalReadoutTime,
	// ^ PCASL & CASL Specific Fields
	PCASLType: Schema_PCASLType,
	CASLType: Schema_CASLType,
	LabelingDuration: Schema_LabelingDuration,
	// ^ PASL Specific Fields
	PASLType: Schema_PASLType,
	BolusCutOffFlag: Schema_BolusCutOffFlag,
	BolusCutOffTechnique: Schema_BolusCutOffTechnique,
	BolusCutOffDelayTime: Schema_BolusCutOffDelayTime,
	// ^ 2D Acquisition Specific Fields
	SliceTiming: Schema_SliceTiming,
});

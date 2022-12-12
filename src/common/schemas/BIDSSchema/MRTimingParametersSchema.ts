import * as Yup from "yup";

/** Minimal schema to ensure Echo time is an **optional** positive number */
export const SchemaMin_EchoTime = Yup.number()
	.typeError("Echo Time must be a positive number")
	.positive("Echo Time must be a positive number");

/** Expanded schema for EchoTime to ensure it is required as well */
export const Schema_EchoTime = SchemaMin_EchoTime.required("Echo Time is a required field in ASL processing");

/** Minimal schema to ensure RepetitionTime is an **optional** positive number */
export const SchemaMin_RepetitionTimePreparation = Yup.number()
	.typeError("Repetition Time must be a positive number")
	.positive("Repetition Time must be a positive number");

/** Expanded schema for RepetitionTime to ensure it is required as well */
export const Schema_RepetitionTimePreparation = SchemaMin_RepetitionTimePreparation.required(
	"Repetition Time is a required field in ASL processing"
);

/** Minimal schema to ensure InversionTime is an **optional** positive number */
export const SchemaMin_InversionTime = Yup.number()
	.typeError("Inversion Time must be a positive number")
	.positive("Inversion Time must be a positive number");

/** Minimal schema to ensure SliceEncodingDirection is an **optional** string enum */
export const SchemaMin_SliceEncodingDirection = Yup.string()
	.optional()
	.oneOf(
		["i", "j", "k", "i-", "j-", "k-"],
		`Slice Encoding Direction must be one of the following: "i", "j", "k", "i-", "j-", "k-"`
	)
	.typeError("Slice Encoding Direction must be text if provided");

/** Minimal schema to ensure PhaseEncodingDirection is an **optional** string enum */
export const SchemaMin_PhaseEncodingDirection = Yup.string()
	.optional()
	.typeError("Phase Encoding Direction must be text if provided")
	.oneOf(
		["i", "j", "k", "i-", "j-", "k-"],
		`Phase Encoding Direction must be one of the following: "i", "j", "k", "i-", "j-", "k-"`
	);

/** Minimal schema to ensure DwellTime is an **optional** number */
export const SchemaMin_DwellTime = Yup.number()
	.optional()
	.typeError("Dwell Time must be a positive number")
	.positive("Dwell Time must be a positive number");

/**
 * Minimal schema for MRI Timing Parameters-related fields
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid
 */
export const SchemaMin_MRTimingParameters = Yup.object().shape({
	EchoTime: SchemaMin_EchoTime,
	RepetitionTimePreparation: SchemaMin_RepetitionTimePreparation,
	InversionTime: SchemaMin_InversionTime,
	SliceEncodingDirection: SchemaMin_SliceEncodingDirection,
	PhaseEncodingDirection: SchemaMin_PhaseEncodingDirection,
	DwellTime: SchemaMin_DwellTime,
});

/**
 * Schema for MRI Timing Parameters-related fields
 * @see https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#timing-parameters
 */
export const Schema_MRTimingParameters = Yup.object().shape({
	EchoTime: Schema_EchoTime,
	RepetitionTimePreparation: Schema_RepetitionTimePreparation,
	InversionTime: SchemaMin_InversionTime, // InversionTime is optional
	SliceEncodingDirection: SchemaMin_SliceEncodingDirection, // SliceEncodingDirection is optional
	PhaseEncodingDirection: SchemaMin_PhaseEncodingDirection, // PhaseEncodingDirection is optional
	DwellTime: SchemaMin_DwellTime, // DwellTime is optional
});

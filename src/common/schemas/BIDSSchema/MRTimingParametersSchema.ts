import * as Yup from "yup";
import { isUndefined as lodashIsUndefined } from "lodash";
import { yupCreateError } from "../../../common/utils/formFunctions";

/** Minimal schema to ensure Echo time is an **optional** number or array of numbers */
export const SchemaMin_EchoTime = Yup.mixed().test(
	"FitsEchoTimeType",
	"Echo Time must be either a positive number or an array of positive numbers",
	(echoTime) => {
		// Permit undefined or single-numeric values
		if (lodashIsUndefined(echoTime) || typeof echoTime === "number") return true;
		// Otherwise, must be an array of numbers
		return Array.isArray(echoTime) && echoTime.every((value) => typeof value === "number");
	}
);

/** Expanded schema for EchoTime to ensure it is required as well */
export const Schema_EchoTime = SchemaMin_EchoTime.required("Echo Time is a required field in ASL processing").test(
	"EchoTimeBIDSValid",
	"Echo Time must be a positive number or an array of positive numbers",
	(echoTime, context) => {
		// First assess if the value is a number
		if (typeof echoTime === "number") {
			if (echoTime <= 0) {
				return yupCreateError(context, "Echo Time cannot be a negative number");
			}
			return true; // Early return
		}

		// Otherwise, must be an array of numbers
		if (!Array.isArray(echoTime)) return false;

		if (echoTime.length === 0) {
			return yupCreateError(
				context,
				"If provided as a collection of numbers, Echo Time must contain at least one positive number"
			);
		}

		if (!echoTime.every((value) => typeof value === "number" && value > 0)) {
			return yupCreateError(context, "One or more Echo Time values are not positive numbers");
		}
	}
);

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

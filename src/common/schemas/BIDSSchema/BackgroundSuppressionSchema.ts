import { isNumber, isUndefined } from "lodash";
import * as Yup from "yup";

/** Minimal schema for ensuring BackgroundSuppression is an **optional** boolean */
export const SchemaMin_BackgroundSuppression = Yup.boolean().typeError(
	"Background Suppression must be a true or false value"
);

/** Expanded schema for ensure BackgroundSuppression is a required boolean field */
export const Schema_BackgroundSuppression = SchemaMin_BackgroundSuppression.required(
	"Background Suppression is a required field for ASL processing"
);

/** Minimal schema to ensure BackgroundSuppressionNumberPulses is a non-negative integer */
export const SchemaMin_BackgroundSuppressionNumberPulses = Yup.number()
	.optional()
	.typeError("Number of Background Suppression Pulses must be 0 or a positive integer")
	.integer("Number of Background Suppression Pulses must be 0 or a positive integer")
	.moreThan(-1, "Number of Background Suppression Pulses must be 0 or a positive integer");

/** Expanded schema to ensure BackgroundSuppressionNumberPulses is also dependent on the BackgroundSuppression field */
export const Schema_BackgroundSuppressionNumberPulses = SchemaMin_BackgroundSuppressionNumberPulses.test(
	"ExtendedSchemaBackgroundSuppressionNumberPulses",
	"Number of Background Suppression Pulses must be 0 or a positive integer",
	(bSupNumberPulses, context) => {
		const { BackgroundSuppression }: { BackgroundSuppression: boolean | undefined } = context.parent;
		// This field must be absent if BackgroundSuppression is absent
		if (isUndefined(BackgroundSuppression) && !isUndefined(bSupNumberPulses)) {
			return context.createError({
				message: `Number of Background Suppression Pulses must be absent if Background Suppression is absent`,
				path: context.path,
			});
		}
		// This field must be 0 if BackgroundSuppression is explicitly false
		if (BackgroundSuppression === false && !isUndefined(bSupNumberPulses) && bSupNumberPulses !== 0) {
			return context.createError({
				message: `Number of Background Suppression Pulses must be 0 if Background Suppression is false`,
				path: context.path,
			});
		}
		// This field must be a positive integer if BackgroundSuppression is explicitly true
		if (BackgroundSuppression === true && (!isNumber(bSupNumberPulses) || bSupNumberPulses <= 0)) {
			return context.createError({
				message: `Number of Background Suppression Pulses must be a positive integer if Background Suppression is true`,
				path: context.path,
			});
		}
		return true;
	}
);

/** Minimal schema to ensure BackgroundSuppressionPulseTime is an **optional** collection of numbers */
export const SchemaMin_BackgroundSuppressionPulseTime = Yup.array()
	.of(Yup.number())
	.typeError("Background Suppression Pulse Timings must be a collection of numbers");

/**
 * Minimal schema representing Background Suppression-related fields.
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid.
 */
export const SchemaMin_BackgroundSuppressionFields = Yup.object().shape({
	BackgroundSuppression: SchemaMin_BackgroundSuppression,
	BackgroundSuppressionNumberPulses: SchemaMin_BackgroundSuppressionNumberPulses,
	BackgroundSuppressionPulseTime: SchemaMin_BackgroundSuppressionPulseTime,
});

/**
 * Expanded schema representing Background Suppression-related fields.
 * These fields are interdependent.
 */
export const Schema_BackgroundSuppressionFields = Yup.object().shape({
	BackgroundSuppression: Schema_BackgroundSuppression,
	BackgroundSuppressionNumberPulses: Schema_BackgroundSuppressionNumberPulses,
	BackgroundSuppressionPulseTime: SchemaMin_BackgroundSuppressionPulseTime,
});

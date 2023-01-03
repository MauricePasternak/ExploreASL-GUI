import { isNumber as lodashIsNumber, isUndefined as lodashIsUndefined } from "lodash";
import { yupCreateError } from "../../../common/utils/formFunctions";
import * as Yup from "yup";
/** Minimal schema for ensuring BackgroundSuppression is an **optional** boolean */
export const SchemaMin_BackgroundSuppression = Yup.boolean().typeError("Background Suppression must be a true or false value");
/** Expanded schema for ensure BackgroundSuppression is a required boolean field */
export const Schema_BackgroundSuppression = SchemaMin_BackgroundSuppression.required("Background Suppression is a required field for ASL processing");
/** Minimal schema to ensure BackgroundSuppressionNumberPulses is a non-negative integer */
export const SchemaMin_BackgroundSuppressionNumberPulses = Yup.number()
    .optional()
    .typeError("Number of Background Suppression Pulses must be 0 or a positive integer")
    .integer("Number of Background Suppression Pulses must be 0 or a positive integer")
    .moreThan(-1, "Number of Background Suppression Pulses must be 0 or a positive integer");
/** Expanded schema to ensure BackgroundSuppressionNumberPulses is also dependent on the BackgroundSuppression field */
export const Schema_BackgroundSuppressionNumberPulses = SchemaMin_BackgroundSuppressionNumberPulses.test("ExtendedSchemaBackgroundSuppressionNumberPulses", "Number of Background Suppression Pulses must be 0 or a positive integer", (bSupNumberPulses, context) => {
    const { BackgroundSuppression } = context.parent;
    // This field must be absent if BackgroundSuppression is absent
    if (lodashIsUndefined(BackgroundSuppression) && !lodashIsUndefined(bSupNumberPulses)) {
        return context.createError({
            message: `Number of Background Suppression Pulses must be absent if Background Suppression is absent`,
            path: context.path,
        });
    }
    // This field must be 0 if BackgroundSuppression is explicitly false
    if (BackgroundSuppression === false && !lodashIsUndefined(bSupNumberPulses) && bSupNumberPulses !== 0) {
        return context.createError({
            message: `Number of Background Suppression Pulses must be 0 if Background Suppression is false`,
            path: context.path,
        });
    }
    // This field must be a positive integer if BackgroundSuppression is explicitly true
    if (BackgroundSuppression === true && (!lodashIsNumber(bSupNumberPulses) || bSupNumberPulses <= 0)) {
        return context.createError({
            message: `Number of Background Suppression Pulses must be a positive integer if Background Suppression is true`,
            path: context.path,
        });
    }
    return true;
});
/** Minimal schema to ensure BackgroundSuppressionPulseTime is an **optional** collection of numbers */
export const SchemaMin_BackgroundSuppressionPulseTime = Yup.array()
    .of(Yup.number())
    .typeError("Background Suppression Pulse Timings must be a collection of numbers");
export const Schema_BackgroundSuppressionPulseTime = SchemaMin_BackgroundSuppressionPulseTime.test("BackgroundSuppressionPulseTime", "Invalid number of suppression timings", (bSupTimings, context) => {
    const bSupNumberPulses = context.parent.BackgroundSuppressionNumberPulses;
    // This field must be blank or an empty field when BackgroundSuppressionNumberPulses is blank
    if (lodashIsUndefined(bSupNumberPulses) || bSupNumberPulses === 0) {
        if (lodashIsUndefined(bSupTimings) || (Array.isArray(bSupTimings) && bSupTimings.length === 0))
            return true;
        return yupCreateError(context, `This must be an empty field when "Number of Background Suppression Pulses" is blank or zero`);
    }
    // This field must not be blank when BackgroundSuppressionNumberPulses is nonzero
    if (lodashIsUndefined(bSupTimings) && bSupNumberPulses > 0) {
        return yupCreateError(context, `This field cannot be blank when the "Number of Background Suppression Pulses" is greater than zero`);
    }
    // Otherwise, the number of timings must match the number of pulses
    if (bSupNumberPulses > 0 && bSupTimings.length !== bSupNumberPulses) {
        return yupCreateError(context, `The number of timings (${bSupTimings.length}) did not match the value in Number of Background Suppression Pulses (${bSupNumberPulses})`);
    }
    return true;
});
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
    BackgroundSuppressionPulseTime: Schema_BackgroundSuppressionPulseTime,
});
//# sourceMappingURL=BackgroundSuppressionSchema.js.map
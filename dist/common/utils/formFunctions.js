var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { dot, object } from "dot-object";
import { merge as lodashMerge } from "lodash";
import * as Yup from "yup";
import { Regex } from "./Regex";
const ArrayErrorRegex = new Regex(`(?<Field>.*)\\[\\d+\\]$`, "m"); // matches "Field[0]" and captures "Field" portion
/** Wrapper function around helpers.createError when used in the test method of a Yup schema */
export function yupCreateError(helpers, message) {
    return helpers.createError({ path: helpers.path, message });
}
/**
 * Parses a react-hook-form error object or array of such objects to procure the first error message.
 * @param err The value of fieldstate.error when using react-hook-form
 * @returns either null if there was no error, or the error message as a string
 */
export function parseFieldError(err) {
    // Error is not present
    if (!err)
        return null;
    // Error is an array
    if (Array.isArray(err)) {
        const firstErr = err.find((e) => e != null);
        if (!firstErr)
            return null; // No errors in the array
        return firstErr.message;
    }
    // Error is a single error
    else {
        return err === null || err === void 0 ? void 0 : err.message;
    }
}
/**
 * Factory function to create a custom resolver for Yup.
 * - Feeds the `data` itself as the `context` to the `yup` schema. This allows for more complex validation using the
 * `test` method of yup.
 * - Restricts the listed errors to the first error of each field.
 * - By default `abortEarly` is `false`.
 * @param validationSchema Yup schema to validate the form values.
 * @returns Returns the resolver function. This function should be fed into the `resolver` prop of the `useForm` hook.
 */
export const YupResolverFactoryBase = (validationSchema, options) => (data) => __awaiter(void 0, void 0, void 0, function* () {
    options = Object.assign({ abortEarly: false, context: (options === null || options === void 0 ? void 0 : options.extraContext) ? Object.assign(data, options.extraContext) : data }, options);
    try {
        const values = yield validationSchema.validate(data, options);
        return {
            values,
            errors: {},
        };
    }
    catch (errors) {
        // Early exit
        if (!(errors instanceof Yup.ValidationError) || !errors.inner)
            throw errors;
        // Restrict errors to the first error of each field
        const parsedErrors = errors.inner.length === 0 && errors.path
            ? { [errors.path]: errors.message } // single error
            : errors.inner.reduce((acc, currError) => {
                var _a;
                // Array errors ending in [#] will cause object-dot to throw an error; array index must be removed
                const arrayFieldMatch = ArrayErrorRegex.search(currError.path);
                if (arrayFieldMatch) {
                    currError.path = arrayFieldMatch.groupsObject.Field;
                }
                if (!(currError.path in acc)) {
                    acc[currError.path] = { message: currError.message, type: (_a = currError.type) !== null && _a !== void 0 ? _a : "validation" };
                }
                return acc;
            }, {});
        // React-hook-form expects an expanded object of errors, not a flattened one
        const toExpandedFormat = object(parsedErrors);
        const res = {
            values: {},
            errors: toExpandedFormat,
        };
        return res;
    }
});
/**
 * Wrapper function around safetly invoking yup validation and catching any errors.
 * @param schema Yup schema to validate the form values.
 * @param data Form values to be validated.
 * @param options Additional options of what should be passed to the `validate` method of yup.
 * @returns An object with properties:
 * - `values`: The validated form values.
 * - `errors`: An mapping of field names to error messages.
 */
export function YupValidate(schema, data, options) {
    return __awaiter(this, void 0, void 0, function* () {
        options = Object.assign({ abortEarly: false, context: (options === null || options === void 0 ? void 0 : options.extraContext) ? Object.assign(data, options.extraContext) : data }, options);
        try {
            const values = yield schema.validate(data, options);
            // console.log("YupValidate call did not throw an error. Values:", values);
            return {
                values,
                errors: {},
            };
        }
        catch (errors) {
            // Early exit
            if (!(errors instanceof Yup.ValidationError) || !errors.inner)
                throw errors;
            const parsedErrors = errors.inner.length === 0 && errors.path
                ? { [errors.path]: errors }
                : errors.inner.reduce((acc, currError) => {
                    var _a;
                    // Array errors ending in [#] will cause object-dot to throw an error; array index must be removed
                    const arrayFieldMatch = ArrayErrorRegex.search(currError.path);
                    if (arrayFieldMatch) {
                        currError.path = arrayFieldMatch.groupsObject.Field;
                    }
                    if (!(currError.path in acc)) {
                        acc[currError.path] = { message: currError.message, type: (_a = currError.type) !== null && _a !== void 0 ? _a : "validation" };
                    }
                    return acc;
                }, {});
            return {
                values: {},
                errors: parsedErrors,
            };
        }
    });
}
/**
 * Reformats a nested object of errors to a flat object of dot paths and error messages.
 * @param errors The errors object returned by the Yup schema validate method in the event of errors being present.
 * @returns A mapping of field paths to field message.
 */
export function parseNestedFormattedYupErrors(errors) {
    const flattenedError = dot(errors);
    const reformattedErrors = Object.entries(flattenedError).reduce((acc, [key, value]) => {
        if (key.endsWith(".message")) {
            const fieldName = /.*\.message/.exec(key)[0].replace(".message", "");
            acc[fieldName] = value;
        }
        return acc;
    }, {});
    return reformattedErrors;
}
/**
 * Corrects invalid yup-assessed form values into valid values using a valid object and a mapping of which fields
 * were found to be invalid.
 * @param invalidObject The object that contained invalid fields.
 * @param errorMapping A mapping of field paths to error messages.
 * @param validObject A version of the object that is considered valid.
 * @returns A corrected version of the invalid object.
 */
export function correctYupValidatedContent(invalidObject, errorMapping, validObject) {
    // Flatten both valid and invalid objects so that the fields can be compared
    const dottedInvalidObject = dot(invalidObject);
    const dottedValidObject = dot(validObject);
    // Remove all paths from the invalid Object that are in the error mapping and/or not in the valid object
    for (const fieldpath of Object.keys(dottedInvalidObject)) {
        // Skip valid fields
        if (!(fieldpath in errorMapping))
            continue;
        // Assign correct value to the invalid field
        if (fieldpath in dottedValidObject) {
            dottedInvalidObject[fieldpath] = dottedValidObject[fieldpath];
        }
        else {
            delete dottedInvalidObject[fieldpath];
        }
    }
    // Now merge to create the corrected object from the valid object and the expanded "no-longer-invalid" object
    const correctedObject = lodashMerge({}, validObject, object(dottedInvalidObject));
    // const correctedObject = object(dottedInvalidObject) as TValid;
    return correctedObject;
}
/**
 * Formats a series of yup errors into an array of strings for easier display.
 * @param errors The errors object returned by the Yup schema validate method.
 * @param translator A mapping of field paths to a custom name for each error.
 * @returns A string array representation of the errors.
 */
export function formatErrorsForDisplay(errors, translator) {
    const formattedErrors = [];
    const regexHasSquareBrackets = /(.*)\[(\d+)\]/;
    for (const [fieldPath, fieldError] of Object.entries(errors)) {
        // Fieldpath might be square-bracketed, so substitute appropriately
        const fieldPathSub = regexHasSquareBrackets.test(fieldPath)
            ? fieldPath.replace(regexHasSquareBrackets, "$1.$2")
            : fieldPath;
        if (!(fieldPathSub in translator))
            continue;
        const formattedMessage = `${translator[fieldPathSub]}: ${fieldError.message}`;
        formattedErrors.push(formattedMessage);
    }
    return formattedErrors;
}
//# sourceMappingURL=formFunctions.js.map
import { dot, object } from "dot-object";
import { merge as lodashMerge } from "lodash";
import { FieldError, FieldValues, Path, Resolver, ResolverError } from "react-hook-form";
import * as Yup from "yup";
import { Regex } from "./Regex";

const ArrayErrorRegex = new Regex(`(?<Field>.*)\\[\\d+\\]$`, "m"); // matches "Field[0]" and captures "Field" portion

/** Wrapper function around helpers.createError when used in the test method of a Yup schema */
export function yupCreateError<T extends Record<string, any>>(
	helpers: Yup.TestContext<T>,
	message: string
): Yup.ValidationError {
	return helpers.createError({ path: helpers.path, message });
}

/**
 * Parses a react-hook-form error object or array of such objects to procure the first error message.
 * @param err The value of fieldstate.error when using react-hook-form
 * @returns either null if there was no error, or the error message as a string
 */
export function parseFieldError(err: null | FieldError | Array<null | FieldError>) {
	// Error is not present
	if (!err) return null;

	// Error is an array
	if (Array.isArray(err)) {
		const firstErr = err.find((e) => e != null);
		if (!firstErr) return null; // No errors in the array
		return firstErr.message;
	}

	// Error is a single error
	else {
		return err?.message;
	}
}

type ModifiedValidateOptions<TFV extends FieldValues> = Yup.ValidateOptions<TFV> & {
	extraContext?: Record<string, unknown>;
};

/**
 * Type defining a function which produces a React Hook Form resolver.
 */
export type ResolverFactory = <T extends Yup.AnyObjectSchema, TFV extends FieldValues = FieldValues>(
	schema: T,
	options?: ModifiedValidateOptions<TFV>
) => Resolver<TFV, any>;

/**
 * Factory function to create a custom resolver for Yup.
 * - Feeds the `data` itself as the `context` to the `yup` schema. This allows for more complex validation using the
 * `test` method of yup.
 * - Restricts the listed errors to the first error of each field.
 * - By default `abortEarly` is `false`.
 * @param validationSchema Yup schema to validate the form values.
 * @returns Returns the resolver function. This function should be fed into the `resolver` prop of the `useForm` hook.
 */
export const YupResolverFactoryBase: ResolverFactory =
	<T extends Yup.AnyObjectSchema, TFV extends FieldValues = FieldValues>(
		validationSchema: T,
		options?: ModifiedValidateOptions<TFV>
	) =>
	async (data: TFV) => {
		options = Object.assign(
			{ abortEarly: false, context: options?.extraContext ? Object.assign(data, options.extraContext) : data },
			options
		);

		try {
			const values = await validationSchema.validate(data, options);
			return {
				values,
				errors: {},
			};
		} catch (errors) {
			// Early exit
			if (!(errors instanceof Yup.ValidationError) || !errors.inner) throw errors;

			// Restrict errors to the first error of each field
			const parsedErrors =
				errors.inner.length === 0 && errors.path
					? { [errors.path]: errors.message } // single error
					: errors.inner.reduce<Record<string, FieldError>>((acc, currError) => {
							// Array errors ending in [#] will cause object-dot to throw an error; array index must be removed
							const arrayFieldMatch = ArrayErrorRegex.search(currError.path);
							if (arrayFieldMatch) {
								currError.path = arrayFieldMatch.groupsObject.Field;
							}

							if (!(currError.path in acc)) {
								acc[currError.path] = { message: currError.message, type: currError.type ?? "validation" };
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
	};

/**
 * Wrapper function around safetly invoking yup validation and catching any errors.
 * @param schema Yup schema to validate the form values.
 * @param data Form values to be validated.
 * @param options Additional options of what should be passed to the `validate` method of yup.
 * @returns An object with properties:
 * - `values`: The validated form values.
 * - `errors`: An mapping of field names to error messages.
 */
export async function YupValidate<T extends Yup.AnyObjectSchema, TFV extends FieldValues>(
	schema: T,
	data: TFV,
	options?: ModifiedValidateOptions<TFV>
): Promise<{ values: TFV; errors: Record<Path<TFV>, FieldError> }> {
	options = Object.assign(
		{ abortEarly: false, context: options?.extraContext ? Object.assign(data, options.extraContext) : data },
		options
	);
	try {
		const values = await schema.validate(data, options);
		// console.log("YupValidate call did not throw an error. Values:", values);
		return {
			values,
			errors: {} as Record<Path<TFV>, FieldError>,
		};
	} catch (errors) {
		// Early exit
		if (!(errors instanceof Yup.ValidationError) || !errors.inner) throw errors;

		const parsedErrors =
			errors.inner.length === 0 && errors.path
				? { [errors.path]: errors }
				: errors.inner.reduce<Record<string, FieldError>>((acc, currError) => {
						// Array errors ending in [#] will cause object-dot to throw an error; array index must be removed
						const arrayFieldMatch = ArrayErrorRegex.search(currError.path);
						if (arrayFieldMatch) {
							currError.path = arrayFieldMatch.groupsObject.Field;
						}

						if (!(currError.path in acc)) {
							acc[currError.path] = { message: currError.message, type: currError.type ?? "validation" };
						}
						return acc;
				  }, {});

		return {
			values: {} as TFV,
			errors: parsedErrors as Record<Path<TFV>, FieldError>,
		};
	}
}

/**
 * Reformats a nested object of errors to a flat object of dot paths and error messages.
 * @param errors The errors object returned by the Yup schema validate method in the event of errors being present.
 * @returns A mapping of field paths to field message.
 */
export function parseNestedFormattedYupErrors(errors: ResolverError["errors"]) {
	const flattenedError = dot(errors);
	const reformattedErrors = Object.entries(flattenedError).reduce((acc, [key, value]) => {
		if (key.endsWith(".message")) {
			const fieldName = /.*\.message/.exec(key)[0].replace(".message", "");
			acc[fieldName] = value as string;
		}
		return acc;
	}, {} as Record<string, string>);
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
export function correctYupValidatedContent<
	TInvalid extends FieldValues,
	TValid extends FieldValues,
	TErrorMap = Record<Path<TValid>, FieldError>
>(invalidObject: TInvalid, errorMapping: TErrorMap, validObject: TValid) {
	// Flatten both valid and invalid objects so that the fields can be compared
	const dottedInvalidObject = dot(invalidObject);
	const dottedValidObject = dot(validObject);

	// Remove all paths from the invalid Object that are in the error mapping and/or not in the valid object
	for (const fieldpath of Object.keys(dottedInvalidObject)) {
		// Skip valid fields
		if (!(fieldpath in (errorMapping as Record<Path<TValid>, FieldError>))) continue;

		// Assign correct value to the invalid field
		if (fieldpath in dottedValidObject) {
			dottedInvalidObject[fieldpath] = dottedValidObject[fieldpath];
		} else {
			delete dottedInvalidObject[fieldpath];
		}
	}

	// Now merge to create the corrected object from the valid object and the expanded "no-longer-invalid" object
	const correctedObject = lodashMerge({}, validObject, object(dottedInvalidObject)) as TValid;
	// const correctedObject = object(dottedInvalidObject) as TValid;
	return correctedObject;
}

/**
 * Formats a series of yup errors into an array of strings for easier display.
 * @param errors The errors object returned by the Yup schema validate method.
 * @param translator A mapping of field paths to a custom name for each error.
 * @returns A string array representation of the errors.
 */
export function formatErrorsForDisplay(
	errors: Record<Path<FieldValues>, FieldError>,
	translator: Record<Path<FieldValues>, string>
) {
	const formattedErrors = [];
	const regexHasSquareBrackets = /(.*)\["?(\d+)"?\]/;
	for (const [fieldPath, fieldError] of Object.entries(errors)) {
		// Fieldpath might be square-bracketed, so substitute appropriately
		const fieldPathSub = regexHasSquareBrackets.test(fieldPath)
			? fieldPath.replace(regexHasSquareBrackets, "$1.$2")
			: fieldPath;

		console.log("fieldPathSub:", fieldPathSub);

		if (!(fieldPathSub in translator)) continue;
		const formattedMessage = `${translator[fieldPathSub]}: ${fieldError.message}`;
		formattedErrors.push(formattedMessage);
	}
	return formattedErrors;
}

import { TextFieldProps } from "@mui/material/TextField";
import React from "react";
import {
	ControllerRenderProps,
	FieldPathValue,
	FieldValues,
	FieldPath,
	useController,
	useWatch,
} from "react-hook-form";
import { parseFieldError } from "../../common/utils/formFunctions";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import { DebouncedInput } from "../DebouncedComponents";

// To avoid conflict with the "field" prop coming from the Controller render
type RestrictedMUITextFieldProps = Omit<TextFieldProps, keyof ControllerRenderProps>;

// Field <---> Inner value conversion functions
type RHFTextFieldBaseProps<TFV extends FieldValues, TName extends FieldPath<TFV>> = {
	fieldToInner?: (fieldValue: FieldPathValue<TFV, TName>, ...args: unknown[]) => string;
	innerToField?: (inner: string, ...args: unknown[]) => FieldPathValue<TFV, TName>;
	debounceTime?: number; // in ms
};

export type RHFTextFieldProps<
	TFV extends FieldValues,
	TName extends FieldPath<TFV>,
	TTrigger extends FieldPath<TFV>,
	TWatch extends FieldPath<TFV> | readonly FieldPath<TFV>[]
> = RestrictedMUITextFieldProps &
	RHFControllerProps<TFV, TName> & // name & control
	RHFTriggerProps<TFV, TTrigger> & // trigger & triggerTarget
	RHFWatchProps<TFV, TWatch> & // watchTarget & onWatchChange
	RHFTextFieldBaseProps<TFV, TName>;

/**
 * Altered MaterialUI TextField component meant to be used in a react-hook-form context, specifically for text input.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The react-hook-form control object.
 *
 * ### RHF-related Optional Props
 * - `trigger`: The trigger function from react-hook-form, allowing changes to this component to trigger validation
 *    in other fields.
 * - `triggerTarget`: The fields whose validation should be triggered when this component changes.
 * - `watchTarget`: The fields whose values should be watched for changes which affect the rendering of this component.
 * - `onWatchedChange`: A callback function to be called when the watched fields change. Expected to return a boolean
 *    indicating whether the component should be rendered.
 *
 * ### Other Optional Props
 * - `fieldToInner`: A function converting the field value to the inner value of this component.
 * - `innerToField`: A function converting the inner value of this component to the field value.
 * - `debounceTime`: The time in milliseconds to debounce the onChange event. Defaults to 500 milliseconds.
 * - `muiTextFieldProps`: All other props are passed to the underlying MaterialUI TextField component.
 */
export function RHFTextField<
	TFV extends FieldValues,
	TName extends FieldPath<TFV>,
	TTrigger extends FieldPath<TFV>,
	TWatch extends FieldPath<TFV> | readonly FieldPath<TFV>[]
>({
	name,
	control,
	trigger,
	triggerTarget,
	watchTarget,
	onWatchedChange,
	fieldToInner,
	innerToField,
	debounceTime = 500, // in ms
	...muiTextFieldProps
}: RHFTextFieldProps<TFV, TName, TTrigger, TWatch>) {
	// RHF Variables
	const { field, fieldState } = useController({ name, control }); // field & fieldState
	const hasError = !!fieldState.error;
	const errorMessage = hasError ? parseFieldError(fieldState.error) : null;

	// Watch-related variables
	const isWatching = watchTarget && onWatchedChange;
	const watchParams = isWatching ? { control, name: watchTarget } : { control };
	const watchedValue = useWatch(watchParams);

	/** Handles changes to the input and triggers validation of dependent fields */
	const handleChange = (value: string) => {
		const newValue = innerToField ? innerToField(value) : value;
		field.onChange(newValue); // update the field value
		trigger && trigger(triggerTarget); // trigger the validation
	};

	// It is necessary to convert the field value to a compatible string type for the Input component
	const asStringValue = fieldToInner ? fieldToInner(field.value) : (field.value as string);
	// console.log(`RHFTextField with name ${name} has asStringValue: `, asStringValue);

	function render() {
		return (
			<DebouncedInput
				className="RHFTextField__TextField"
				{...muiTextFieldProps} // spread the rest of the props
				{...field}
				error={hasError}
				errorMessage={errorMessage}
				value={asStringValue}
				onChange={handleChange}
				debounceTime={debounceTime}
			/>
		);
	}

	return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

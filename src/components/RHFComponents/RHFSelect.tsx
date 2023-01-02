import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent, SelectProps } from "@mui/material/Select";
import React from "react";
import {
	ControllerRenderProps,
	FieldValues,
	FieldPath,
	FieldPathValue,
	useController,
	useWatch,
} from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";

type RHFSelectValue<
	TFV extends FieldValues,
	TName extends FieldPath<TFV>,
	TValue = FieldPathValue<TFV, TName>
> = TValue extends string | number | readonly string[] | undefined
	? TValue extends ReadonlyArray<any>
		? TValue[number]
		: TValue
	: never;

export type RHFSelectOption<TFV extends FieldValues, TName extends FieldPath<TFV>> = {
	label: React.ReactNode;
	value: RHFSelectValue<TFV, TName>;
	disabled?: boolean;
};

// Modified SelectProps to avoid conflicts with the field props
type MUIRestrictedSelectProps = Omit<SelectProps, keyof ControllerRenderProps | "value" | "error">;

type RHFSelectBaseProps<TFV extends FieldValues, TName extends FieldPath<TFV>> = {
	options: RHFSelectOption<TFV, TName>[]; // options to display in the select
	label?: React.ReactNode;
	formControlProps?: Omit<FormControlProps<"fieldset">, "error" | "variant">;
	helperText?: React.ReactNode;
};

export type RHFSelectProps<
	TFV extends FieldValues,
	TName extends FieldPath<TFV>,
	TTrigger extends FieldPath<TFV>,
	TWatch extends FieldPath<TFV> | readonly FieldPath<TFV>[]
> = MUIRestrictedSelectProps &
	RHFControllerProps<TFV, TName> & // name, control
	RHFTriggerProps<TFV, TTrigger> & // trigger & triggerTarget
	RHFWatchProps<TFV, TWatch> & // watch
	RHFSelectBaseProps<TFV, TName>; // options

/**
 * A MaterialUI Select component meant to be used in a react-hook-form context, specifically for fields that either
 * feature multiple options of varying types or an array of such multiple options.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `options`: Options for the label, value, etc. of the MenuItem child components.
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
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `label`: The field label to render for the component.
 * - `formControlProps`: Props to pass to the wrapping FormControl component that wraps the child components such as the
 *    label, helperText, etc.
 * - Additional props are passed to the Select component.
 */
export function RHFSelect<
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
	options,
	label,
	formControlProps,
	helperText,
	...muiSelectProps
}: RHFSelectProps<TFV, TName, TTrigger, TWatch>) {
	// RHF Variables
	const { field, fieldState } = useController({ name, control });
	const hasError = !!fieldState.error;
	const errorMessage = hasError ? fieldState.error?.message : "";

	// Watch-related variables
	const isWatching = watchTarget && onWatchedChange;
	const watchParams = isWatching ? { control, name: watchTarget } : { control };
	const watchedValue = useWatch(watchParams);

	const handleChange = (e: SelectChangeEvent<unknown>) => {
		field.onChange(e);
		trigger && triggerTarget && trigger(triggerTarget);
	};

	function render() {
		return (
			<FormControl
				className="RHFSelect__FormControl"
				fullWidth
				{...formControlProps}
				variant={muiSelectProps.variant}
				error={hasError}
				disabled={muiSelectProps.disabled}
				component="fieldset"
			>
				<InputLabel className="RHFSelect__InputLabel">{label}</InputLabel>
				<Select className="RHFSelect__Select" {...muiSelectProps} {...field} onChange={handleChange} label={label}>
					{options.map((option, index) => {
						return (
							<MenuItem className="RHFSelect__MenuItem" key={`RHFSelect__MenuItem__${index}`} {...option}>
								{option.label}
							</MenuItem>
						);
					})}
				</Select>
				{helperText && (
					<FormHelperText className="RHFSelect__HelperText" error={hasError}>
						{helperText}
					</FormHelperText>
				)}
				{hasError && (
					<FormHelperText className="RHFSelect__ErrorText" error={true}>
						{errorMessage}
					</FormHelperText>
				)}
			</FormControl>
		);
	}

	return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

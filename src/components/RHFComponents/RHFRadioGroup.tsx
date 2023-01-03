import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio, { RadioProps } from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
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

type MUIRestrictedRadioButtonProps = Omit<RadioProps, keyof ControllerRenderProps | "control" | "checked" | "onChange">;

export type RHFRadioButtonOption<TFV extends FieldValues, TName extends FieldPath<TFV>> = {
	label: React.ReactNode; // label to display next to the checkbox
	value: FieldPathValue<TFV, TName>; // value to set when checked
} & MUIRestrictedRadioButtonProps;

type RHFRadioGroupBaseProps<TFV extends FieldValues, TName extends FieldPath<TFV>> = {
	options: RHFRadioButtonOption<TFV, TName>[]; // options to display
	onChange?: (value: FieldPathValue<TFV, TName>, ...args: unknown[]) => void; // onChange callback
	helperText?: React.ReactNode; // helper text to display below the checkbox
	label?: React.ReactNode; // label to display next to the checkbox
	row?: boolean; // display options in a row instead of a column
};

export type RHFRadioGroupProps<
	TFV extends FieldValues,
	TName extends FieldPath<TFV>,
	TTrigger extends FieldPath<TFV>,
	TWatch extends FieldPath<TFV> | readonly FieldPath<TFV>[]
> = RHFRadioGroupBaseProps<TFV, TName> &
	RHFControllerProps<TFV, TName> & // name, control
	RHFWatchProps<TFV, TWatch> & // watchTarget & onWatchedChange
	RHFTriggerProps<TFV, TTrigger>; // trigger & triggerTarget

/**
 * A MaterialUI RadioGroup meant to be used in a react-hook-form context, specifically for fields where there are few
 * options, but the values can vary in type significantly.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `options`: Options for the label, value, etc. of the Radio button child components.
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
 * - `row`: Whether the radio button group should be arranged in a row (true) or a column (false).
 *    Defaults to column arrangement.
 */
export function RHFRadioGroup<
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
	onChange,
	label, // label to display above the radio buttons
	helperText, // helper text to display below the checkbox
	row, // display options in a row instead of a column
}: RHFRadioGroupProps<TFV, TName, TTrigger, TWatch>) {
	// RHF Variables
	const { field, fieldState } = useController({ name, control }); // get the field and fieldState from react-hook-form
	const hasError = !!fieldState.error;
	const errorMessage = hasError ? fieldState.error?.message : "";

	// Watch-related variables
	const isWatching = watchTarget && onWatchedChange;
	const watchParams = isWatching ? { control, name: watchTarget } : { control };
	const watchedValue = useWatch(watchParams);

	const handleChange = (idx: number) => {
		const newValue = options[idx].value;
		field.onChange(newValue);
		trigger && trigger(triggerTarget); // trigger validation
		onChange && onChange(newValue); // call onChange callback
	};

	function render() {
		return (
			<FormControl
				onBlur={field.onBlur}
				fullWidth
				error={hasError}
				variant="standard"
				component="fieldset"
				className="RHFRadioGroup__FormControl"
			>
				<FormLabel component="legend" className="RHFRadioGroup__FormLabel">
					{label}
				</FormLabel>
				<RadioGroup row={row} className="RHFRadioGroup__RadioGroup">
					{options.map((option, idx) => (
						<FormControlLabel
							key={`RHFRadioGroup__FormControlLabel__${field.name}__${idx}`}
							className="RHFRadioGroup__FormControlLabel"
							label={option.label}
							checked={field.value === option.value} // check if the current option is checked
							onChange={() => handleChange(idx)} // handle change for the current option
							control={<Radio {...option} color={hasError ? "error" : option?.color ?? "primary"} />}
						/>
					))}
				</RadioGroup>
				{helperText && (
					<FormHelperText className="RHFRadioGroup__HelperText" error={hasError}>
						{helperText}
					</FormHelperText>
				)}
				{hasError && (
					<FormHelperText className="RHFRadioGroup__ErrorText" error={true}>
						{errorMessage}
					</FormHelperText>
				)}
			</FormControl>
		);
	}

	return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

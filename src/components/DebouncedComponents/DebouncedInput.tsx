import ClearIcon from "@mui/icons-material/Clear";
import Box, { BoxProps } from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import React, { forwardRef, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

type MUITextFieldCompatibilityType = Omit<TextFieldProps, "onChange" | "value">;

type DebouncedInputBaseProps = {
	value: string | number;
	onChange: (value: string, ...args: unknown[]) => void;
	errorMessage?: React.ReactNode;
	boxProps?: BoxProps;
	debounceTime?: number;
};

export type DebouncedInputProps = DebouncedInputBaseProps & MUITextFieldCompatibilityType;

/**
 * MUI TextField component meant to capture a string as its value and communicate it to a parent component
 * in a debounced manner.
 *
 * ### Mandatory Props:
 * - `value`: the value of the field
 * - `onChange`: a callback function to update the value of the field. The first argument is expected to be a string.
 *
 * ### Optional Props:
 * - `errorMessage`: error message for the text field
 * - `boxProps`: props to pass to the Box component that wraps the text field and error text
 * - `debounceTime`: debounce time for communicating changes to the parent component
 * All other props are passed to the underlying [TextField](https://mui.com/material-ui/api/text-field/) component.
 */
export const DebouncedInput = forwardRef(
	(
		{
			value,
			onChange,
			errorMessage,
			boxProps,
			debounceTime = 400,
			variant = "outlined",
			...textFieldProps
		}: DebouncedInputProps,
		ref
	) => {
		// Inner State
		const [innerValue, setInnerValue] = useState<string | number>(value);

		// Debounce Callback
		const debouncedOnChange = useDebouncedCallback(onChange, debounceTime);

		// useEffect for keeping innerValue in sync with value
		useEffect(() => {
			console.log(`DebouncedInput useEffect: value is ${value} and innerValue is ${innerValue}`);

			// console.log(`DebouncedInput: value changed to ${value} while innerValue is ${innerValue}`);
			if (value !== innerValue) {
				setInnerValue(value);
			}
		}, [value]);

		/** Handler for changes to the value; updates the inner value and forwards the new value via provided onChange */
		const handleChange = (newValue: string) => {
			setInnerValue(newValue);
			debouncedOnChange(newValue);
		};

		// Misc
		const componentClassName = textFieldProps.className
			? `${textFieldProps.className} "DebouncedInput__TextField"`
			: "DebouncedInput__TextField";

		return (
			<Box className="DebouncedInput__Box" {...boxProps}>
				<TextField
					className={componentClassName}
					variant={variant}
					fullWidth
					inputRef={ref}
					InputProps={{
						className: "DebouncedInput__Input",
						endAdornment: (
							<IconButton
								className="DebouncedInput__IconButton"
								disabled={textFieldProps.disabled}
								onClick={() => innerValue && handleChange("")}
								color={textFieldProps.error ? "error" : "inherit"}
							>
								<ClearIcon className="DebouncedInput__ClearIcon" />
							</IconButton>
						),
					}}
					{...textFieldProps}
					onChange={(e) => handleChange(e.target.value)}
					value={innerValue}
				/>
				{textFieldProps?.error && (
					<FormHelperText className="DebouncedInput__ErrorText" variant={variant} error>
						{errorMessage}
					</FormHelperText>
				)}
			</Box>
		);
	}
);

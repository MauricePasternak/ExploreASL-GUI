import Button, { ButtonProps } from "@mui/material/Button";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import React, { forwardRef, useEffect, useRef, useState } from "react";
import { OpenDialogOptions } from "electron";
import { useDebouncedCallback } from "use-debounce";
import Box, { BoxProps } from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import FormHelperText from "@mui/material/FormHelperText";
import ClearIcon from "@mui/icons-material/Clear";

type MUITextFieldCompatibilityType = Omit<TextFieldProps, "onChange" | "value">;

type DebouncedFilepathInputBaseProps = {
	value: string;
	onChange: (value: string, ...args: unknown[]) => void;
	filepathType: "file" | "dir" | "other" | "all";
	/**
	 * options to pass to the Electron dialog when the button is clicked.
	 * [See the Electron docs for more info.](https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogbrowserwindow-options)
	 */
	dialogOptions?: OpenDialogOptions;
	errorMessage?: React.ReactNode;
	debounceTime?: number;
	includeButton?: boolean;
	buttonText?: React.ReactNode;
	buttonProps?: ButtonProps;
	onValidateDrop?: (filepath: string) => boolean | Promise<boolean>;
	boxProps?: BoxProps;
};

export type DebouncedFilepathInputProps = MUITextFieldCompatibilityType & DebouncedFilepathInputBaseProps;

/**
 * MUI TextField + Button component meant to capture a string representing a filepath and communicate it
 * to a parent component in a debounced manner.
 *
 * ### Mandatory Props:
 * - `value`: the value of the field
 * - `onChange`: a callback function to update the value of the field. The first argument is expected to be a string.
 * - `filepathType`: the type of filepath that this component is expected to take. One of "file", "dir", "other", "all".
 *
 * ### Optional Props:
 * - `dialogOptions`: options to pass to the Electron dialog when the button is clicked.
 *    [See the Electron docs for more info.](https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogbrowserwindow-options)
 * - `errorMessage`: an error message to display below the field.
 * - `debounceTime`: the debounce time in milliseconds. Defaults to 500.
 * - `includeButton`: whether to include the Browse button. Defaults to true.
 * - `buttonText`: the text featured on the Browse button. Defaults to "Browse".
 * - `buttonProps`: additional props to pass to the Button component if it is rendered.
 * - `onValidateDrop`: a callback function to run and validate the value of a filepath. If it returns true, the value
 *    is forwarded to onChange, otherwise it is silently dropped
 * - `boxProps`: additional props to pass to the Box component that wraps the text field and error text
 * - all other props are forwarded to the TextField component
 */
export const DebouncedFilepathInput = forwardRef(
	(
		{
			value,
			onChange,
			filepathType,
			dialogOptions,
			errorMessage,
			debounceTime = 500,
			includeButton = true,
			buttonText = "Browse",
			buttonProps,
			onValidateDrop,
			boxProps,
			helperText,
			...textFieldProps
		}: DebouncedFilepathInputProps,
		ref
	) => {
		// Misc
		const componentClassName = textFieldProps.className
			? `${textFieldProps.className} "DebouncedInput__TextField"`
			: "DebouncedInput__TextField";
		const { api } = window;

		// Inner State
		const [innerValue, setInnerValue] = useState(value);

		// Refs
		const isDialogOpened = useRef(false);

		// Debounce Callback
		const debouncedHandleChange = useDebouncedCallback(onChange, debounceTime);

		/** Handler for changes to the value; updates the inner value and forwards the new value via provided onChange */
		const handleChange = (newValue: string) => {
			// console.log("🚀 ~ file: DebouncedFilepathInput.tsx:91 ~ handleChange ~ newValue", newValue);
			setInnerValue(newValue);
			debouncedHandleChange(newValue);
		};

		// useEffect for keeping innerVal in sync with value prop
		useEffect(() => {
			if (value !== innerValue) setInnerValue(value);
		}, [value]);

		// Sanity Check for valid Props
		if (!dialogOptions && includeButton) {
			dialogOptions = {
				properties:
					filepathType === "all"
						? ["openFile", "openDirectory"]
						: filepathType === "file"
						? ["openFile"]
						: ["openDirectory"],
			};
		}
		if (dialogOptions && filepathType === "file" && dialogOptions.properties.includes("openDirectory")) {
			throw new Error("DebouncedFilepathInput: Cannot use openDirectory with filepathType=file");
		}
		if (dialogOptions && filepathType === "dir" && dialogOptions.properties.includes("openFile")) {
			throw new Error("DebouncedFilepathInput: Cannot use openFile with filepathType=dir");
		}

		/** Handler for dragging in a filepath */
		const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
		};

		/** Handler for aborting in a drag */
		const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
		};

		/** Handler for dropping a filepath */
		const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();

			// Early exist
			if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

			const dndPath = e.dataTransfer.files[0];
			const droppedFilepathType = await api.path.getFilepathType(dndPath.path);

			// Basic Filetype Checks
			// Exit if the filepathType doesn't match the given status
			if (
				!droppedFilepathType ||
				!(
					filepathType === droppedFilepathType ||
					(filepathType === "all" && ["file", "dir", "other"].includes(droppedFilepathType))
				)
			)
				return;

			// Custom additional validation implemented, as necessary
			if (onValidateDrop) {
				const validationStatus = await onValidateDrop(dndPath.path);
				if (!validationStatus) return;
			}
			handleChange(dndPath.path);
		};

		//* Handler for opening the file dialog */
		const handleOpenFileDialog = async () => {
			if (isDialogOpened.current) return; // Early return if already opened
			isDialogOpened.current = true;
			const { canceled, filePaths } = await api.invoke("Dialog:OpenDialog", dialogOptions);
			isDialogOpened.current = false;
			!canceled && handleChange(filePaths[0]);
		};

		return (
			<Box className="DebouncedFilepathInput__Box__MainWrapper" {...boxProps}>
				<Box className="DebouncedFilepathInput__Box__TextFieldButtonWrapper" display="flex" width="100%" gap={1}>
					<TextField
						className={componentClassName}
						fullWidth
						variant={textFieldProps.variant}
						{...textFieldProps}
						inputRef={ref}
						InputProps={{
							endAdornment: (
								<IconButton
									className="DebouncedFilepathInput__IconButton"
									color={textFieldProps.error ? "error" : "inherit"}
									disabled={textFieldProps.disabled}
									onClick={() => innerValue && handleChange("")}
								>
									<ClearIcon className="DebouncedFilepathInput__ClearIcon" />
								</IconButton>
							),
						}}
						error={textFieldProps.error}
						onDrop={handleDrop}
						onDragLeave={handleDragLeave}
						onDragEnter={handleDragEnter}
						onChange={(e) => handleChange(e.target.value)}
						value={innerValue}
					/>
					{includeButton && (
						<Button
							className="DebouncedFilepathInput__Button"
							variant="contained"
							disabled={textFieldProps.disabled}
							color={textFieldProps.error ? "error" : buttonProps?.color ?? "primary"}
							{...buttonProps}
							onClick={handleOpenFileDialog}
						>
							{buttonText}
						</Button>
					)}
				</Box>
				{helperText && (
					<FormHelperText
						className="DebouncedFilepathInput__HelperText"
						disabled={textFieldProps.disabled}
						variant={textFieldProps.variant}
					>
						{helperText}
					</FormHelperText>
				)}
				{textFieldProps.error && (
					<FormHelperText
						className="DebouncedFilepathInput__ErrorText"
						disabled={textFieldProps.disabled}
						variant={textFieldProps.variant}
						error
					>
						{errorMessage}
					</FormHelperText>
				)}
			</Box>
		);
	}
);

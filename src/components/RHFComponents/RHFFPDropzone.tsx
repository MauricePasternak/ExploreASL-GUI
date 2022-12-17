import DeleteIcon from "@mui/icons-material/Delete";
import Box from "@mui/material/Box";
import Button, { ButtonProps } from "@mui/material/Button";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import { styled } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { OpenDialogOptions } from "electron";
import React, { useEffect, useRef, useState } from "react";
import { FieldValues, Path, PathValue, useController, useWatch } from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import FastIsEqual from "fast-deep-equal";

const customGradient =
	"linear-gradient(60deg, hsl(224, 85%, 66%), hsl(269, 85%, 66%), hsl(314, 85%, 66%), hsl(359, 85%, 66%), hsl(44, 85%, 66%), hsl(89, 85%, 66%), hsl(134, 85%, 66%), hsl(179, 85%, 66%))";

type DropzonePaperProps = {
	hasError: boolean;
	isAcceptingDrop: boolean;
	maxHeight?: number | string; // We use this to keep track of dialog state
	borderWidth?: number | string;
};

const DropzonePaper = styled(Paper, {
	shouldForwardProp: (p) => p !== "hasError" && p !== "isAcceptingDrop",
})<DropzonePaperProps>(({ theme, hasError, isAcceptingDrop, maxHeight = 620, borderWidth = "4px" }) => {
	return {
		padding: "8px",
		maxHeight: maxHeight,
		borderRadius: "12px",
		borderWidth: "3px",
		position: "relative",

		"&::after": {
			position: "absolute",
			content: '""',
			top: `calc(-1 * ${borderWidth})`,
			left: `calc(-1 * ${borderWidth})`,
			zIndex: -1,
			width: `calc(100% + ${borderWidth} * 2)`,
			height: `calc(100% + ${borderWidth} * 2)`,
			background: isAcceptingDrop ? customGradient : hasError ? theme.palette.error.main : "transparent",
			backgroundSize: "300% 300%",
			backgroundPosition: "0 50%",
			borderRadius: `calc(4 * ${borderWidth})`,
			animation: "moveGradient 4s alternate infinite",
		},
	};
});

type RHFFPDropzoneBaseProps = {
	filepathType: "file" | "dir" | "other" | "all";
	dialogOptions?: OpenDialogOptions;
	overWriteOnDrop?: boolean;
	baseNamesOnly?: boolean;
	label?: React.ReactNode;
	placeholderText?: React.ReactNode;
	helperText?: React.ReactNode;
	extraFilterFunction?: (filepath: string, ...args: any[]) => boolean | Promise<boolean>;
	formControlProps?: Omit<FormControlProps<"fieldset">, "error" | "component">;
	browseButtonProps?: ButtonProps;
	browseButtonText?: React.ReactNode;
	clearButtonProps?: ButtonProps;
	clearButtonText?: React.ReactNode;
};

export type RHFFPDropzoneProps<
	TFV extends FieldValues,
	TName extends Path<TFV>,
	TTrigger extends Path<TFV>,
	TWatch extends Path<TFV> | readonly Path<TFV>[]
> = RHFFPDropzoneBaseProps &
	RHFControllerProps<TFV, TName> & // name & control
	RHFTriggerProps<TFV, TTrigger> & // trigger & triggerTarget
	RHFWatchProps<TFV, TWatch>; // watchTarget & onWatchChange

/**
 * Component meant for use in a react-hook-form context, specifically within fields that are an array of filepaths.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `filepathType`: The type of filepaths that this dropzone will accept. Can be "file", "dir", "other", or "all".
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
 * - `dialogOptions`: Electron dialog options. By default, the `properties` property is set to "openFile" or "openDirectory"
 *    depending on the value of `filepathType`.
 * - `overWriteOnDrop`: Whether to overwriting existing values during a drop event. Defaults to `false`.
 * - `baseNamesOnly`: Whether to only display the basename portion of filepaths that are dropped into the component.
 *    Defaults to `false` (full paths will be the values).
 * - `label`: The field label to render for the component.
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `placeholderText`: The text to display when no values have been accepted yet. Defaults to `"Drop Files Here"`.
 * - `formControlProps`: Props to pass to the wrapping FormControl component that wraps the child components such as the
 *    label, helperText, etc.
 * - `boxProps`: Props to pass to the Box component that is the main Dropzone target.
 * - `browseButtonText`: The text to render for the button responsible for opening the dialog window.
 *    Defaults to `"Browse"`.
 * - `browseButtonProps`: Props to pass to the button associated with opening the filepath dialog window.
 * - `clearButtonText`: The text to render for the button responsible for clearing the current values.
 * - `clearButtonProps`: Props to pass to the button associated with clearing the current values.
 */
export function RHFFPDropzone<
	TFV extends FieldValues,
	TName extends Path<TFV>,
	TTrigger extends Path<TFV>,
	TWatch extends Path<TFV> | readonly Path<TFV>[]
>({
	name,
	control,
	trigger,
	triggerTarget,
	watchTarget,
	onWatchedChange,
	filepathType,
	dialogOptions,
	baseNamesOnly = false,
	overWriteOnDrop = false,
	label,
	extraFilterFunction,
	formControlProps,
	placeholderText = "Drop Filepaths Here",
	helperText,
	browseButtonProps,
	clearButtonProps,
	browseButtonText = "Browse",
	clearButtonText = "Clear",
	...boxProps
}: RHFFPDropzoneProps<TFV, TName, TTrigger, TWatch>) {
	const { api } = window;

	// Refs
	const enterCounter = useRef(0); // We use this to keep track of enter/exit drop state
	const isDialogOpened = useRef(false); // We use this to keep track of dialog state

	// RHF Variables
	const { field, fieldState, formState } = useController({ name, control }); // field & fieldState
	const hasError = !!fieldState.error;
	const errorMessage = hasError ? fieldState.error?.message : "";

	// Watch-related variables
	const isWatching = watchTarget && onWatchedChange;
	const watchParams = isWatching ? { control, name: watchTarget } : { control };
	const watchedValue = useWatch(watchParams);

	// Inner State
	const [innerVal, setInnerVal] = useState(field.value);
	const [isAcceptingDrop, setIsAcceptingDrop] = React.useState(false);

	// Setup default dialog options if a dialogOptions object was not provided and a button is to be presented
	if (!dialogOptions) {
		dialogOptions = {
			properties:
				filepathType === "all"
					? ["openFile", "openDirectory"]
					: filepathType === "file"
					? ["openFile"]
					: ["openDirectory"],
		};
	}

	/**
	 * useEffect handler for responding to external changes to `field.value`
	 * 1) Updates the internal value if it doesn't match field.value
	 * 2) Triggers the validation of other fields
	 */
	useEffect(() => {
		if (FastIsEqual(field.value, innerVal)) return;

		// Update self and trigger target validation
		console.log(`InterdepFPTextfield ${field.name} is syncing with field.value and triggering ${triggerTarget}`, {
			fieldValue: field.value,
			innerVal,
		});
		setInnerVal(field.value);
		trigger && trigger(triggerTarget);
	}, [field.value]);

	// Sanity checks regarding the dialogOptions object
	if (dialogOptions && filepathType === "file" && dialogOptions.properties.includes("openDirectory")) {
		throw new Error("RHFFilepathTextField: Cannot use openDirectory with filepathType=file");
	}
	if (dialogOptions && filepathType === "dir" && dialogOptions.properties.includes("openFile")) {
		throw new Error("RHFFilepathTextField: Cannot use openFile with filepathType=dir");
	}

	/** Utility function to ensure that the encountered filepath fits the requirement of the `filepathType` */
	const filterFiles = async (files: Array<File | string>) => {
		const filteredList = [];

		for (let index = 0; index < files.length; index++) {
			const element = files[index];
			const filepath = typeof element === "string" ? element : element.path;
			const pathType = await api.path.getFilepathType(filepath);

			// Basic filtering; the determined path type must be compatible with the filepathType prop
			if (
				!pathType || // Filepath doesn't exist
				(pathType === "file" && !["file", "all"].includes(filepathType)) || // File type when not requested
				(pathType === "dir" && !["dir", "all"].includes(filepathType)) || // Dir type when not requested
				(pathType === "other" && !["other", "all"].includes(filepathType)) // Other type when not requested
			) {
				continue;
			}

			// Apply user-specified additional validation
			if (extraFilterFunction && !(await extraFilterFunction(filepath))) continue;

			// Finally, if all is clear, append the appropriate fullpath or basename to the filteredList
			filteredList.push(baseNamesOnly ? api.path.getBasename(filepath) : filepath);
		}
		return filteredList;
	};

	/** Handler for entering with a filepath object */
	const handleDragEnter = (e: React.DragEvent<HTMLDivElement | HTMLLIElement>) => {
		e.preventDefault();
		e.stopPropagation();
		enterCounter.current++;
		!isAcceptingDrop && setIsAcceptingDrop(true);
	};

	/** Required handlier for persisting the droppable state */
	const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	/** Handler for leaving the dropzone while still dragging a filepath */
	const handleDragLeave = (e: React.DragEvent<HTMLDivElement | HTMLLIElement>) => {
		e.preventDefault();
		e.stopPropagation();
		enterCounter.current--;
		if (enterCounter.current === 0) {
			isAcceptingDrop && setIsAcceptingDrop(false);
		}
	};

	/** Handler for dropping filepaths into the dropzone */
	const handleDrop = async (e: React.DragEvent<HTMLDivElement | HTMLLIElement>) => {
		e.preventDefault();
		e.stopPropagation();
		const filePaths = Array.from(e.dataTransfer.files);

		// Filter the filepaths
		const filteredList: string[] = await filterFiles(filePaths);
		const finalItemset = overWriteOnDrop ? filteredList : [...innerVal, ...filteredList];

		// Update the field value
		handleChange(finalItemset as PathValue<TFV, TName>);
	};

	/** Handler for changing the value of the field, triggering validation, and resetting drop-related variables */
	const handleChange = (newValue: string[]) => {
		console.log("🚀 ~ file: RHFFPDropzone.tsx:250 ~ handleChange ~ newValue", newValue);
		console.log("🚀 ~ file: RHFFPDropzone.tsx:250 ~ handleChange ~ fieldState", JSON.stringify(fieldState));
		field.onChange(newValue);
		trigger && trigger(field.name); // hack; otherwise, the field doesn't get validated...
		field.onBlur();
		enterCounter.current = 0;
		isAcceptingDrop && setIsAcceptingDrop(false);
		setInnerVal(newValue as PathValue<TFV, TName>);
	};

	/** Handler for opening a file dialog */
	const handleDialog = async () => {
		if (isDialogOpened.current) return;
		if (!dialogOptions) throw new Error("dialogOptions were not specified");

		// Get the filepaths from the dialog and early exit if no files were selected
		isDialogOpened.current = true;
		const { canceled, filePaths } = await api.invoke("Dialog:OpenDialog", dialogOptions);
		isDialogOpened.current = false;
		if (canceled) return;

		// Filter the filepaths
		const filteredList = await filterFiles(filePaths);
		const finalItemset = overWriteOnDrop ? filteredList : [...innerVal, ...filteredList];

		// Update the field value
		handleChange(finalItemset as PathValue<TFV, TName>);
	};

	/** Handler for choosing to delete a particular item within innerVal */
	const handleDelete = (index: number) => {
		const newValue = innerVal.filter((_: unknown, i: number) => i !== index);
		handleChange(newValue);
	};

	function render() {
		return (
			<FormControl
				className="RHFFPDropzone__FormControl"
				fullWidth
				variant="standard"
				{...formControlProps}
				component="fieldset"
				error={hasError}
			>
				<FormLabel component="legend" className="RHFFPDropZone__FormLabel">
					{label}
				</FormLabel>
				<DropzonePaper
					className="RHFFPDropzone__Paper"
					elevation={2}
					hasError={hasError}
					isAcceptingDrop={isAcceptingDrop}
				>
					<Box
						className="RHFFPDropzone__Box__Dropzone"
						onDrop={handleDrop}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDragEnter={handleDragEnter}
						onBlur={field.onBlur}
						sx={{
							width: "100%",
							height: "clamp(400px, 500px, 600px)",
							borderRadius: "8px",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark" ? theme.palette.background.default : theme.palette.grey[100],
							marginBottom: "8px",
							position: "relative",
						}}
						{...boxProps}
						overflow="auto"
					>
						<List className="RHFFPDropzone__List">
							{Array.isArray(innerVal) &&
								innerVal.map((listItem: string, idx: number) => (
									<ListItem
										key={`RHFFPDropzone__ListItem__${listItem}_${idx}`}
										className="RHFFPDropzone__ListItem"
										divider={idx !== innerVal.length - 1}
										secondaryAction={
											<IconButton className="RHFFPDropzone__IconButton" onClick={() => handleDelete(idx)}>
												<DeleteIcon className="RHFFPDropzone__DeleteIcon" />
											</IconButton>
										}
									>
										<ListItemText
											className="RHFFPDropzone__ListItemText"
											primary={<Typography noWrap>{listItem}</Typography>}
										/>
									</ListItem>
								))}
						</List>
						{innerVal.length === 0 && (
							<Typography
								className="RHFFPDropzone__Typography__PlaceholderText"
								variant="subtitle1"
								sx={{
									fontSize: "1.5rem",
									color: (theme) => theme.palette.text.secondary,
									position: "absolute",
									top: "50%",
									left: "50%",
									transform: "translate(-50%, -50%)",
									textAlign: "center",
								}}
							>
								{placeholderText}
							</Typography>
						)}
					</Box>
					{dialogOptions && (
						<Button
							className="RHFFPDropzone__Button__Browse"
							sx={{ borderRadius: "12px", mb: 0.5 }}
							color={hasError ? "error" : "primary"}
							fullWidth
							variant="contained"
							{...browseButtonProps}
							onClick={handleDialog}
						>
							{browseButtonText}
						</Button>
					)}
					<Button
						className="RHFFPDropzone__Button__Clear"
						sx={{ borderRadius: "12px" }}
						color={hasError ? "error" : "warning"}
						fullWidth
						variant="contained"
						{...clearButtonProps}
						onClick={() => {
							innerVal.length > 0 && handleChange([]);
						}}
					>
						{clearButtonText}
					</Button>
				</DropzonePaper>
				{helperText && <FormHelperText className="RHFFPDropzone__HelperText">{helperText}</FormHelperText>}
				{hasError && (
					<FormHelperText className="RHFFPDropzone__ErrorText" error>
						{errorMessage}
					</FormHelperText>
				)}
			</FormControl>
		);
	}

	return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

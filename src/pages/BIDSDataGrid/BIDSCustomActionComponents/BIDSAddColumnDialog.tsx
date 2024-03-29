import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { memo, useState } from "react";
import { DebouncedInput, DebouncedNumericCSVInput } from "../../../components/DebouncedComponents";
import {
	BIDSAllFieldsNameType,
	BIDSBooleanFieldToColDef,
	BIDSEnumFieldToColDef,
	BIDSNumericArrayFieldToColDef,
	BIDSNumericFieldToColDef,
	BIDSTextFieldToColDef,
	isBIDSBooleanField,
	isBIDSEnumField,
	isBIDSNumericArrayField,
	isBIDSNumericField,
	isBIDSTextField,
} from "../BIDSColumnDefs";
import {
	atomBIDSAddColumnDialogOpen,
	atomBIDSColumnNames,
	atomSetBIDSAddColumn,
} from "../../../stores/BIDSDataGridStore";
import { ObjectEntries } from "../../../common/utils/objectFunctions";
import InputLabel from "@mui/material/InputLabel";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";

export const BIDSAddColumnDialog = memo(() => {
	// Atomic State
	const [open, setOpen] = useAtom(atomBIDSAddColumnDialogOpen);
	const currentColumnNames = useAtomValue(atomBIDSColumnNames);
	const currentColumnNamesSet = new Set(currentColumnNames);
	const addBIDSColumn = useSetAtom(atomSetBIDSAddColumn);

	// Private State
	const [selectedField, setSelectedField] = React.useState<BIDSAllFieldsNameType | "">("");
	const [applyEmptyDefault, setApplyEmptyDefault] = useState<boolean>(false);
	const [defaultValue, setDefaultValue] = useState<unknown>(null);

	// Group The BIDS Fields by Category
	const availableTextFieldConfigs = ObjectEntries(BIDSTextFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});
	const availableNumberFieldConfigs = ObjectEntries(BIDSNumericFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});
	const availableNumberArrayFieldConfigs = ObjectEntries(BIDSNumericArrayFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});
	const availableBooleanFieldConfigs = ObjectEntries(BIDSBooleanFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});
	const availableEnumFieldConfigs = ObjectEntries(BIDSEnumFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});

	console.log("BIDSAddColumnDialog Rendered with defaultValue", defaultValue);

	// Define the component for controlling the default value
	const renderDefaultValueControl = () => {
		if (!selectedField) return null;

		// Text
		if (isBIDSTextField(selectedField)) {
			const fieldConfig = BIDSTextFieldToColDef[selectedField];
			return (
				<DebouncedInput
					fullWidth
					label={fieldConfig.headerName}
					defaultValue={fieldConfig.defaultValue as string}
					value={fieldConfig.defaultValue as string}
					onChange={(newValue) => {
						setDefaultValue(newValue);
					}}
					helperText={fieldConfig.description}
				/>
			);
		}
		// Numeric
		else if (isBIDSNumericField(selectedField)) {
			const fieldConfig = BIDSNumericFieldToColDef[selectedField];
			return (
				<DebouncedInput
					type="number"
					disabled={applyEmptyDefault}
					label={fieldConfig.headerName}
					defaultValue={fieldConfig.defaultValue as number}
					value={defaultValue as number}
					fullWidth
					onChange={(val) => {
						setDefaultValue(Number(val));
					}}
					inputProps={{
						type: "number",
						min: fieldConfig.min,
						max: fieldConfig.max,
						step: fieldConfig.step,
					}}
					InputProps={{ endAdornment: null }}
					helperText={fieldConfig.description}
				/>
			);
		}
		// Numeric Array
		else if (isBIDSNumericArrayField(selectedField)) {
			const fieldConfig = BIDSNumericArrayFieldToColDef[selectedField];
			return (
				<DebouncedNumericCSVInput
					disabled={applyEmptyDefault}
					value={defaultValue as number}
					fullWidth
					label={fieldConfig.headerName}
					onChange={(numberValues) => {
						const numericArrayFieldName = selectedField;

						console.log("BIDSAddColumnDialog onChange", {
							numericArrayFieldName,
							numberValues,
						});

						// Special Case: BackgroundSuppressionPulseTime; always return an array
						if (numericArrayFieldName === "BackgroundSuppressionPulseTime") {
							setDefaultValue(numberValues);
							return;
						}

						// Otherwise, act according to the number of values: 0 = defaultValue, 1 = single number, 2+ = array
						if (numberValues.length === 0) {
							setDefaultValue(fieldConfig.defaultValue);
							return;
						} else if (numberValues.length === 1) {
							setDefaultValue(numberValues[0]);
							return;
						} else {
							setDefaultValue(numberValues);
							return;
						}
					}}
					InputProps={{ endAdornment: null }}
					debounceTime={1500}
					helperText={fieldConfig.description}
					shouldSort={selectedField === "SliceTiming" || selectedField === "BackgroundSuppressionPulseTime"}
					uniqueOnly={selectedField === "SliceTiming" || selectedField === "BackgroundSuppressionPulseTime"}
				/>
			);
		}
		// Boolean
		else if (isBIDSBooleanField(selectedField)) {
			const fieldConfig = BIDSBooleanFieldToColDef[selectedField];
			return (
				<FormControl variant="standard">
					<FormControlLabel
						label={fieldConfig.headerName}
						disabled={applyEmptyDefault}
						control={<Checkbox checked={!!defaultValue} onChange={(e, checked) => setDefaultValue(checked)} />}
					/>
					<FormHelperText>{fieldConfig.description}</FormHelperText>
				</FormControl>
			);
		}
		// Enum
		else if (isBIDSEnumField(selectedField)) {
			const fieldConfig = BIDSEnumFieldToColDef[selectedField];
			return (
				<FormControl fullWidth>
					<InputLabel>{fieldConfig.headerName}</InputLabel>
					<Select
						value={defaultValue}
						fullWidth
						label={fieldConfig.headerName}
						defaultValue={fieldConfig.defaultValue as string}
						disabled={applyEmptyDefault}
						onChange={(e) => {
							const val = e.target.value;
							setDefaultValue(val);
						}}
					>
						{fieldConfig.enumOptions.map((opt) => (
							<MenuItem key={`${fieldConfig.headerName}__${opt.label}`} value={opt.value}>
								{opt.label}
							</MenuItem>
						))}
					</Select>
					<FormHelperText>{fieldConfig.description}</FormHelperText>
				</FormControl>
			);
		}
		// Otherwise
		else {
			return null;
		}
	};

	const handleAddColumn = () => {
		if (!selectedField) return;

		console.log("handleAddColumn has selectedField: ", selectedField);
		console.log("handleAddColumn has defaultValue: ", defaultValue);

		// Add column to dataframe
		addBIDSColumn({
			colToAdd: selectedField,
			defaultValue: applyEmptyDefault ? undefined : (defaultValue as string | number | boolean | number[] | undefined),
		});

		// Reset the selected field and default value
		setSelectedField("");
		setDefaultValue(null);
		setOpen(false);
	};

	const handleSelectedFieldChange = (event: SelectChangeEvent<BIDSAllFieldsNameType>) => {
		const fieldName = event.target.value as BIDSAllFieldsNameType;
		console.log();
		// Determine the default value for the selected field
		let defaultValue;
		if (isBIDSTextField(fieldName)) {
			defaultValue = BIDSTextFieldToColDef[fieldName].defaultValue;
		} else if (isBIDSNumericField(fieldName)) {
			defaultValue = BIDSNumericFieldToColDef[fieldName].defaultValue;
		} else if (isBIDSNumericArrayField(fieldName)) {
			defaultValue = BIDSNumericArrayFieldToColDef[fieldName].defaultValue;
		} else if (isBIDSBooleanField(fieldName)) {
			defaultValue = BIDSBooleanFieldToColDef[fieldName].defaultValue;
		} else if (isBIDSEnumField(fieldName)) {
			defaultValue = BIDSEnumFieldToColDef[fieldName].defaultValue;
		} else {
			throw new Error(
				`Unknown field name: 🚀 ~ file: BIDSAddColumnDialog.tsx:155 ~ handleSelectedFieldChange ~ fieldName: ${fieldName}`
			);
		}
		setSelectedField(fieldName);
		setDefaultValue(applyEmptyDefault ? undefined : defaultValue);
		setApplyEmptyDefault(false);
	};

	return (
		<Dialog open={open}>
			<DialogTitle>Add a BIDS Field</DialogTitle>
			<DialogContent>
				<Stack rowGap={2}>
					<DialogContentText>
						Indicate the BIDS Field that you'd like to add and the default value that will be applied to each cell for
						the added column.
					</DialogContentText>

					<FormControl fullWidth>
						<InputLabel>BIDS Field to Add</InputLabel>
						<Select
							fullWidth
							value={selectedField}
							onChange={handleSelectedFieldChange}
							label="BIDS Field to Add"
							MenuProps={{
								sx: { maxHeight: 500 },
							}}
						>
							{availableTextFieldConfigs.length > 0 && <ListSubheader>Text-based Fields</ListSubheader>}
							{availableTextFieldConfigs.map(([fieldName, fieldConfig]) => (
								<MenuItem key={`BIDSAddColumnSelectTextField_${fieldName}`} value={fieldName}>
									{fieldConfig.headerName}
								</MenuItem>
							))}
							{availableNumberFieldConfigs.length > 0 && <ListSubheader>Number-based Fields</ListSubheader>}
							{availableNumberFieldConfigs.map(([fieldName, fieldConfig]) => (
								<MenuItem key={`BIDSAddColumnSelectNumberField_${fieldName}`} value={fieldName}>
									{fieldConfig.headerName}
								</MenuItem>
							))}
							{availableNumberArrayFieldConfigs.length > 0 && <ListSubheader>Number Array-based Fields</ListSubheader>}
							{availableNumberArrayFieldConfigs.map(([fieldName, fieldConfig]) => (
								<MenuItem key={`BIDSAddColumnSelectNumberArrayField_${fieldName}`} value={fieldName}>
									{fieldConfig.headerName}
								</MenuItem>
							))}
							{availableBooleanFieldConfigs.length > 0 && <ListSubheader>Boolean-based Fields</ListSubheader>}
							{availableBooleanFieldConfigs.map(([fieldName, fieldConfig]) => (
								<MenuItem key={`BIDSAddColumnSelectBooleanField_${fieldName}`} value={fieldName}>
									{fieldConfig.headerName}
								</MenuItem>
							))}
							{availableEnumFieldConfigs.length > 0 && <ListSubheader>Enum-based Fields</ListSubheader>}
							{availableEnumFieldConfigs.map(([fieldName, fieldConfig]) => (
								<MenuItem key={`BIDSAddColumnSelectEnumField_${fieldName}`} value={fieldName}>
									{fieldConfig.headerName}
								</MenuItem>
							))}
						</Select>
					</FormControl>
					{renderDefaultValueControl()}
					{selectedField && (
						<FormControlLabel
							label="Start with empty cells instead of applying the default value"
							control={
								<Checkbox checked={applyEmptyDefault} onChange={(e, checked) => setApplyEmptyDefault(checked)} />
							}
						/>
					)}
				</Stack>
			</DialogContent>
			<DialogActions>
				<Button onClick={() => setOpen(false)}>Cancel</Button>
				<Button disabled={!selectedField || (!applyEmptyDefault && defaultValue == null)} onClick={handleAddColumn}>
					Add to Spreadsheet
				</Button>
			</DialogActions>
		</Dialog>
	);
});

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
import { DebouncedInput } from "../../components/DebouncedComponents";
import {
	BIDSAllFieldsNameType,
	BIDSBooleanFieldToColDef,
	BIDSEnumFieldToColDef,
	BIDSNumericFieldToColDef,
	BIDSTextFieldToColDef,
	isBIDSBooleanField,
	isBIDSEnumField,
	isBIDSNumericField,
	isBIDSTextField,
} from "./BIDSColumnDefs";
import { atomBIDSAddColumnDialogOpen, atomBIDSColumnNames, atomSetBIDSAddColumn } from "../../stores/BIDSDataGridStore";

type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T];
function ObjectEntries<T extends object>(t: T): Entries<T>[] {
	return Object.entries(t) as any;
}

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
	const availableBooleanFieldConfigs = ObjectEntries(BIDSBooleanFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});
	const availableEnumFieldConfigs = ObjectEntries(BIDSEnumFieldToColDef).filter(([fieldName, _]) => {
		return !currentColumnNamesSet.has(fieldName);
	});

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
				/>
			);
		}
		// Boolean
		else if (isBIDSBooleanField(selectedField)) {
			const fieldConfig = BIDSBooleanFieldToColDef[selectedField];
			return (
				<FormControlLabel
					label={fieldConfig.headerName}
					disabled={applyEmptyDefault}
					control={<Checkbox checked={!!defaultValue} onChange={(e, checked) => setDefaultValue(checked)} />}
				/>
			);
		}
		// Enum
		else if (isBIDSEnumField(selectedField)) {
			const fieldConfig = BIDSEnumFieldToColDef[selectedField];
			return (
				<Select
					value={defaultValue}
					fullWidth
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

					<Select fullWidth value={selectedField} onChange={handleSelectedFieldChange}>
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

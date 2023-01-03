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
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { memo, useState } from "react";
import { DebouncedInput, DebouncedNumericCSVInput } from "../../../components/DebouncedComponents";
import { BIDSBooleanFieldToColDef, BIDSEnumFieldToColDef, BIDSNumericArrayFieldToColDef, BIDSNumericFieldToColDef, BIDSTextFieldToColDef, isBIDSBooleanField, isBIDSEnumField, isBIDSNumericArrayField, isBIDSNumericField, isBIDSTextField, } from "../BIDSColumnDefs";
import { atomBIDSAddColumnDialogOpen, atomBIDSColumnNames, atomSetBIDSAddColumn, } from "../../../stores/BIDSDataGridStore";
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
    const [selectedField, setSelectedField] = React.useState("");
    const [applyEmptyDefault, setApplyEmptyDefault] = useState(false);
    const [defaultValue, setDefaultValue] = useState(null);
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
        if (!selectedField)
            return null;
        // Text
        if (isBIDSTextField(selectedField)) {
            const fieldConfig = BIDSTextFieldToColDef[selectedField];
            return (React.createElement(DebouncedInput, { fullWidth: true, label: fieldConfig.headerName, defaultValue: fieldConfig.defaultValue, value: fieldConfig.defaultValue, onChange: (newValue) => {
                    setDefaultValue(newValue);
                }, helperText: fieldConfig.description }));
        }
        // Numeric
        else if (isBIDSNumericField(selectedField)) {
            const fieldConfig = BIDSNumericFieldToColDef[selectedField];
            return (React.createElement(DebouncedInput, { type: "number", disabled: applyEmptyDefault, label: fieldConfig.headerName, defaultValue: fieldConfig.defaultValue, value: defaultValue, fullWidth: true, onChange: (val) => {
                    setDefaultValue(Number(val));
                }, inputProps: {
                    type: "number",
                    min: fieldConfig.min,
                    max: fieldConfig.max,
                    step: fieldConfig.step,
                }, InputProps: { endAdornment: null }, helperText: fieldConfig.description }));
        }
        // Numeric Array
        else if (isBIDSNumericArrayField(selectedField)) {
            const fieldConfig = BIDSNumericArrayFieldToColDef[selectedField];
            return (React.createElement(DebouncedNumericCSVInput, { disabled: applyEmptyDefault, value: defaultValue, fullWidth: true, label: fieldConfig.headerName, onChange: (numberValues) => {
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
                    }
                    else if (numberValues.length === 1) {
                        setDefaultValue(numberValues[0]);
                        return;
                    }
                    else {
                        setDefaultValue(numberValues);
                        return;
                    }
                }, InputProps: { endAdornment: null }, debounceTime: 1500, helperText: fieldConfig.description, shouldSort: selectedField === "SliceTiming" || selectedField === "BackgroundSuppressionPulseTime", uniqueOnly: selectedField === "SliceTiming" || selectedField === "BackgroundSuppressionPulseTime" }));
        }
        // Boolean
        else if (isBIDSBooleanField(selectedField)) {
            const fieldConfig = BIDSBooleanFieldToColDef[selectedField];
            return (React.createElement(FormControl, { variant: "standard" },
                React.createElement(FormControlLabel, { label: fieldConfig.headerName, disabled: applyEmptyDefault, control: React.createElement(Checkbox, { checked: !!defaultValue, onChange: (e, checked) => setDefaultValue(checked) }) }),
                React.createElement(FormHelperText, null, fieldConfig.description)));
        }
        // Enum
        else if (isBIDSEnumField(selectedField)) {
            const fieldConfig = BIDSEnumFieldToColDef[selectedField];
            return (React.createElement(FormControl, { fullWidth: true },
                React.createElement(InputLabel, null, fieldConfig.headerName),
                React.createElement(Select, { value: defaultValue, fullWidth: true, label: fieldConfig.headerName, defaultValue: fieldConfig.defaultValue, disabled: applyEmptyDefault, onChange: (e) => {
                        const val = e.target.value;
                        setDefaultValue(val);
                    } }, fieldConfig.enumOptions.map((opt) => (React.createElement(MenuItem, { key: `${fieldConfig.headerName}__${opt.label}`, value: opt.value }, opt.label)))),
                React.createElement(FormHelperText, null, fieldConfig.description)));
        }
        // Otherwise
        else {
            return null;
        }
    };
    const handleAddColumn = () => {
        if (!selectedField)
            return;
        console.log("handleAddColumn has selectedField: ", selectedField);
        console.log("handleAddColumn has defaultValue: ", defaultValue);
        // Add column to dataframe
        addBIDSColumn({
            colToAdd: selectedField,
            defaultValue: applyEmptyDefault ? undefined : defaultValue,
        });
        // Reset the selected field and default value
        setSelectedField("");
        setDefaultValue(null);
        setOpen(false);
    };
    const handleSelectedFieldChange = (event) => {
        const fieldName = event.target.value;
        console.log();
        // Determine the default value for the selected field
        let defaultValue;
        if (isBIDSTextField(fieldName)) {
            defaultValue = BIDSTextFieldToColDef[fieldName].defaultValue;
        }
        else if (isBIDSNumericField(fieldName)) {
            defaultValue = BIDSNumericFieldToColDef[fieldName].defaultValue;
        }
        else if (isBIDSNumericArrayField(fieldName)) {
            defaultValue = BIDSNumericArrayFieldToColDef[fieldName].defaultValue;
        }
        else if (isBIDSBooleanField(fieldName)) {
            defaultValue = BIDSBooleanFieldToColDef[fieldName].defaultValue;
        }
        else if (isBIDSEnumField(fieldName)) {
            defaultValue = BIDSEnumFieldToColDef[fieldName].defaultValue;
        }
        else {
            throw new Error(`Unknown field name: 🚀 ~ file: BIDSAddColumnDialog.tsx:155 ~ handleSelectedFieldChange ~ fieldName: ${fieldName}`);
        }
        setSelectedField(fieldName);
        setDefaultValue(applyEmptyDefault ? undefined : defaultValue);
        setApplyEmptyDefault(false);
    };
    return (React.createElement(Dialog, { open: open },
        React.createElement(DialogTitle, null, "Add a BIDS Field"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { rowGap: 2 },
                React.createElement(DialogContentText, null, "Indicate the BIDS Field that you'd like to add and the default value that will be applied to each cell for the added column."),
                React.createElement(FormControl, { fullWidth: true },
                    React.createElement(InputLabel, null, "BIDS Field to Add"),
                    React.createElement(Select, { fullWidth: true, value: selectedField, onChange: handleSelectedFieldChange, label: "BIDS Field to Add", MenuProps: {
                            sx: { maxHeight: 500 },
                        } },
                        availableTextFieldConfigs.length > 0 && React.createElement(ListSubheader, null, "Text-based Fields"),
                        availableTextFieldConfigs.map(([fieldName, fieldConfig]) => (React.createElement(MenuItem, { key: `BIDSAddColumnSelectTextField_${fieldName}`, value: fieldName }, fieldConfig.headerName))),
                        availableNumberFieldConfigs.length > 0 && React.createElement(ListSubheader, null, "Number-based Fields"),
                        availableNumberFieldConfigs.map(([fieldName, fieldConfig]) => (React.createElement(MenuItem, { key: `BIDSAddColumnSelectNumberField_${fieldName}`, value: fieldName }, fieldConfig.headerName))),
                        availableNumberArrayFieldConfigs.length > 0 && React.createElement(ListSubheader, null, "Number Array-based Fields"),
                        availableNumberArrayFieldConfigs.map(([fieldName, fieldConfig]) => (React.createElement(MenuItem, { key: `BIDSAddColumnSelectNumberArrayField_${fieldName}`, value: fieldName }, fieldConfig.headerName))),
                        availableBooleanFieldConfigs.length > 0 && React.createElement(ListSubheader, null, "Boolean-based Fields"),
                        availableBooleanFieldConfigs.map(([fieldName, fieldConfig]) => (React.createElement(MenuItem, { key: `BIDSAddColumnSelectBooleanField_${fieldName}`, value: fieldName }, fieldConfig.headerName))),
                        availableEnumFieldConfigs.length > 0 && React.createElement(ListSubheader, null, "Enum-based Fields"),
                        availableEnumFieldConfigs.map(([fieldName, fieldConfig]) => (React.createElement(MenuItem, { key: `BIDSAddColumnSelectEnumField_${fieldName}`, value: fieldName }, fieldConfig.headerName))))),
                renderDefaultValueControl(),
                selectedField && (React.createElement(FormControlLabel, { label: "Start with empty cells instead of applying the default value", control: React.createElement(Checkbox, { checked: applyEmptyDefault, onChange: (e, checked) => setApplyEmptyDefault(checked) }) })))),
        React.createElement(DialogActions, null,
            React.createElement(Button, { onClick: () => setOpen(false) }, "Cancel"),
            React.createElement(Button, { disabled: !selectedField || (!applyEmptyDefault && defaultValue == null), onClick: handleAddColumn }, "Add to Spreadsheet"))));
});
//# sourceMappingURL=BIDSAddColumnDialog.js.map
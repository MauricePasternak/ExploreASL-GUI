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
import React, { useState } from "react";
import {
  BIDSBooleanSchema,
  BIDSCompleteSchema,
  BIDSEnumSchema,
  BIDSNumericalSchema,
  BIDSTextSchema
} from "../../common/schemas/BIDSDatagridConfigurationSchemas";
import {
  BIDSEnumConfig,
  BIDSFieldNamesType
} from "../../common/types/BIDSDatagridTypes";
import DebouncedInput from "../../components/DebouncedComponents/DebouncedInput";
import { atomAddColumnDialogOpen, atomAddDataframeColumns, atomDataframeColumns } from "../../stores/BIDSDatagridStore";

function BIDSAddColumnDialog() {
  const [open, setOpen] = useAtom(atomAddColumnDialogOpen);
  const currentDFCols = useAtomValue(atomDataframeColumns);
  const addDataframeColumn = useSetAtom(atomAddDataframeColumns);
  const [selectedField, setSelectedField] = useState<BIDSFieldNamesType | "">("");
  const [defaultValue, setDefaultValue] = useState<unknown>(null);
  const [applyEmptyDefault, setApplyEmptyDefault] = useState(false);
  const handleClose = () => setOpen(false);

  const allowedTextSchemas = Object.entries(BIDSTextSchema).filter(
    ([bidsFieldName]) => !currentDFCols.includes(bidsFieldName as BIDSFieldNamesType)
  );
  const allowedBooleanSchemas = Object.entries(BIDSBooleanSchema).filter(
    ([bidsFieldName]) => !currentDFCols.includes(bidsFieldName as BIDSFieldNamesType)
  );
  const allowedEnumSchemas = Object.entries(BIDSEnumSchema).filter(
    ([bidsFieldName]) => !currentDFCols.includes(bidsFieldName as BIDSFieldNamesType)
  );
  const allowedNumericalSchemas = Object.entries(BIDSNumericalSchema).filter(
    ([bidsFieldName]) => !currentDFCols.includes(bidsFieldName as BIDSFieldNamesType)
  );

  const handleSelectedFieldChange = (event: SelectChangeEvent<BIDSFieldNamesType>) => {
    const val = event.target.value as BIDSFieldNamesType;
    setSelectedField(val);
    setDefaultValue(applyEmptyDefault ? undefined : BIDSCompleteSchema[val].defaultValue);
    setApplyEmptyDefault(false);
  };

  const renderDefaultValueInput = () => {
    if (!selectedField) return null;
    const schema = BIDSCompleteSchema[selectedField];

    if (schema.type === "Text") {
      return (
        <DebouncedInput
          fullWidth
          disabled={applyEmptyDefault}
          value={defaultValue}
          onChange={e => {
            const val = typeof e === "string" ? e : e.target.value;
            setDefaultValue(val);
          }}
        />
      );
    } else if (schema.type === "Boolean") {
      return (
        <FormControlLabel
          label={schema.colName}
          disabled={applyEmptyDefault}
          control={<Checkbox checked={!!defaultValue} onChange={(e, checked) => setDefaultValue(checked)} />}
        />
      );
    } else if (schema.type === "Enum") {
      return (
        <Select
          value={defaultValue}
          fullWidth
          disabled={applyEmptyDefault}
          onChange={e => {
            const val = e.target.value as BIDSEnumConfig["defaultValue"];
            setDefaultValue(val);
          }}
        >
          {schema.enumOptions.map(opt => (
            <MenuItem key={`${schema.colName}__${opt.label}`} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      );
    } else if (schema.type === "Numerical") {
      return (
        <DebouncedInput
          disabled={applyEmptyDefault}
          value={defaultValue}
          fullWidth
          onChange={e => {
            const val = typeof e === "string" ? e : e.target.value;
            setDefaultValue(Number(val));
          }}
          inputProps={{
            type: "number",
            min: schema.min,
            max: schema.max,
            step: schema.step,
          }}
          InputProps={null}
        />
      );
    } else {
      return null;
    }
  };

  const handleAddColumn = () => {
    if (!selectedField) return;
    // Add column to dataframe
    addDataframeColumn({ colToAdd: selectedField, defaultValue });

    // Reset the selected field and default value
    setSelectedField("");
    setDefaultValue(null);
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>Add a BIDS Field</DialogTitle>
      <DialogContent>
        <Stack rowGap={2}>
          <DialogContentText>
            Indicate the BIDS Field that you'd like to add and the default value that will be applied to each cell for
            the added column.
          </DialogContentText>
          <Select fullWidth onChange={handleSelectedFieldChange} value={selectedField}>
            {allowedTextSchemas.length > 0 && <ListSubheader>Text-based Fields</ListSubheader>}

            {allowedTextSchemas.map(([bidsFieldName, schema]) => (
              <MenuItem key={`BIDSAddColumnSelectTextField__${schema.colName}`} value={bidsFieldName}>
                {schema.colName}
              </MenuItem>
            ))}

            {allowedEnumSchemas.length > 0 && <ListSubheader>Selectable Option-based Fields</ListSubheader>}
            {allowedEnumSchemas.map(([bidsFieldName, schema]) => (
              <MenuItem key={`BIDSAddColumnSelectEnumField__${schema.colName}`} value={bidsFieldName}>
                {schema.colName}
              </MenuItem>
            ))}

            {allowedNumericalSchemas.length > 0 && <ListSubheader>Numerical-based Fields</ListSubheader>}
            {allowedNumericalSchemas.map(([bidsFieldName, schema]) => (
              <MenuItem key={`BIDSAddColumnSelectNumericalField__${schema.colName}`} value={bidsFieldName}>
                {schema.colName}
              </MenuItem>
            ))}

            {allowedBooleanSchemas.length > 0 && <ListSubheader>True/False-based Fields</ListSubheader>}
            {allowedBooleanSchemas.map(([bidsFieldName, schema]) => (
              <MenuItem key={`BIDSAddColumnSelectBooleanField__${schema.colName}`} value={bidsFieldName}>
                {schema.colName}
              </MenuItem>
            ))}
          </Select>
          {renderDefaultValueInput()}
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
        <Button onClick={handleClose}>Cancel</Button>
        <Button disabled={!selectedField} onClick={handleAddColumn}>
          Add to Spreadsheet
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default React.memo(BIDSAddColumnDialog);

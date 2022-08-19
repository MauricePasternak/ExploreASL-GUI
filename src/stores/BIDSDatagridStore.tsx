import React from "react";
import { atom, useSetAtom } from "jotai";
import { DataFrame, Series } from "data-forge";
import {
  BIDSBooleanFieldNamesType,
  BIDSColumnName,
  BIDSEnumFieldNamesType,
  BIDSFieldNamesType,
  BIDSNumericalFieldNamesType,
  BIDSRow,
  BIDSSchemaValueType,
  BIDSTextFieldNamesType,
  BIDSTypes,
} from "../common/types/BIDSDatagridTypes";
import { FieldPathValues } from "react-hook-form";
import {
  BIDSBooleanSet,
  BIDSCompleteSchema,
  BIDSEnumSchema,
  BIDSEnumSet,
  BIDSNames,
  BIDSNumericalSet,
  BIDSTextSet,
} from "../common/schemas/BIDSDatagridConfigurationSchemas";
import { Column, FormatterProps, CalculatedColumn } from "react-data-grid";
import {
  BooleanEditorFactory,
  NumberEditorFactory,
  SelectEditorFactory,
  TextEditorFactory,
} from "../pages/BIDSDatagrid/EditorFactories";
import Checkbox from "@mui/material/Checkbox";
import { isEmpty as lodashIsEmpty, range as lodashRange } from "lodash";
import CancelIcon from "@mui/icons-material/Cancel";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { Input, OutlinedInput } from "@mui/material";

export function BIDSDatagridHeader({ column }: { column: CalculatedColumn<BIDSRow> }) {
  const removeColumn = useSetAtom(atomRemoveDataframeColumns);

  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      alignSelf="center"
      style={{ paddingInline: column.frozen ? "12px" : "0px" }}
    >
      {!column.frozen && (
        <IconButton
          sx={{ color: theme => (theme.palette.mode === "dark" ? "#272727" : "#f5f5f5") }}
          onClick={() => removeColumn(column.key as BIDSColumnName)}
        >
          <CancelIcon />
        </IconButton>
      )}
      <Typography style={{ fontWeight: 600 }}>{column.name}</Typography>
    </Box>
  );
}

/**
 * Atom that holds the StudyRootPath for the BIDS json files that will be loaded in by globbing.
 */
export const atomBIDSStudyRootPath = atom<string>("/home/mpasternak/Documents/EASLTest_SubjectAndVisitAndSession");

/**
 * Atom that holds the loaded ASL BIDS data.
 */
export const atomBIDSDataframe = atom<DataFrame>(new DataFrame());

/**
 * Setter atom for removing columns from the dataframe & columns atoms.
 */
export const atomRemoveDataframeColumns = atom(null, (get, set, colToRemove: BIDSColumnName) => {
  const currentDF = get(atomBIDSDataframe);
  const newDF = new DataFrame(currentDF.dropSeries(colToRemove).toArray());
  set(atomBIDSDataframe, newDF);

  const currentColumns = get(atomDataframeColumns);
  const newColumns = currentColumns.filter(col => col !== colToRemove);
  set(atomDataframeColumns, newColumns);
});

/**
 * Setter atom for adding columns to the dataframe & columns atoms.
 */
export const atomAddDataframeColumns = atom(
  null,
  (get, set, { colToAdd, defaultValue }: { colToAdd: BIDSColumnName; defaultValue: unknown }) => {
    const currentDF = get(atomBIDSDataframe);
    const newSeries = new Series(lodashRange(currentDF.count()).map(() => defaultValue));
    const newDF = new DataFrame(currentDF.ensureSeries(colToAdd, newSeries).toArray());

    const currentColumns = get(atomDataframeColumns);
    const newColumns = [...currentColumns, colToAdd];

    console.log(`atomAddDataframeColumns:`, {
      colToAdd,
      defaultValue,
      newColumns,
      newDF: newDF.toArray(),
    });

    set(atomBIDSDataframe, newDF);
    set(atomDataframeColumns, newColumns);
  }
);

export const atomAddColumnDialogOpen = atom<boolean>(false);

/**
 * Atom that holds the drawer cards for mapping a single value to all cells of a column.
 */
export const atomBIDSDrawerValues = atom<Partial<typeof BIDSCompleteSchema>[]>([]);

/**
 * Separate atom for the columns of the dataframe. This reduces re-renders when cells are edited.
 */
export const atomDataframeColumns = atom<BIDSColumnName[]>([]);

export const atomRDGColumns = atom<Column<BIDSRow>[]>(get => {
  const colNames = get(atomDataframeColumns);
  const columns = colNames
    .map(colName => {
      if (colName === "ID" || colName === "Basename") {
        return {
          key: colName,
          name: colName,
          editable: false,
          resizable: true,
          frozen: true,
          minWidth: colName === "ID" ? 50 : 300,
          formatter: ({ row, column }: FormatterProps<BIDSRow>) => {
            const value = row[column.key as BIDSFieldNamesType];
            return <div style={{ paddingInline: "12px" }}>{`${value}`}</div>;
          },
          headerRenderer: BIDSDatagridHeader,
        } as Column<BIDSRow>;
        // ENUM columns
      } else if (BIDSEnumSet.has(colName as BIDSEnumFieldNamesType)) {
        const enumSchema = BIDSCompleteSchema[colName as BIDSEnumFieldNamesType];
        return {
          key: colName,
          name: enumSchema.colName,
          editable: true,
          resizable: true,
          width: 14 * enumSchema.colName.length,
          editor: SelectEditorFactory({
            options: enumSchema.enumOptions,
          }),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
          headerRenderer: BIDSDatagridHeader,
          // Formatter is necessary for Select due to discrepancy between the edit vs view states
          formatter: ({ row, column }: FormatterProps<BIDSRow>) => {
            const value = row[column.key as BIDSFieldNamesType];
            const enumSchema = BIDSCompleteSchema[column.key as BIDSEnumFieldNamesType];
            const displayValue = enumSchema.enumOptions.find(option => option.value === value);

            return <div style={{ paddingInline: "12px" }}>{displayValue.label}</div>;
          },
        } as Column<BIDSRow>;
        // NUMERICAL columns
      } else if (BIDSNumericalSet.has(colName as BIDSNumericalFieldNamesType)) {
        const numericalSchema = BIDSCompleteSchema[colName as BIDSNumericalFieldNamesType];
        return {
          key: colName,
          name: numericalSchema.colName,
          editable: true,
          resizable: true,
          width: 14 * numericalSchema.colName.length,
          editor: NumberEditorFactory({
            inputProps: {
              step: numericalSchema.step,
              min: numericalSchema.min,
              max: numericalSchema.max,
            },
          }),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
          headerRenderer: BIDSDatagridHeader,
          formatter: ({ row, column }: FormatterProps<BIDSRow>) => {
            const value = row[column.key as BIDSFieldNamesType];
            return <div style={{ paddingInline: "12px" }}>{`${value}`}</div>;
          },
        } as Column<BIDSRow>;
        // BOOLEAN columns
      } else if (BIDSBooleanSet.has(colName as BIDSBooleanFieldNamesType)) {
        const booleanSchema = BIDSCompleteSchema[colName as BIDSBooleanFieldNamesType];
        return {
          key: colName,
          name: booleanSchema.colName,
          editable: true,
          resizable: true,
          width: 14 * booleanSchema.colName.length,
          editor: BooleanEditorFactory({}),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
          headerRenderer: BIDSDatagridHeader,
          formatter: ({ row, column }: FormatterProps<BIDSRow>) => {
            const checked = !!row[column.key as BIDSFieldNamesType];
            return <Checkbox checked={checked} />;
          },
        } as Column<BIDSRow & { id: string }>;
        // TEXT columns
      } else if (BIDSTextSet.has(colName as BIDSTextFieldNamesType)) {
        const textSchema = BIDSCompleteSchema[colName as BIDSTextFieldNamesType];
        return {
          key: colName,
          name: textSchema.colName,
          editable: true,
          resizable: true,
          width: 14 * textSchema.colName.length,
          editor: TextEditorFactory({}),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
          headerRenderer: BIDSDatagridHeader,
          formatter: ({ row, column }: FormatterProps<BIDSRow>) => {
            const value = row[column.key as BIDSFieldNamesType];
            <div style={{ paddingInline: "12px" }}>{`${value}`}</div>;
          },
        } as Column<BIDSRow>;
      } else {
        // Other columns like "File" are skipped but in the background are retained in the dataframe
        return {} as Column<BIDSRow>;
      }
    })
    .filter(col => !lodashIsEmpty(col));

  return columns;
});

import CancelIcon from "@mui/icons-material/Cancel";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { DataFrame, Series } from "data-forge";
import { atom, useSetAtom } from "jotai";
import { isEmpty as lodashIsEmpty, range as lodashRange, sortBy as lodashSortBy } from "lodash";
import React from "react";
import { CalculatedColumn, Column, FormatterProps } from "react-data-grid";
import {
  BIDSBooleanSet,
  BIDSCompleteSchema,
  BIDSEnumSet,
  BIDSFieldNames,
  BIDSNumericalSet,
  BIDSTextSet,
} from "../common/schemas/BIDSDatagridConfigurationSchemas";
import {
  BIDSBooleanFieldNamesType,
  BIDSColumnName,
  BIDSEnumFieldNamesType,
  BIDSFieldNamesType,
  BIDSNumericalFieldNamesType,
  BIDSRow,
  BIDSTextFieldNamesType,
} from "../common/types/BIDSDatagridTypes";
import {
  BooleanEditorFactory,
  NumberEditorFactory,
  SelectEditorFactory,
  TextEditorFactory,
} from "../pages/BIDSDatagrid/EditorFactories";

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
export const atomBIDSStudyRootPath = atom<string>("");

/**
 * Atom that holds the loaded ASL BIDS data.
 */
export const atomBIDSDataframe = atom<DataFrame>(new DataFrame());

export const atomFetchDataframe = atom(null, async (get, set, StudyRootPath: string) => {
  const { api } = window;

  const parseSingleJSON = async (jsonPath: string, basename: string, jsonIndex: number) => {
    const { error, payload } = await api.path.readJSONSafe(jsonPath);
    if (error) return {};
    const data = Object.entries(payload).reduce(
      (acc, [key, value]) => {
        // We filter out keys that are not in the BIDSFieldNames in order to avoid adding extra overhead to processing
        // the datagrid when it comes to enormous studies.
        if (!BIDSFieldNames.includes(key as BIDSFieldNamesType)) return acc;
        acc[key] = value;
        return acc;
      },
      { ID: jsonIndex, Basename: basename, File: jsonPath } as Record<string, unknown>
    );
    // console.log(`BIDSDataGrid: ParsedDataFor ${jsonPath}`, data);
    return data;
  };

  // Sanity check -- must be a valid BIDS study root path
  if (!StudyRootPath || !((await api.path.getFilepathType(StudyRootPath)) === "dir")) return;

  // Get the ASL json files
  let jsonPaths = await api.path.glob(`${StudyRootPath}/rawdata`, "/**/*asl.json", { onlyFiles: true });
  if (jsonPaths.length === 0) return;
  jsonPaths = lodashSortBy(jsonPaths, "path"); // Globing order not guaranteed, so sort by path

  // Load in the JSON contents & parse into a dataframe
  const rawJSONs = await Promise.all(
    jsonPaths.map(async (jsonPath, jsonIndex) => parseSingleJSON(jsonPath.path, jsonPath.basename, jsonIndex))
  );
  const filteredJSONs = rawJSONs.filter(json => !lodashIsEmpty(json));
  if (filteredJSONs.length === 0) return;
  const newDF = new DataFrame(filteredJSONs);

  // Set the dataframe and columns; also re-set the currently-selected cell
  console.log(`BIDSDataGrid: Fetched new DataFrame:`, newDF.toString());
  set(atomBIDSDataframe, newDF);
  set(atomDataframeColumns, newDF.getColumnNames() as BIDSColumnName[]);
});

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

/**
 * Setter atom for setting specific values in the dataframe to `undefined`. This is necessary to allow certain
 * exclusionary BIDS fields to not appear in exported files.
 */
export const atomDeleteDataframeCell = atom(
  null,
  (get, set, { cellRow, cellCol }: { cellRow: number; cellCol: BIDSColumnName }) => {
    const currentDF = get(atomBIDSDataframe);
    if (cellRow > currentDF.count() - 1 || !currentDF.hasSeries(cellCol)) return;

    console.log(`atomDeleteDataframeCell:`, { cellRow, cellCol });

    const newDF = new DataFrame(
      currentDF
        .withSeries({
          [cellCol]: currentDF.getSeries(cellCol).map((val, rowIdx) => (rowIdx === cellRow ? undefined : val)),
        })
        .toArray()
    );
    set(atomBIDSDataframe, newDF);
  }
);

export const atomAddColumnDialogOpen = atom<boolean>(false);

/**
 * Separate atom for the columns of the dataframe. This reduces re-renders when cells are edited.
 */
export const atomDataframeColumns = atom<BIDSColumnName[]>([]);

/**
 * Derived atom for setting the `columns` prop for `DataGrid`. This is an array of `Column` objects that describe the
 * configuration of the columns in the dataframe.
 */
export const atomRDGColumnConfigs = atom<Column<BIDSRow>[]>(get => {
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
            if (value === undefined) return <div />;
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
            if (value === undefined) return <div />;

            const enumSchema = BIDSCompleteSchema[column.key as BIDSEnumFieldNamesType];
            const displayValue = enumSchema.enumOptions.find(option => option.value === value);

            // console.log(`enumFormatter:`, {
            //   value,
            //   row,
            //   displayValue,
            // });

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
            if (value === undefined) return <div />;
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
            const value = row[column.key as BIDSFieldNamesType];
            if (value === undefined) return <div />;
            return <Checkbox checked={!!value} />;
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
            if (value === undefined) return <div />;
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

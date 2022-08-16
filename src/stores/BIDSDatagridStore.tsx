import React from "react";
import { atom } from "jotai";
import { DataFrame } from "data-forge";
import {
  BIDSBooleanFieldNamesType,
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
} from "../common/schemas/BIDSDatagridSchema";
import { Column, FormatterProps } from "react-data-grid";
import {
  BooleanEditorFactory,
  NumberEditorFactory,
  SelectEditorFactory,
  TextEditorFactory,
} from "../pages/BIDSDatagrid/EditorFactories";
import Checkbox from "@mui/material/Checkbox";
import { isEmpty } from "lodash";

/**
 * Atom that holds the StudyRootPath for the BIDS json files that will be loaded in by globbing.
 */
export const atomBIDSStudyRootPath = atom<string>("");

/**
 * Atom that holds the loaded ASL BIDS data.
 */
export const atomBIDSDataframe = atom<DataFrame>(new DataFrame());

export const atomBIDSData = atom<BIDSRow[]>(get => {
  const dataframe = get(atomBIDSDataframe);
  return dataframe.toArray();
});

/**
 * Atom that holds the drawer cards for mapping a single value to all cells of a column.
 */
export const atomBIDSMapValues = atom<Partial<typeof BIDSCompleteSchema>[]>([]);

export const atomRDGColumns = atom<Column<BIDSRow & { id: string }>[]>(get => {
  const df = get(atomBIDSDataframe);
  const colNames = df.getColumnNames() as Array<BIDSFieldNamesType | "ID" | "File" | "Basename">;

  const columns = colNames
    .map(colName => {
      if (colName === "ID" || colName === "Basename") {
        return {
          key: colName,
          name: colName,
          editable: false,
          resizable: true,
          frozen: true,
          width: colName === "ID" ? 50 : 300,
        } as Column<BIDSRow & { id: string }>;
      } else if (BIDSEnumSet.has(colName as BIDSEnumFieldNamesType)) {
        const enumSchema = BIDSCompleteSchema[colName as BIDSEnumFieldNamesType];
        return {
          key: colName,
          name: enumSchema.colName,
          editable: true,
          resizable: true,
          width: 12 * enumSchema.colName.length,
          editor: SelectEditorFactory({
            options: enumSchema.enumOptions,
          }),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
        } as Column<BIDSRow & { id: string }>;
      } else if (BIDSNumericalSet.has(colName as BIDSNumericalFieldNamesType)) {
        const numericalSchema = BIDSCompleteSchema[colName as BIDSNumericalFieldNamesType];
        return {
          key: colName,
          name: numericalSchema.colName,
          editable: true,
          resizable: true,
          width: 12 * numericalSchema.colName.length,
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
        } as Column<BIDSRow & { id: string }>;
      } else if (BIDSBooleanSet.has(colName as BIDSBooleanFieldNamesType)) {
        const booleanSchema = BIDSCompleteSchema[colName as BIDSBooleanFieldNamesType];
        return {
          key: colName,
          name: booleanSchema.colName,
          editable: true,
          resizable: true,
          width: 12 * booleanSchema.colName.length,
          editor: BooleanEditorFactory({}),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
          formatter: ({ row, column }: FormatterProps<BIDSRow>) => {
            const checked = !!row[column.key as BIDSFieldNamesType];
            return <Checkbox checked={checked} />;
          },
        } as Column<BIDSRow & { id: string }>;
      } else if (BIDSTextSet.has(colName as BIDSTextFieldNamesType)) {
        const textSchema = BIDSCompleteSchema[colName as BIDSTextFieldNamesType];
        return {
          key: colName,
          name: textSchema.colName,
          editable: true,
          resizable: true,
          width: 12 * textSchema.colName.length,
          editor: TextEditorFactory({}),
          editorOptions: {
            commitOnOutsideClick: true,
            editOnClick: true,
          },
        } as Column<BIDSRow & { id: string }>;
      } else {
        return {} as Column<BIDSRow & { id: string }>;
      }
    })
    .filter(col => !isEmpty(col));

  return columns;
});

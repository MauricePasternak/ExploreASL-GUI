import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import React from "react";
import { EditorProps } from "react-data-grid";

export type TextEditorFactoryProps = Omit<TextFieldProps, "onChange" | "onBlur" | "inputRef" | "value">;

export function TextEditorFactory<Row = any>({ ...props }: TextEditorFactoryProps) {
  return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
    return (
      <TextField
        variant="outlined"
        fullWidth
        {...props}
        value={row[column.key as keyof typeof row]}
        onChange={event => onRowChange({ ...row, [column.key]: event.target.value })}
        onBlur={() => onClose(true)}
        inputRef={input => {
          input?.focus();
        }}
      />
    );
  };
}

export type NumberEditorFactoryProps = Omit<TextFieldProps, "onChange" | "onBlur" | "inputRef" | "value">;

export function NumberEditorFactory<Row = any>({ ...props }: NumberEditorFactoryProps) {
  return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
    return (
      <TextField
        variant="outlined"
        fullWidth
        {...props}
        type="number"
        value={row[column.key as keyof typeof row]}
        onChange={event => onRowChange({ ...row, [column.key]: event.target.value })}
        onBlur={() => onClose(true)}
        inputRef={input => {
          input?.focus();
        }}
      />
    );
  };
}

export type BooleanEditorFactoryProps = Omit<CheckboxProps, "onChange" | "onBlur" | "inputRef" | "value" | "checked">;

export function BooleanEditorFactory<Row = any>({ ...props }: BooleanEditorFactoryProps) {
  return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
    return (
      <FormControlLabel
        label=""
        sx={{ paddingInline: theme => theme.spacing(2.4) }}
        control={
          <Checkbox
            {...props}
            value={row[column.key as keyof typeof row]}
            checked={!!row[column.key as keyof typeof row]}
            onChange={(e, checked) => onRowChange({ ...row, [column.key]: checked })}
            onBlur={() => onClose(true)}
            inputRef={input => {
              input?.focus();
            }}
          />
        }
      />
    );
  };
}

export type SelectEditorFactoryProps = Omit<TextFieldProps, "onChange" | "onBlur" | "inputRef" | "value" | "select"> & {
  options: { value: string; label: string }[];
};

export function SelectEditorFactory<Row = any>({ ...props }: SelectEditorFactoryProps) {
  const { options, ...rest } = props;
  return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
    return (
      <TextField
        variant="outlined"
        fullWidth
        select
        {...rest}
        value={row[column.key as keyof typeof row]}
        onChange={event => onRowChange({ ...row, [column.key]: event.target.value })}
        onBlur={() => onClose(true)}
        inputRef={input => {
          input?.focus();
        }}
      >
        {options.map(({ value, label }) => (
          <MenuItem key={`SelectEditor__${column.key}_${label}`} value={value}>
            {label}
          </MenuItem>
        ))}
      </TextField>
    );
  };
}

import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import React from "react";
import { EditorProps } from "react-data-grid";
import { BIDSRow } from "../../common/types/BIDSDatagridTypes";

export type TextEditorFactoryProps = Omit<TextFieldProps, "onChange" | "onBlur" | "inputRef" | "value">;
export type NumberEditorFactoryProps = Omit<TextFieldProps, "onChange" | "onBlur" | "inputRef" | "value" | "type">;
export type BooleanEditorFactoryProps = Omit<CheckboxProps, "onChange" | "onBlur" | "inputRef" | "value" | "checked">;
export type SelectEditorFactoryProps = Omit<TextFieldProps, "onChange" | "onBlur" | "inputRef" | "value" | "select"> & {
	options: { value: string; label: string }[];
};

/**
 * HOC for creating a TextField component to render as the editor of a cell in React Data Grid.
 * Accepts all ancillary props that a TextField component accepts.
 */
export function TextEditorFactory<Row = any>({ ...props }: TextEditorFactoryProps) {
	return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
		return (
			<TextField
				variant="outlined"
				fullWidth
				{...props}
				value={row[column.key as keyof typeof row]}
				onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value })}
				onBlur={() => onClose(true)}
				inputRef={(input) => {
					input?.focus();
				}}
			/>
		);
	};
}

/**
 * HOC for creating a numerical TextField component to render as the editor of a cell in React Data Grid.
 * Accepts all ancillary props that a TextField component accepts but does not allow for overwriting the type.
 * TODO - Needs support for a filter function that will determine whether the field should auto-format as a number array
 */
export function NumberEditorFactory<Row extends BIDSRow = any>({ ...props }: NumberEditorFactoryProps) {
	return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
		const value = row[column.key as keyof typeof row];
		return (
			<TextField
				variant="outlined"
				fullWidth
				{...props}
				type="number"
				value={value}
				onChange={(event) => onRowChange({ ...row, [column.key]: Number(event.target.value) })}
				onBlur={() => onClose(true)}
				inputRef={(input) => {
					input?.focus();
				}}
			/>
		);
	};
}

export function BooleanEditorFactory<Row = any>({ ...props }: BooleanEditorFactoryProps) {
	return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
		return (
			<FormControlLabel
				label=""
				sx={{ paddingInline: (theme) => theme.spacing(2.4) }}
				control={
					<Checkbox
						{...props}
						value={row[column.key as keyof typeof row]}
						checked={!!row[column.key as keyof typeof row]}
						onChange={(e, checked) => onRowChange({ ...row, [column.key]: checked })}
						onBlur={() => onClose(true)}
						inputRef={(input) => {
							input?.focus();
						}}
					/>
				}
			/>
		);
	};
}

export function SelectEditorFactory<Row = any>({ ...props }: SelectEditorFactoryProps) {
	const { options, ...rest } = props;
	return ({ row, column, onRowChange, onClose }: EditorProps<Row>) => {
		const value = row[column.key as keyof typeof row];
		return (
			<TextField
				variant="outlined"
				fullWidth
				{...rest}
				select
				value={value}
				onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value })}
				onBlur={() => onClose(true)}
				inputRef={(input) => {
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

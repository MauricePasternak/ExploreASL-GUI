import InputBase, { InputBaseProps } from "@mui/material/InputBase";
import { GridRenderEditCellParams, GridValidRowModel, useGridApiContext } from "@mui/x-data-grid";
import { isUndefined as lodashIsUndefined } from "lodash";
import React, { useEffect } from "react";
import { BIDSRow } from "../BIDSColumnDefs";

type BIDSSingleNumberFieldProps<TRow extends GridValidRowModel = BIDSRow> = {
	defaultValue: number;
	params: GridRenderEditCellParams<any, TRow>;
} & Omit<InputBaseProps, "value" | "onChange" | "type">;

export function BIDSSingleNumberField<TRow extends GridValidRowModel = BIDSRow>({
	defaultValue,
	params,
	...inputProps
}: BIDSSingleNumberFieldProps<TRow>) {
	const { value, field, id } = params;
	const apiRef = useGridApiContext();
	const [innerValue, setInnerValue] = React.useState(value);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = Number(event.target.value);
		apiRef.current.setEditCellValue({ id, field, value: newValue, debounceMs: 2000 });
		setInnerValue(newValue);
	};

	// ^ This useEffect will run when the cell is focused; it will set the value to the default value if the value is
	// ^ undefined
	useEffect(() => {
		if (lodashIsUndefined(value)) {
			console.log("🚀 ~ file: BIDSSingleNumberField.tsx:31 ~ useEffect ~ value", value);
			setInnerValue(defaultValue);
			apiRef.current.setEditCellValue({ id, field, value: defaultValue, debounceMs: 2000 });
		}
	}, [value]);

	// * Hack to get around the possibility that the value is undefined due to a Delete keypress
	if (lodashIsUndefined(innerValue)) {
		return (
			<InputBase
				fullWidth
				sx={{ paddingX: 1 }}
				{...inputProps}
				value={defaultValue}
				onChange={handleChange}
				type="number"
			/>
		);
	} else {
		return (
			<InputBase
				fullWidth
				sx={{ paddingX: 1 }}
				{...inputProps}
				value={innerValue}
				onChange={handleChange}
				type="number"
			/>
		);
	}
}

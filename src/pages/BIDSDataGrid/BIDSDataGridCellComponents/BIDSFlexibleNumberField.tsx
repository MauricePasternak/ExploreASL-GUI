import React from "react";
import { GridRenderEditCellParams, GridValidRowModel, useGridApiContext } from "@mui/x-data-grid";
import { isUndefined as lodashIsUndefined, range as lodashRange } from "lodash";
import { DebouncedBaseInput } from "../../../components/DebouncedComponents";
import { MultiNumericInput } from "./MultiNumericInput";

export function switchBIDSNumericType(
	currentValue: number | number[] | undefined,
	shouldSwitchToMulti: boolean,
	numberFieldsWhenMulti: number,
	defaultValue: number
) {
	// Must handle 3 types: number | number[] | undefined
	if (lodashIsUndefined(currentValue)) {
		currentValue = shouldSwitchToMulti ? lodashRange(numberFieldsWhenMulti).map(() => defaultValue) : defaultValue;
	}
	// Value is not undefined; therefore either number or number[]; must handle cases where a switch is necessary
	else {
		// Case 1: switch from single to multi; pad with default values
		if (shouldSwitchToMulti && !Array.isArray(currentValue)) {
			const foo = currentValue;
			currentValue = [foo, ...lodashRange(numberFieldsWhenMulti - 1).map(() => defaultValue)];
		}
		// Case 2: switch from multi to single; take first value
		else if (!shouldSwitchToMulti && Array.isArray(currentValue)) {
			currentValue = currentValue[0];
		}
	}
	return currentValue;
}

type BIDSFlexibleNumberFieldProps<R extends GridValidRowModel = any> = {
	shouldRenderMultiNumeric: (params: GridRenderEditCellParams<any, R>) => boolean;
	numberFieldsWhenMulti: number;
	defaultValue: number;
	min: number;
	max: number;
	step: number;
} & GridRenderEditCellParams<any, R>;

export function BIDSFlexibleNumberField<R extends GridValidRowModel = any>({
	shouldRenderMultiNumeric,
	numberFieldsWhenMulti,
	defaultValue,
	min,
	max,
	step,
	...params
}: BIDSFlexibleNumberFieldProps<R>) {
	const apiRef = useGridApiContext();

	const shouldRenderMulti = shouldRenderMultiNumeric(params);
	console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:46 ~ shouldRenderMulti", shouldRenderMulti);

	const currentValue = switchBIDSNumericType(params.value, shouldRenderMulti, numberFieldsWhenMulti, defaultValue);
	console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:47 ~ currentValue", currentValue);

	const handleMultiNumericChange = (newValue: number[]) => {
		console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:52 ~ handleMultiNumericChange ~ newValue", newValue);
		apiRef.current.setEditCellValue({ id: params.id, field: params.field, value: newValue, debounceMs: 400 });
	};

	const handleSingleNumericChange = (newValue: number) => {
		console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:56 ~ handleSingleNumericChange ~ newValue", newValue);
		apiRef.current.setEditCellValue({ id: params.id, field: params.field, value: newValue });
	};

	return Array.isArray(currentValue) ? (
		<MultiNumericInput
			inputProps={{ min: min, max: max, step: step }}
			value={currentValue}
			onChange={handleMultiNumericChange}
			debounceTime={0}
		/>
	) : (
		<DebouncedBaseInput
			fullWidth
			type="number"
			value={currentValue}
			inputProps={{ min: min, max: max, step: step }}
			onChange={(e) => handleSingleNumericChange(Number(e.target.value))}
		/>
	);
}

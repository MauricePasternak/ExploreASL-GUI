import React from "react";
import { getNumbersFromDelimitedString } from "../../common/utils/stringFunctions";
import { DebouncedBaseInput, DebouncedBaseInputProps } from "./DebouncedBaseInput";
import { DebouncedInput, DebouncedInputProps } from "./DebouncedInput";

type DebouncedNumericCSVBaseInputProps = Omit<DebouncedBaseInputProps, "onChange" | "value"> & {
	value: number[] | number;
	onChange: (newValue: number[]) => void;
	shouldSort?: boolean;
	uniqueOnly?: boolean;
};

export function DebouncedNumericCSVBaseInput({
	value,
	onChange,
	shouldSort = true,
	uniqueOnly = false,
	...rest
}: DebouncedNumericCSVBaseInputProps) {
	const asStringCSVs = Array.isArray(value) ? value.join(", ") : value.toString();

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const rawStringValue = event.target.value;
		const numericValues = getNumbersFromDelimitedString(rawStringValue, { sort: shouldSort, unique: uniqueOnly });
		onChange(numericValues);
	};

	console.log("🚀 ~ file: DebouncedNumericCSVBaseInput ~ asStringCSVs", asStringCSVs);
	return <DebouncedBaseInput {...rest} value={asStringCSVs} onChange={handleChange} />;
}

type DebouncedNumericCSVInputProps = Omit<DebouncedInputProps, "onChange" | "value"> & {
	value: number[] | number;
	onChange: (newValue: number[]) => void;
	shouldSort?: boolean;
	uniqueOnly?: boolean;
};

export function DebouncedNumericCSVInput({
	value,
	onChange,
	shouldSort = true,
	uniqueOnly = false,
	...rest
}: DebouncedNumericCSVInputProps) {
	const asStringCSVs = Array.isArray(value) ? value.join(", ") : value.toString();

	const handleChange = (rawStringValue: string) => {
		const numericValues = getNumbersFromDelimitedString(rawStringValue, { sort: shouldSort, unique: uniqueOnly });
		onChange(numericValues);
	};

	console.log("🚀 ~ file: DebouncedNumericCSVInput ~ asStringCSVs", asStringCSVs);

	return <DebouncedInput {...rest} value={asStringCSVs} onChange={handleChange} />;
}

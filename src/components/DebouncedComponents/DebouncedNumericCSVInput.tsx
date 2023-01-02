import React from "react";
import { getNumbersFromDelimitedString } from "../../common/utils/stringFunctions";
import { DebouncedBaseInput, DebouncedBaseInputProps } from "./DebouncedBaseInput";
import { DebouncedInput, DebouncedInputProps } from "./DebouncedInput";

type DebouncedNumericCSVBaseInputProps = Omit<DebouncedBaseInputProps, "onChange" | "value"> & {
	value: number[] | number;
	onChange: (newValue: number[]) => void;
};

export function DebouncedNumericCSVBaseInput(props: DebouncedNumericCSVBaseInputProps) {
	const { value, onChange, ...rest } = props;
	const asStringCSVs = Array.isArray(value) ? value.join(", ") : value.toString();

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const rawStringValue = event.target.value;
		const numericValues = getNumbersFromDelimitedString(rawStringValue);
		onChange(numericValues);
	};

	console.log("🚀 ~ file: DebouncedNumericCSVBaseInput ~ asStringCSVs", asStringCSVs);

	return <DebouncedBaseInput {...rest} value={asStringCSVs} onChange={handleChange} />;
}

type DebouncedNumericCSVInputProps = Omit<DebouncedInputProps, "onChange" | "value"> & {
	value: number[] | number;
	onChange: (newValue: number[]) => void;
};

export function DebouncedNumericCSVInput(props: DebouncedNumericCSVInputProps) {
	const { value, onChange, ...rest } = props;
	const asStringCSVs = Array.isArray(value) ? value.join(", ") : value.toString();

	const handleChange = (rawStringValue: string) => {
		const numericValues = getNumbersFromDelimitedString(rawStringValue);
		onChange(numericValues);
	};

	console.log("🚀 ~ file: DebouncedNumericCSVInput ~ asStringCSVs", asStringCSVs);

	return <DebouncedInput {...rest} value={asStringCSVs} onChange={handleChange} />;
}

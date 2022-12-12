import Box, { BoxProps } from "@mui/material/Box";
import React from "react";
import {
	DebouncedBaseInput,
	DebouncedBaseInputProps,
} from "../../../components/DebouncedComponents";

type MultiNumericInputProps = {
	value: number[];
	onChange: (value: number[], ...args: unknown[]) => void;
	boxProps?: BoxProps;
} & Omit<DebouncedBaseInputProps, "value" | "onChange">;

export function MultiNumericInput({ value, onChange, boxProps, ...inputProps }: MultiNumericInputProps) {
	const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, index: number) => {
		const newValue = value.map((v, i) => (i === index ? Number(event.target.value) : v));
		onChange(newValue);
	};

	return (
		<Box display="flex" {...boxProps}>
			{value.map((v, i) => (
				<DebouncedBaseInput
					key={`DebouncedBaseInput_${i}`}
					className={`DebouncedBaseInput`}
					type="number"
					value={v}
					onChange={(event) => handleChange(event, i)}
					{...inputProps}
				/>
			))}
		</Box>
	);
}

import React from "react";
import InputBase, { InputBaseProps } from "@mui/material/InputBase";
import { useCallback, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

export type DebouncedBaseInputProps = {
	debounceTime?: number;
} & InputBaseProps;

/**
 * Material UI InputBase component that debounces the onChange event
 */
export function DebouncedBaseInput({
	value,
	onChange,
	debounceTime = 500,
	...inputBaseProps
}: DebouncedBaseInputProps) {
	// Component State
	const [innerValue, setInnerValue] = useState(value ?? "");

	// Keep in sync with parent components
	useEffect(() => {
		if (value === innerValue) return;
		setInnerValue(value);
	}, [value]);

	// Define an onChange handler that propagates the event to the parent component
	// then create the debounced version of that handler for the component
	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const newValue = event.target.value;
			// console.log("🚀 ~ file: DebouncedBaseInput.tsx:31 ~ handleChange ~ newValue", newValue);
			setInnerValue(newValue);
			onChange && debouncedHandleChange(event);
		},
		[onChange]
	);
	const debouncedHandleChange = useDebouncedCallback(onChange!, debounceTime);
	return <InputBase sx={{ paddingX: 1 }} fullWidth {...inputBaseProps} value={innerValue} onChange={handleChange} />;
}

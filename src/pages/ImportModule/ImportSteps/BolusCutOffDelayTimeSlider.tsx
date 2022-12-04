import React from "react";
import { Control, Controller, UseFormSetValue, useWatch } from "react-hook-form";
import { DebouncedSlider } from "../../../components/DebouncedComponents";
import { ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
import { parseFieldError } from "../../../common/utilityFunctions/formFunctions";

interface BolusCutOffDelayTimeSliderProps {
	control: Control<ImportSchemaType>;
	contextIndex: number;
	setFieldValue: UseFormSetValue<ImportSchemaType>;
}

/**
 * Necessary wrapper around the BolusCutOffDelayTime field in the Import Module due to its more complex behavior
 * in responding to other fields changing.
 */
export function BolusCutOffDelayTimeSlider({ control, contextIndex, setFieldValue }: BolusCutOffDelayTimeSliderProps) {
	const [BolusCutOffTechnique, BolusCutOffDelayTime] = useWatch({
		control,
		name: [
			`ImportContexts.${contextIndex}.BolusCutOffTechnique`,
			`ImportContexts.${contextIndex}.BolusCutOffDelayTime`,
		],
	});

	if (BolusCutOffTechnique === "Q2TIPS" && !Array.isArray(BolusCutOffDelayTime)) {
		setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffDelayTime`, [0, BolusCutOffDelayTime]);
	} else if (BolusCutOffTechnique !== "Q2TIPS" && Array.isArray(BolusCutOffDelayTime)) {
		setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffDelayTime`, BolusCutOffDelayTime[1]);
	}

	console.log(
		`BolusCutOffDelayTimeSlider from context ${contextIndex} will render children with the following settings:`,
		JSON.stringify({ BolusCutOffTechnique, BolusCutOffDelayTime }, null, 2)
	);

	return (
		<Controller
			control={control}
			name={`ImportContexts.${contextIndex}.BolusCutOffDelayTime` as const}
			render={({ field, fieldState }) => {
				const hasError = !!fieldState.error;
				const errorMessage = hasError ? parseFieldError(fieldState.error) : "";
				const { ref, ...fieldRemainer } = field;
				return (
					<DebouncedSlider
						{...fieldRemainer}
						label={"Bolus Cut-Off Delay Time"}
						error={hasError}
						errorMessage={errorMessage}
						renderTextfields
						min={0}
						max={3}
						step={0.001}
						textFieldProps={{ sx: { minWidth: 100 }, inputRef: ref }}
					/>
				);
			}}
		/>
	);
}

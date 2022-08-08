import React, { useEffect, useState } from "react";
import Slider, { SliderProps } from "@mui/material/Slider";
import { Controller, FieldValues, Path } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import {
  RHFFieldAndFieldStateType,
  RHFControlAndNameType,
  RHFInterDepBaseProps,
  RHFTriggerType,
} from "../../common/types/formTypes";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Box from "@mui/material/Box";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import FastIsEqual from "fast-deep-equal";

type InterDepControlledSliderBaseProps = {
  label?: string;
  helperText?: string;
  renderTextfields?: boolean;
  textFieldProps?: Omit<TextFieldProps, "value" | "onChange" | "onBlur" | "error" | "inputProps" | "type">;
  debounceTime?: number;
  formControlProps?: Omit<FormControlProps, "error">;
};

// To avoid conflict with the "field" prop coming from the Controller render
type RestrictedSliderProps = Omit<SliderProps, "value" | "onChange" | "onBlur" | "onChangeCommitted" | "name">;

type InterDepControlledSliderProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFFieldAndFieldStateType<TValues, TName> & // field and fieldState
  RHFTriggerType<TValues, TName> & // trigger and triggerTarget
  InterDepControlledSliderBaseProps &
  RestrictedSliderProps;

type InterDepControlledSliderPropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<InterDepControlledSliderProps<TValues, TName>, "field" | "fieldState">;

export type RHFInterDepSliderProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFInterDepBaseProps<TValues, TName> & InterDepControlledSliderPropsNoField<TValues, TName>;

function InterDepControlledSlider<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  trigger,
  triggerTarget,
  label,
  helperText,
  renderTextfields,
  textFieldProps,
  debounceTime = 500,
  formControlProps,
  ...sliderProps
}: InterDepControlledSliderProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";
  const [innerVal, setInnerVal] = useState<number | number[]>(field.value);

  /**
   * useEffect handler for responding to external changes to `field.value`
   * 1) Updates the internal value if it doesn't match field.value
   * 2) Triggers the validation of other fields
   */
  useEffect(() => {
    if (FastIsEqual(field.value, innerVal)) return;

    // Update self and trigger target validation
    console.log(`InterdepSlider ${field.name} is syncing with field.value and triggering ${triggerTarget}`);
    setInnerVal(field.value);
    trigger(triggerTarget);
  }, [field.value]);

  /**
   * Debounced callback for updating the field.value and triggering validation in targets
   */
  const debouncedHandleChange = useDebouncedCallback((values: any) => {
    field.onChange(values);
    trigger(triggerTarget);
  }, debounceTime);

  /**
   * Handles the change event of the slider. Updates the internal value and calls the debounced onChange callback.
   * @param values The values to be set on the field
   */
  function handleChange(values: number | number[]) {
    setInnerVal(values);
    debouncedHandleChange(values);
  }

  const handleRenderTextfields = () =>
    Array.isArray(innerVal) ? (
      // If innerVal is an array of numbers
      innerVal.map((val, idx) => (
        <TextField
          key={`RHFInterDepSliderTextfield_${idx}_${field.name}`}
          variant={textFieldProps?.variant}
          {...textFieldProps}
          onChange={textEvent => {
            handleChange(innerVal.map((v, i) => (i === idx ? Number(textEvent.target.value) : v)));
          }}
          error={hasError}
          value={val}
          inputProps={{ min: sliderProps.min ?? 0, max: sliderProps.max ?? 100, step: sliderProps.step ?? 1 }}
          type="number"
        />
      ))
    ) : (
      // If innerVal is a number
      <TextField
        variant={textFieldProps?.variant}
        {...textFieldProps}
        onChange={textEvent => handleChange(Number(textEvent.target.value))}
        error={hasError}
        value={innerVal}
        onBlur={field.onBlur}
        inputProps={{ min: sliderProps.min ?? 0, max: sliderProps.max ?? 100, step: sliderProps.step ?? 1 }}
        type="number"
      />
    );

  return (
    <FormControl fullWidth variant="standard" {...formControlProps} error={hasError}>
      <FormLabel>{label}</FormLabel>
      <Box display="flex" gap={1} alignItems="center">
        <Slider
          sx={{ color: hasError ? "error.main" : "default" }}
          {...sliderProps}
          value={innerVal}
          onChange={(_, values) => handleChange(values)}
          name={field.name}
          onBlur={field.onBlur}
        />
        {renderTextfields && handleRenderTextfields()}
      </Box>
      {helperText && <FormHelperText error={hasError}>{helperText}</FormHelperText>}
      {hasError && <FormHelperText error={true}>{errorMessage}</FormHelperText>}
    </FormControl>
  );
}

/**
 * A Material UI Slider under the control of RHF. This component triggers the validation of other fields.
 *
 * Fundamental Properties:
 * - `control` - the RHF control object returned by useForm().
 * - `name` - the name of the field this component is responsible for.
 * - `trigger` - the RHF trigger function returned by useForm().
 * - `triggerTarget` - the name of the field(s) to trigger validation on when this form changes.
 * ---
 *
 * Additional Properties:
 * - `label` - The label to put above the slider, as it is wrapped by a `FormControl`
 * - `helperText` - The helper text given to explain the slider's purpose
 * - `renderTextfields` - Whether to render a textfields next to the slider.
 * - `textFieldProps` - The props to pass to the textfields if they are rendered. Note that the following props are
 * disallowed: `value`, `onChange`, `onBlur`, `error`, `inputProps`, `type`
 * - `debounceTime` - The time to wait before calling the onChange callback.
 * - `formControlProps` - The props to pass to the wrapping `FormControl`. By default the `FormControl` is fullWidth and the `variant` is set to "standard". Cannot override the `error` property
 * ---
 * @note Due to this component being controlled by a React Hook Form Controller, the following props are disallowed,
 * as they are handled by the controller:
 * - `value`
 * - `onChange`
 * - `onBlur`
 * - `onChangeCommitted`
 * - `name`
 */
function RHFInterDepSlider<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...InterDepcontrolledSliderProps
}: RHFInterDepSliderProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <InterDepControlledSlider field={field} fieldState={fieldState} {...InterDepcontrolledSliderProps} />;
      }}
    />
  );
}

export default RHFInterDepSlider;

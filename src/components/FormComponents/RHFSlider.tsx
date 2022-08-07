import React, { useEffect, useState } from "react";
import Slider, { SliderProps } from "@mui/material/Slider";
import { Controller, FieldValues, Path } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { ControllerFieldPropType, UseControllerPropsBaseType } from "../../common/types/formTypes";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Box from "@mui/material/Box";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import FastIsEqual from "fast-deep-equal";

type ControlledSliderBaseProps = {
  label?: string;
  helperText?: string;
  renderTextfields?: boolean;
  textFieldProps?: Omit<TextFieldProps, "value" | "onChange" | "onBlur" | "error" | "inputProps" | "type">;
  debounceTime?: number;
  formControlProps?: Omit<FormControlProps, "error">;
};

// To avoid conflict with the "field" prop coming from the Controller render
type RestrictedSliderProps = Omit<SliderProps, "value" | "onChange" | "onBlur" | "onChangeCommitted" | "name">;

type ControlledSliderProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControllerFieldPropType<TValues, TName> & ControlledSliderBaseProps & RestrictedSliderProps;

type ControlledSliderPropsNoField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = Omit<
  ControlledSliderProps<TValues, TName>,
  "field" | "fieldState"
>;

export type RHFSliderProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = UseControllerPropsBaseType<TValues, TName> & ControlledSliderPropsNoField<TValues, TName>;

function ControlledSlider<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  label,
  helperText,
  renderTextfields,
  textFieldProps,
  debounceTime = 500,
  formControlProps,
  ...sliderProps
}: ControlledSliderProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";
  const [innerVal, setInnerVal] = useState<number | number[]>(field.value);

  /**
   * Necessary workaround for cases where a manual `reset` is called on the form.
   * This will force the slider to update.
   */
  useEffect(() => {
    if (!FastIsEqual(innerVal, field.value)) {
      setInnerVal(field.value);
    }
  }, [field.value]);

  const debouncedHandleChange = useDebouncedCallback(field.onChange, debounceTime);
  const handleChange = (values: number | number[]) => {
    setInnerVal(values);
    debouncedHandleChange(values);
  };

  const handleRenderTextfields = () =>
    Array.isArray(innerVal) ? (
      // If innerVal is an array of numbers
      innerVal.map((val, idx) => (
        <TextField
          key={`RHFSliderTextfield_${idx}_${field.name}`}
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
 * A Material UI Slider component that is controlled by a React Hook Form Controller. Contains most be the same props as
 * the Slider component, plus the following props:
 * @param label - The label to put above the slider, as it is wrapped by a `FormControl`
 * @param helperText - The helper text given to explain the slider's purpose
 * @param renderTextfields - Whether to render a textfields next to the slider.
 * @param textFieldProps - The props to pass to the textfields if they are rendered. Note that the following props are
 * disallowed: `value`, `onChange`, `onBlur`, `error`, `inputProps`, `type`
 * @param debounceTime - The time to wait before calling the onChange callback.
 * @param formControlProps - The props to pass to the wrapping `FormControl`. By default the `FormControl` is fullWidth and the `variant` is set to "standard". Cannot override the `error` property
 * ---
 * @note Due to this component being controlled by a React Hook Form Controller, the following props are disallowed,
 * as they are handled by the controller:
 * - `value`
 * - `onChange`
 * - `onBlur`
 * - `onChangeCommitted`
 * - `name`
 */
function RHFSlider<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...controlledSliderProps
}: RHFSliderProps<TValues, TName>) {
  // console.log("RHFSlider with name: ", name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledSlider field={field} fieldState={fieldState} {...controlledSliderProps} />;
      }}
    />
  );
}

export default RHFSlider;

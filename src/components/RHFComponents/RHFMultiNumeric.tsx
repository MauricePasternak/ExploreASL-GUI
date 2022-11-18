import Box, { BoxProps } from "@mui/material/Box";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import React from "react";
import { FieldValues, Path, useController, useWatch } from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import { DebouncedInput } from "../DebouncedComponents";

type MUIFormControlRestrictedProps = Omit<FormControlProps<"fieldset">, "error" | "component">;

type RHFMultiNumericBaseProps = {
  label?: React.ReactNode; // label to display next to the checkbox
  helperText?: React.ReactNode; // helper text to display below the checkbox
  flexWrapperProps?: BoxProps; // props to pass to the flex container holding the numeric inputs
  formControlProps?: MUIFormControlRestrictedProps; // props to pass to the form control wrapper
  min?: number; // minimum value for the numeric inputs
  max?: number; // maximum value for the numeric inputs
  step?: number; // step size for the numeric inputs
};

export type RHFMultiNumericProps<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
> = RHFMultiNumericBaseProps &
  RHFControllerProps<TFV, TName> & // name, control
  RHFWatchProps<TFV, TWatch> & // watchTarget & onWatchedChange
  RHFTriggerProps<TFV, TTrigger>; // trigger & triggerTarget

/**
 * A collection of MaterialUI numeric TextField components meant to be used in a react-hook-form context, specifically
 * for fields that require a tuple of numbers.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 *
 * ### RHF-related Optional Props
 * - `trigger`: The trigger function from react-hook-form, allowing changes to this component to trigger validation
 *    in other fields.
 * - `triggerTarget`: The fields whose validation should be triggered when this component changes.
 * - `watchTarget`: The fields whose values should be watched for changes which affect the rendering of this component.
 * - `onWatchedChange`: A callback function to be called when the watched fields change. Expected to return a boolean
 *    indicating whether the component should be rendered.
 *
 * ### Other Optional Props
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `label`: The field label to render for the component.
 * - `flexWrapperProps`: Props to apply to the Box component that acts as a flexbox container around the TextFields.
 * - `formControlProps`: Props to apply to the FormControl component that wraps the flexWrapper and other child
 *    components such as the label, helperText, etc.
 * - `min`: The minimum value that inputs should allow.
 * - `max`: The maximum value that inputs should allow.
 * - `step`: The step by which inputs should increment.
 */
export function RHFMultiNumeric<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
>({
  name,
  control,
  trigger,
  triggerTarget,
  watchTarget,
  onWatchedChange,
  label,
  helperText,
  flexWrapperProps,
  formControlProps,
  min = 0,
  max = 100,
  step = 1,
}: RHFMultiNumericProps<TFV, TName, TTrigger, TWatch>) {
  // RHF Variables
  const { field, fieldState } = useController({ name, control }); // get the field and fieldState from react-hook-form
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

  // Watch-related variables
  const isWatching = watchTarget && onWatchedChange;
  const watchParams = isWatching ? { control, name: watchTarget } : { control };
  const watchedValue = useWatch(watchParams);

  const handleChange = (value: string | number, index: number, currArr: number[]) => {
    const valAsNumber = typeof value === "string" ? Number(value) : value;
    const newValues = currArr.map((currVal, i) => (i === index ? valAsNumber : currVal));
    field.onChange(newValues);
    trigger && trigger(triggerTarget); // trigger the validation
  };

  // Sanity Check
  if (!Array.isArray(field.value)) {
    throw new Error(
      `RHFMultiNumeric with field name ${field.name} received an error: field value must be an array of numbers`
    );
  }

  function render() {
    return (
      <FormControl
        className="RHFMultiNumeric__FormControl"
        variant="standard"
        {...formControlProps}
        component="fieldset"
        error={hasError}
      >
        <FormLabel className="RHFMultiNumeric__FormLabel" component="legend">
          {label}
        </FormLabel>
        <Box
          className="RHFMultiNumeric__Box"
          display="flex"
          gap={1}
          flexDirection={{ xs: "column", sm: "row" }}
          {...flexWrapperProps}
        >
          {(field.value as number[]).map((value, index, arr) => (
            <DebouncedInput
              key={`${field.name}_${index}`}
              boxProps={{ flexGrow: 1 }}
              sx={{ flexGrow: 1 }}
              onBlur={field.onBlur}
              value={value}
              error={hasError}
              onChange={(v) => handleChange(v, index, arr)}
              type="number"
              InputProps={{ ref: field.ref }} // Remove the clear button to avoid conflict with its onClick
              inputProps={{ min, max, step }}
            />
          ))}
        </Box>
        {helperText && <FormHelperText className="RHFMultiNumeric__HelperText">{helperText}</FormHelperText>}
        {hasError && <FormHelperText className="RHFMultiNumeric__ErrorText">{errorMessage}</FormHelperText>}
      </FormControl>
    );
  }

  return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

import React from "react";
import { ControllerRenderProps, FieldValues, Path, useController, useWatch } from "react-hook-form";
import { parseFieldError } from "../../common/utils/formFunctions";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import { DebouncedSlider, DebouncedSliderProps } from "../DebouncedComponents";

export type RHFSliderProps<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
> = Omit<DebouncedSliderProps, keyof ControllerRenderProps | "onChangeCommitted"> &
  RHFControllerProps<TFV, TName> & // name & control
  RHFTriggerProps<TFV, TTrigger> & // trigger & triggerTarget
  RHFWatchProps<TFV, TWatch>; // watchTarget & onWatchChange

/**
 * Altered MaterialUI Slider component meant to be used in a react-hook-form context, specifically for fields that are
 * either a single number or an array of different numbers.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The react-hook-form control object.
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
 * - `formControlProps`: Props to pass to the wrapping FormControl component that wraps the child components such as the
 *    label, helperText, etc.
 * - `renderTextfields`: Whether or not to render the textfields that display the current value of the slider.
 *    Defaults to true.
 * - `textFieldProps`: Props to pass to the TextField components that are rendered when `renderTextfields` is true.
 * - `debounceTime`: The amount of time to wait before triggering the `onChange` callback. Defaults to 500 milliseconds.
 * - `...sliderProps`: All other props are passed to the underlying MaterialUI Slider component.
 */
export function RHFSlider<
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
  debounceTime = 500,
  renderTextfields = true,
  ...sliderProps
}: RHFSliderProps<TFV, TName, TTrigger, TWatch>) {
  // RHF Variables
  const { field, fieldState } = useController({ name, control }); // field & fieldState
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? parseFieldError(fieldState.error) : "";

  // Watch-related variables
  const isWatching = watchTarget && onWatchedChange;
  const watchProps = watchTarget && onWatchedChange ? { control, name: watchTarget } : { control };
  const watchedValue = useWatch(watchProps);

  /** Handles changes to the input and triggers validation of dependent fields */
  const handleChange = (value: number | number[]) => {
    field.onChange(value);
    trigger && trigger(triggerTarget);
  };

  // Slider doesn't take in a ref
  const { ref, ...fixedField } = field;

  function render() {
    return (
      <DebouncedSlider
        {...sliderProps}
        {...fixedField}
        error={hasError}
        errorMessage={errorMessage}
        onChange={handleChange}
        debounceTime={debounceTime}
        renderTextfields={renderTextfields}
      />
    );
  }

  return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

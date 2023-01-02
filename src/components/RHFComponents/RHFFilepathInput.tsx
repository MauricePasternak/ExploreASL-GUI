import React from "react";
import { ControllerRenderProps, FieldValues, FieldPath, useController, useWatch } from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import { DebouncedFilepathInput, DebouncedFilepathInputProps } from "../DebouncedComponents";

export type RHFFilepathInputProps<
  TFV extends FieldValues,
  TName extends FieldPath<TFV>,
  TTrigger extends FieldPath<TFV>,
  TWatch extends FieldPath<TFV> | readonly FieldPath<TFV>[]
> = Omit<DebouncedFilepathInputProps, keyof ControllerRenderProps> &
  RHFControllerProps<TFV, TName> & // name & control
  RHFWatchProps<TFV, TWatch> & // watchTarget & onWatchedChange
  RHFTriggerProps<TFV, TTrigger>; // trigger & triggerTarget

/**
 * MUI Textfield + Button component meant to be used with react-hook-form to provide a string value representing a
 * filepath.
 *
 * ### Mandatory Props:
 * - `name`: the name of the field in the form
 * - `control`: the control object from react-hook-form
 * - `filepathType`: the type of filepath that this component is expected to take. One of "file", "dir", "other", "all".
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
 * - `dialogOptions`: options to pass to the Electron dialog when the button is clicked.
 * - `includeButton`: whether to include the Browse button. Defaults to true.
 * - `buttonText`: the text featured on the Browse button. Defaults to "Browse".
 * - `buttonProps`: additional props to pass to the Button component if it is rendered.
 * - `onValidateDrop`: a callback function to run and validate the value of a filepath. If it returns true, the value
 *    is forwarded to onChange, otherwise it is silently dropped
 * - `boxProps`: additional props to pass to the Box component that wraps the text field and error text
 * - all other props are forwarded to the TextField component
 */
export function RHFFilepathInput<
  TFV extends FieldValues,
  TName extends FieldPath<TFV>,
  TTrigger extends FieldPath<TFV>,
  TWatch extends FieldPath<TFV> | readonly FieldPath<TFV>[]
>({
  name,
  control,
  trigger,
  triggerTarget,
  watchTarget,
  onWatchedChange,
  ...filepathInputProps
}: RHFFilepathInputProps<TFV, TName, TTrigger, TWatch>) {
  // RHF Variables
  const { field, fieldState } = useController({ name, control }); // field & fieldState
  const hasError = !!fieldState.error;

  // Watch-related variables
  const isWatching = watchTarget && onWatchedChange;
  const watchParams = isWatching ? { control, name: watchTarget } : { control };
  const watchedValue = useWatch(watchParams);

  /** Handles changes to the input and triggers validation of dependent fields */
  const handleChange = (newValue: string) => {
    field.onChange(newValue); // update the field value
    trigger && trigger(triggerTarget); // trigger the validation
  };

  function render() {
    return (
      <DebouncedFilepathInput
        className="RHFFilepathInput__DebouncedFilepathInput"
        {...field}
        ref={null}
        {...filepathInputProps}
        onChange={handleChange}
        error={hasError}
        errorMessage={fieldState.error?.message}
      />
    );
  }

  return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

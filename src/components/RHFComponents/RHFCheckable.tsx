import Box from "@mui/material/Box";
import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import FormControlLabel, { FormControlLabelProps } from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Switch, { SwitchProps } from "@mui/material/Switch";
import React, { useEffect } from "react";
import { FieldValues, Path, PathValue, useController, useWatch } from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";

type RHFCheckboxBaseProps<TFV extends FieldValues, TName extends Path<TFV>> = {
  valWhenChecked: PathValue<TFV, TName>; // The value to set when the checkbox is checked
  valWhenUnchecked: PathValue<TFV, TName>; // The value to set when the checkbox is unchecked
  label?: React.ReactNode; // The label to display next to the checkbox
  helperText?: React.ReactNode; // The helper text to display below the checkbox
  isSwitch?: false; // Whether or not to render a switch instead of a checkbox
  checkableProps?: CheckboxProps; // Props to pass to the underlying Checkbox component
};

type RHFSwitchBaseProps<TFV extends FieldValues, TName extends Path<TFV>> = {
  valWhenChecked: PathValue<TFV, TName>; // The value to set the field to when the switch is checked.
  valWhenUnchecked: PathValue<TFV, TName>; // The value to set the field to when the switch is unchecked.
  label?: React.ReactNode; // The label to display for the switch.
  helperText?: React.ReactNode; // The helper text to display for the switch.
  isSwitch?: true; // Whether or not to render a switch instead of a checkbox.
  checkableProps?: SwitchProps; // Props to pass to the underlying Switch component.
};

type MUIRestrictedFormControlLabelProps = Omit<
  FormControlLabelProps,
  "control" | "onChange" | "label" | "value" | "checked"
>;

export type RHFCheckableProps<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
> = MUIRestrictedFormControlLabelProps &
  RHFControllerProps<TFV, TName> & // name, control
  RHFTriggerProps<TFV, TTrigger> & // trigger & triggerTarget
  RHFWatchProps<TFV, TWatch> & // watch & watchTarget
  (RHFCheckboxBaseProps<TFV, TName> | RHFSwitchBaseProps<TFV, TName>);

/**
 * A MaterialUI Checkbox or Switch checkable component meant to be used in a react-hook-form context, specifically
 * for fields with a binary set of values.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `valWhenChecked`: The value of the field when it is in a checked state.
 * - `valWhenUnchecked`: The value of the field when it is in an unchecked state.
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
 * - `isSwitch`: Whether the component to render is a Switch (true) or a Checkbox (false). Defaults to the latter.
 * - `checkableProps`: Props to pass to the checkable component.
 * - `...muiFormControlLabelProps`: All additional props are forwarded to the FormControlLabel component.
 */
export function RHFCheckable<
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
  valWhenChecked, // value to set when checked
  valWhenUnchecked, // value to set when unchecked
  label, // label to display next to the checkbox/switch
  helperText, // helper text to display below the checkbox/switch
  isSwitch = false, // display as a switch instead of a checkbox
  checkableProps, // props to pass to the checkbox/switch
  ...muiFormControlLabelProps // props to pass to the FormControlLabel
}: RHFCheckableProps<TFV, TName, TTrigger, TWatch>) {
  // RHF Variables
  const { field, fieldState } = useController({ name, control }); // field & fieldState
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";
  const isChecked = field.value === valWhenChecked;

  // Watch-related variables
  const isWatching = watchTarget && onWatchedChange;
  const watchParams = isWatching ? { control, name: watchTarget } : { control };
  const watchedValue = useWatch(watchParams);

  /**
   * When field.value changes, trigger the triggerTarget.
   */
  useEffect(() => {
    trigger && trigger(triggerTarget);
  }, [field.value]);

  const handleChange = (checked: boolean) => {
    field.onChange(checked ? valWhenChecked : valWhenUnchecked);
    field.onBlur();
    trigger && trigger(triggerTarget); // trigger the triggerTarget
  };

  function render() {
    return (
      <Box display="flex" flexDirection="column" alignItems="start" className="RHFCheckable__BoxWrapper">
        <FormControlLabel
          className="RHFCheckable__FormControlLabel"
          componentsProps={{
            typography: { color: hasError ? "error" : "default" },
          }}
          {...muiFormControlLabelProps}
          inputRef={field.ref}
          onBlur={field.onBlur}
          name={field.name}
          label={label}
          checked={isChecked}
          control={
            isSwitch === true ? (
              <Switch
                className="RHFCheckable__Switch"
                {...checkableProps}
                onChange={(_, checked) => handleChange(checked)}
                color={hasError ? "error" : "primary"}
              />
            ) : (
              <Checkbox
                className="RHFCheckable__Checkbox"
                {...checkableProps}
                onChange={(_, checked) => handleChange(checked)}
                color={hasError ? "error" : "primary"}
              />
            )
          }
        />
        {helperText && <FormHelperText error={hasError}>{helperText}</FormHelperText>}
        {errorMessage && <FormHelperText error={hasError}>{errorMessage}</FormHelperText>}
      </Box>
    );
  }

  return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

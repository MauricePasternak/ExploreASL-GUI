import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Switch, { SwitchProps } from "@mui/material/Switch";
import FastIsEqual from "fast-deep-equal";
import React, { useEffect, useState } from "react";
import { ControllerRenderProps, FieldValues, Path, PathValue, useController, useWatch } from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import { parseFieldError } from "../../common/utilityFunctions/formFunctions";

type TValueWrapper<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TValue = PathValue<TFV, TName>
> = TValue extends ReadonlyArray<any> ? TValue[number] : TValue;

type MUISwitchProps = Omit<SwitchProps, keyof ControllerRenderProps | "control" | "checked">;
type MUICheckboxProps = Omit<CheckboxProps, keyof ControllerRenderProps | "control" | "checked">;

type RHFCheckableOptionBaseProps<TFV extends FieldValues, TName extends Path<TFV>> = {
  label: React.ReactNode; // label to display next to the checkbox
  value: TValueWrapper<TFV, TName>;
};

/**
 * Type representing a single checkbox/switch option compatible with {@link RHFCheckableGroup}
 *
 * ### Mandatory Props:
 * - `label`: label to display next to the checkbox/switch
 * - `value`: value to be used for the checkbox/switch
 *
 * ### Optional Props:
 * - All other optional props are based on Material UI's `CheckboxProps` or `SwitchProps` depending on
 * the `type` prop of the {@link RHFCheckableGroup} this option is used in.
 */
export type RHFCheckableOption<
  TCheck extends "switch" | "checkbox" = "checkbox",
  TFV extends FieldValues = FieldValues,
  TName extends Path<TFV> = Path<TFV>
> = TCheck extends "switch"
  ? MUISwitchProps & RHFCheckableOptionBaseProps<TFV, TName>
  : MUICheckboxProps & RHFCheckableOptionBaseProps<TFV, TName>;

type RHFCheckableGroupBaseProps<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TCheck extends "switch" | "checkbox"
> = {
  type: TCheck; // type of checkable to use (switch or checkbox)
  options: RHFCheckableOption<TCheck, TFV, TName>[]; // options to display
  keepUncheckedValue: boolean; // keep unchecked options in the form values (default: false)
  uncheckedValue: TValueWrapper<TFV, TName>;
  helperText?: React.ReactNode; // helper text to display below the checkbox
  label?: React.ReactNode; // label to display next to the checkbox
  row?: boolean; // display options in a row instead of a column
};

export type RHFCheckableGroupProps<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TCheck extends "switch" | "checkbox",
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
> = RHFCheckableGroupBaseProps<TFV, TName, TCheck> &
  RHFControllerProps<TFV, TName> & // name, control
  RHFWatchProps<TFV, TWatch> & // watchTarget & onWatchedChange
  RHFTriggerProps<TFV, TTrigger>; // trigger & triggerTarget

/**
 * A collection of MaterialUI Checkbox/Switch components meant for use in a react-hook-form context,
 * specifically for array fields containing primitives. Has two behaviors:
 * - be a fixed-length tuple which has a stand-in default value at unchecked positions
 * - be a variable-length array whose values only include checked values, in no particular order.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `type`: Which MUI component to use. One of "checkbox" or "switch".
 * - `options`: A collection of {@link RHFCheckableOption} objects that describe the labels,
 *    checked values, etc. for each checkable.
 * - `keepUncheckedValue`: The behavior of this component as described above. Will act as a tuple if true, otherwise
 *    will act like an array.
 * - `uncheckedValue`: The value to use for the unchecked state. This is still mandatory even when the behavior of the
 *    component is meant to be an array instead of a tuple.
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
 * - `row`: Whether the checkables should be arranged in a row (true) or a column (false).
 *    Defaults to column arrangement.
 */
export function RHFCheckableGroup<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TCheck extends "switch" | "checkbox",
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
>({
  name,
  control,
  trigger,
  triggerTarget,
  watchTarget,
  onWatchedChange,
  type,
  options,
  keepUncheckedValue,
  uncheckedValue,
  helperText,
  label,
  row = false,
}: RHFCheckableGroupProps<TFV, TName, TCheck, TTrigger, TWatch>) {
  // RHF Variables
  const { field, fieldState } = useController({ name, control }); // get the field and fieldState from react-hook-form
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? parseFieldError(fieldState.error) : "";

  // Watch-related variables
  const isWatching = watchTarget && onWatchedChange;
  const watchParams = isWatching ? { control, name: watchTarget } : { control };
  const watchedValue = useWatch(watchParams);

  /**
   * Parses the current field.value to into what innerValue should be based on options given to the component.
   */
  function getNewInnerValue(): PathValue<TFV, TName> {
    return options.map((option, idx) => {
      if (keepUncheckedValue) {
        return option.value === field.value[idx] ? option.value : uncheckedValue;
      } else {
        return field.value.includes(option.value) ? option.value : uncheckedValue;
      }
    }) as PathValue<TFV, TName>;
  }

  // Inner State
  const [innerValue, setInnerVal] = useState(
    () => (field.value && getNewInnerValue()) || ([] as PathValue<TFV, TName>)
  );

  /** Keep innerValue and field.value synced (i.e. if field.value is programatically changed) */
  useEffect(() => {
    const paddedInnerValue = getNewInnerValue();
    if (field.value != null && !FastIsEqual(paddedInnerValue, innerValue)) setInnerVal(paddedInnerValue);
  }, [JSON.stringify(field.value)]);

  /** Handler for updating  */
  const handleChange = (index: number, checked: boolean) => {
    // Need to make a copy of the innerValue to avoid mutating the state directly
    const innerValCopy = [...innerValue] as PathValue<TFV, TName>;

    // Mutate the copy at the indicated location
    innerValCopy[index] = checked ? options[index].value : uncheckedValue;

    // Filter out the filler value if indicated
    const finalVal = keepUncheckedValue
      ? innerValCopy
      : innerValCopy.filter((val: PathValue<TFV, TName>[number]) => val !== uncheckedValue);

    // Update the state and trigger the onChange callback with the final value
    setInnerVal(innerValCopy);
    field.onChange(finalVal);
    trigger && trigger(triggerTarget);
  };

  function render() {
    return (
      <FormControl
        onBlur={field.onBlur}
        error={hasError}
        fullWidth
        component="fieldset"
        variant="standard"
        className="RHFMultiCheckable__FormControl"
      >
        <FormLabel component="legend" className="RHFMultiCheckable__FormLabel">
          {label}
        </FormLabel>
        <FormGroup row={row} className="RHFMultiCheckable__FormGroup">
          {options.map((rawOption, optionIdx) => {
            const { value, ...option } = rawOption;
            return (
              <FormControlLabel
                key={`RHFMultiCheckable__${option.label}__${optionIdx}`}
                className="RHFMultiCheckable__FormControlLabel"
                label={option.label}
                control={
                  type === "checkbox" ? (
                    <Checkbox
                      className="RHFMultiCheckable__Checkbox"
                      {...option}
                      value={value}
                      checked={
                        keepUncheckedValue ? innerValue[optionIdx] !== uncheckedValue : innerValue.includes(value)
                      }
                      onChange={(_, checked) => handleChange(optionIdx, checked)}
                    />
                  ) : (
                    <Switch
                      className="RHFMultiCheckable__Switch"
                      {...option}
                      value={value}
                      checked={
                        keepUncheckedValue ? innerValue[optionIdx] !== uncheckedValue : innerValue.includes(value)
                      }
                      onChange={(_, checked) => handleChange(optionIdx, checked)}
                    />
                  )
                }
              />
            );
          })}
        </FormGroup>
        {hasError && (
          <FormHelperText className="RHFMultiCheckable__ErrorText" error={true}>
            {errorMessage}
          </FormHelperText>
        )}
        {helperText && (
          <FormHelperText className="RHFMultiCheckable__HelperText" error={hasError}>
            {helperText}
          </FormHelperText>
        )}
      </FormControl>
    );
  }

  return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}

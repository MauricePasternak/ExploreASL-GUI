import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel, { FormControlLabelProps } from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Switch, { SwitchProps } from "@mui/material/Switch";
import React, { useEffect, useState } from "react";
import { Controller, FieldError, FieldValues, Path, PathValue } from "react-hook-form";
import { RHFFieldAndFieldStateType, RHFControlAndNameType } from "../../common/types/formTypes";
import FastIsEqual from "fast-deep-equal";

type RestrictedFormControlLabelCheckablesProps = Omit<
  FormControlLabelProps,
  "control" | "value" | "label" | "onChange" | "checked"
>;
type RestrictedSwitchProps = Omit<SwitchProps, "checked" | "onChange" | "value">;
type RestrictedCheckboxProps = Omit<CheckboxProps, "checked" | "onChange" | "value">;

export type RHFCheckablesOption<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = {
  label: React.ReactNode;
  value: TValue extends any[] ? TValue[number] : TValue;
  checkableProps?: TCheckable extends "switch" ? RestrictedSwitchProps : RestrictedCheckboxProps;
} & RestrictedFormControlLabelCheckablesProps;

type ControlledCheckablesBaseProps<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = {
  options: RHFCheckablesOption<TCheckable, TValues, TName, TValue>[];
  keepUncheckedValue: boolean;
  uncheckedValue: TValue extends any[] ? TValue[number] : TValue;
  type: TCheckable;
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  row?: boolean;
};

type ControlledCheckablesProps<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledCheckablesBaseProps<TCheckable, TValues, TName> & RHFFieldAndFieldStateType<TValues, TName>;

type ControlledCheckablesPropsNoField<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<ControlledCheckablesProps<TCheckable, TValues, TName>, "field" | "fieldState">;

type RHFCheckableProps<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFControlAndNameType<TValues, TName> & ControlledCheckablesPropsNoField<TCheckable, TValues, TName>;

export function ControlledCheckables<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
>({
  field,
  fieldState,
  options,
  type,
  uncheckedValue,
  label,
  helperText,
  keepUncheckedValue = false,
  row = false,
}: ControlledCheckablesProps<TCheckable, TValues, TName>) {
  /**
   * Retrieves the error message from the fieldState.errors object, regardless whether the error originates on
   * the array form value or one of its elements
   * @param error The error object to parse
   * @returns
   */
  const parseError = (error: FieldError) => {
    if ("message" in error) return error.message;
    for (const value of Object.values(error)) {
      if (typeof value !== "string" && "message" in value) return value.message;
    }
    throw new Error("Could not parse error");
  };

  /**
   * Parses the current field.value to into what innerValue should be based on options given to the component.
   */
  function getNewInnerValue(): PathValue<TValues, TName> {
    return options.map((option, idx) => {
      if (keepUncheckedValue) {
        return option.value === field.value[idx] ? option.value : uncheckedValue;
      } else {
        return field.value.includes(option.value) ? option.value : uncheckedValue;
      }
    }) as PathValue<TValues, TName>;
  }

  const hasError = !!fieldState.error;
  const errorMessage = hasError ? parseError(fieldState.error) : "";
  const [innerVal, setInnerVal] = useState(
    () => (field.value && getNewInnerValue()) || ([] as PathValue<TValues, TName>)
  );

  /**
   * Necessary workaround for cases where a manual `reset` is called on the form.
   * This will force the component to update.
   */
  useEffect(() => {
    if (field.value != null && !FastIsEqual(field.value, innerVal)) {
      setInnerVal(getNewInnerValue());
    }
  }, [JSON.stringify(field.value)]);

  const handleChange = (index: number, checked: boolean) => {
    const innerValCopy = [...innerVal] as PathValue<TValues, TName>;
    // console.log("ControlledCheckables has innerValCopy:", innerValCopy);

    // Mutate the copy at the indicated location
    innerValCopy[index] = checked ? options[index].value : uncheckedValue;
    // console.log("ControlledCheckables has mutated innerValCopy:", innerValCopy);

    // Filter out the filler value if indicated
    const finalVal = keepUncheckedValue
      ? innerValCopy
      : innerValCopy.filter((val: PathValue<TValues, TName>[number]) => val !== uncheckedValue);
    // console.log("ControlledCheckables has finalVal:", finalVal);

    // Update the state and trigger the onChange callback with the final value
    setInnerVal(innerValCopy);
    field.onChange(finalVal);
  };

  return (
    <FormControl onBlur={field.onBlur} fullWidth error={hasError} component="fieldset" variant="standard">
      <FormLabel component="legend">{label}</FormLabel>
      <FormGroup row={row}>
        {options.map((rawOption, optionIdx) => {
          const { value, checkableProps, ...option } = rawOption;
          return (
            <FormControlLabel
              {...option}
              key={`${option.label}-${optionIdx}`}
              label={option.label}
              control={
                type === "checkbox" ? (
                  <Checkbox
                    {...checkableProps}
                    value={value}
                    checked={keepUncheckedValue ? innerVal[optionIdx] !== uncheckedValue : innerVal.includes(value)}
                    onChange={(_, checked) => handleChange(optionIdx, checked)}
                  />
                ) : (
                  <Switch
                    {...checkableProps}
                    value={value}
                    checked={keepUncheckedValue ? innerVal[optionIdx] !== uncheckedValue : innerVal.includes(value)}
                    onChange={(_, checked) => handleChange(optionIdx, checked)}
                  />
                )
              }
            />
          );
        })}
      </FormGroup>
      {hasError && <FormHelperText error={true}>{errorMessage}</FormHelperText>}
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}

/**
 * A wrapper around MaterialUI Checkboxes/Switches within a FormControl that is controlled by a React Hook Form controller.
 * @param options An array of {@link RHFCheckableProps} to display in the checkables. The properties include:
 * - `label`: The label to display for the checkable
 * - `value`: The value to store in the form when the checkable is checked.
 * - `checkableProps`: Any props to pass to the checkable. Depends on the `type` parameter.
 * @param type The type of checkable to display. Can be either "checkbox" or "switch".
 * @param uncheckedValue The value to store in the form when the checkable is unchecked.
 * @param label The label to display above the checkables.
 * @param helperText The helper text to display below the checkables.
 * @param keepUncheckedValue Whether or not to retain the unchecked values in the field value array
 * when the checkable is unchecked. Defaults to `false`.
 * @param row Whether or not to display the checkables in a row. Defaults to `false`.
 * @note The following props are not supported:
 * - `value`
 * - `onChange`
 * - `onBlur`
 * - `checked`
 * as they are controlled by the React Hook Form controller.
 */
function RHFCheckables<
  TCheckable extends "switch" | "checkbox",
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
>({ control, name, ...props }: RHFCheckableProps<TCheckable, TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledCheckables field={field} fieldState={fieldState} {...props} />;
      }}
    />
  );
}

export default RHFCheckables;

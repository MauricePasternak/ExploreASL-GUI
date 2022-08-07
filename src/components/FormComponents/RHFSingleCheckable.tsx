import React from "react";
import { Controller, FieldValues, Path } from "react-hook-form";
import Switch, { SwitchProps } from "@mui/material/Switch";
import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import Box from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
import FormControlLabel, { FormControlLabelProps } from "@mui/material/FormControlLabel";
import { ControllerFieldPropType, UseControllerPropsBaseType, FieldValueType } from "../../common/types/formTypes";

interface ControlledSwitchProps<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> {
  valWhenChecked: FieldValueType<TValues, TName>;
  valWhenUnchecked: FieldValueType<TValues, TName>;
  label: React.ReactNode;
  helperText?: string;
  isSwitch?: true;
  checkableProps?: SwitchProps;
}

interface ControlledCheckboxProps<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> {
  valWhenChecked: FieldValueType<TValues, TName>;
  valWhenUnchecked: FieldValueType<TValues, TName>;
  label: React.ReactNode;
  helperText?: string;
  isSwitch?: false;
  checkableProps?: CheckboxProps;
}

type RestrictedFormControlLabelProps = Omit<
  FormControlLabelProps,
  "control" | "onChange" | "label" | "value" | "checked"
>;

type ControlledCheckableBaseProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RestrictedFormControlLabelProps & (ControlledSwitchProps<TValues, TName> | ControlledCheckboxProps<TValues, TName>);

type ControlledCheckableProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledCheckableBaseProps<TValues, TName> & ControllerFieldPropType<TValues, TName>;

type ControlledCheckablesPropsNoField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = Omit<
  ControlledCheckableProps<TValues, TName>,
  "field" | "fieldState"
>;

type RHFCheckablesProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = UseControllerPropsBaseType<TValues, TName> & ControlledCheckablesPropsNoField<TValues, TName>;

function ControlledCheckable<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  valWhenChecked,
  valWhenUnchecked,
  label,
  helperText,
  isSwitch = false,
  checkableProps,
  ...formControlLabelProps
}: ControlledCheckableProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";
  const isChecked = field.value === valWhenChecked;

  // console.log(`SingleCheckable with name: ${field.name} hasError: ${hasError} errorMessage: ${errorMessage}`);

  return (
    <Box display="flex" flexDirection="column" alignItems="start">
      <FormControlLabel
        componentsProps={{ typography: { color: hasError ? "error" : "default" } }}
        {...formControlLabelProps}
        checked={isChecked}
        onChange={(_, checked) => {
          field.onChange(checked ? valWhenChecked : valWhenUnchecked);
          field.onBlur();
        }}
        onBlur={field.onBlur}
        // value={field.value}
        name={field.name}
        label={label}
        control={
          isSwitch === true ? (
            <Switch
              {...checkableProps}
              onChange={(_, checked) => {
                field.onChange(checked ? valWhenChecked : valWhenUnchecked);
                field.onBlur();
              }}
              color={hasError ? "error" : "primary"}
            />
          ) : (
            <Checkbox
              {...checkableProps}
              onChange={(_, checked) => {
                field.onChange(checked ? valWhenChecked : valWhenUnchecked);
                field.onBlur();
              }}
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

/**
 * A Material UI FormControlLabel component that is controlled by a React Hook Form controller. Contains most of the
 * same props as a regular `FormControlLabel` component, but also accepts the following props:
 * @param valWhenChecked The value to set the field to when the checkbox is checked.
 * @param valWhenUnchecked The value to set the field to when the checkbox is unchecked.
 * @param label The label to display beside the field.
 * @param helperText The helper text to display below the field.
 * @param isSwitch Whether the checkable is a `Switch` or a `Checkbox`.
 * @param checkableProps The props to pass to the checkable.
 * ---
 * @note Due to this component being controlled by a React Hook Form Controller, the following fields are disallowed:
 * - `control`
 * - `onChange`
 * - `onBlur`
 * - `value`
 * - `checked`
 */
function RHFSingleCheckable<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...props
}: RHFCheckablesProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledCheckable field={field} fieldState={fieldState} {...props} />;
      }}
    />
  );
}

export default RHFSingleCheckable;

import Box from "@mui/material/Box";
import Checkbox, { CheckboxProps } from "@mui/material/Checkbox";
import FormControlLabel, { FormControlLabelProps } from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Switch, { SwitchProps } from "@mui/material/Switch";
import React, { useEffect } from "react";
import { Controller, FieldValues, Path } from "react-hook-form";
import {
  RHFFieldAndFieldStateType, RHFFieldValueType, RHFInterDepBaseProps, RHFTriggerType
} from "../../common/types/formTypes";

interface ControlledSwitchProps<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> {
  valWhenChecked: RHFFieldValueType<TValues, TName>;
  valWhenUnchecked: RHFFieldValueType<TValues, TName>;
  label: React.ReactNode;
  helperText?: string;
  isSwitch?: true;
  checkableProps?: SwitchProps;
}

interface ControlledCheckboxProps<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> {
  valWhenChecked: RHFFieldValueType<TValues, TName>;
  valWhenUnchecked: RHFFieldValueType<TValues, TName>;
  label: React.ReactNode;
  helperText?: string;
  isSwitch?: false;
  checkableProps?: CheckboxProps;
}

type RestrictedFormControlLabelProps = Omit<
  FormControlLabelProps,
  "control" | "onChange" | "label" | "value" | "checked"
>;

type InterDepControlledCheckableBaseProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RestrictedFormControlLabelProps & (ControlledSwitchProps<TValues, TName> | ControlledCheckboxProps<TValues, TName>);

type InterDepControlledSingleCheckableProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFFieldAndFieldStateType<TValues, TName> & // field and fieldState
  RHFTriggerType<TValues, TName> & // trigger and triggerTarget
  InterDepControlledCheckableBaseProps<TValues, TName>;

type ControlledCheckablesPropsNoField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = Omit<
  InterDepControlledSingleCheckableProps<TValues, TName>,
  "field" | "fieldState"
>;

function InterDepControlledCheckable<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  trigger,
  triggerTarget,
  valWhenChecked,
  valWhenUnchecked,
  label,
  helperText,
  isSwitch = false,
  checkableProps,
  ...formControlLabelProps
}: InterDepControlledSingleCheckableProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";
  const isChecked = field.value === valWhenChecked;

  /**
   * useEffect handler for responding to external changes to `field.value`
   * 1) Triggers the validation of other fields
   */
  useEffect(() => {
    trigger(triggerTarget);
  }, [field.value]);

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

export type RHFInterDepSingleCheckableProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFInterDepBaseProps<TValues, TName> & ControlledCheckablesPropsNoField<TValues, TName>;

/**
 * A Material UI FormControlLabel component that is controlled by a React Hook Form controller. Contains most of the
 * same props as a regular `FormControlLabel` component:
 *
 * Fundamental Properties:
 * - `control` - the RHF control object returned by useForm().
 * - `name` - the name of the field this component is responsible for.
 * - `trigger` - the RHF trigger function returned by useForm().
 * - `triggerTarget` - the name of the field(s) to trigger validation on when this form changes.
 * ---
 *
 * Additional Properties:
 * - `valWhenChecked` The value to set the field to when the checkbox is checked.
 * - `valWhenUnchecked` The value to set the field to when the checkbox is unchecked.
 * - `label` The label to display beside the field.
 * - `helperText` The helper text to display below the field.
 * - `isSwitch` Whether the checkable is a `Switch` or a `Checkbox`.
 * - `checkableProps` The props to pass to the checkable.
 * ---
 * @note Due to this component being controlled by a React Hook Form Controller, the following fields are disallowed:
 * - `control`
 * - `onChange`
 * - `onBlur`
 * - `value`
 * - `checked`
 */
function RHFInterDepSingleCheckable<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...InterDepControlledCheckableProps
}: RHFInterDepSingleCheckableProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return (
          <InterDepControlledCheckable field={field} fieldState={fieldState} {...InterDepControlledCheckableProps} />
        );
      }}
    />
  );
}

export default RHFInterDepSingleCheckable;

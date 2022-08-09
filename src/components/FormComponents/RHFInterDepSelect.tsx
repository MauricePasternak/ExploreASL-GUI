import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem, { MenuItemProps } from "@mui/material/MenuItem";
import Select, { SelectProps } from "@mui/material/Select";
import React, { useEffect } from "react";
import { Controller, FieldValues, Path, PathValue } from "react-hook-form";
import { RHFFieldAndFieldStateType, RHFInterDepBaseProps, RHFTriggerType } from "../../common/types/formTypes";

type RHFInterDepSelectOptionBase<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = {
  label: string;
  value: TValue extends any[] ? TValue[number] : TValue;
  disabled?: boolean;
};
export type RHFInterDepControlledSelectOption<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = Partial<MenuItemProps> & RHFInterDepSelectOptionBase<TValues, TName, TValue>;

type ControlledSelectPropsBase<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = {
  options: RHFInterDepControlledSelectOption<TValues, TName, TValue>[];
  label?: React.ReactNode;
  formControlProps?: Omit<FormControlProps<"fieldset">, "error" | "variant">;
  helperText?: React.ReactNode;
};

type RestrictedInterDepSelectProps = Omit<SelectProps, "value" | "onChange" | "onBlur" | "name" | "error">;

export type ControlledSelectProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = RHFFieldAndFieldStateType<TValues, TName> &
  RHFTriggerType<TValues, TName> &
  ControlledSelectPropsBase<TValues, TName, TValue> &
  RestrictedInterDepSelectProps;

export type RHFSelectProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFInterDepBaseProps<TValues, TName> & Omit<ControlledSelectProps<TValues, TName>, "field" | "fieldState">;

export function InterDepControlledSelect<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  trigger,
  triggerTarget,
  options,
  label,
  formControlProps,
  helperText,
  ...selectProps
}: ControlledSelectProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

  /**
   * When field.value changes, trigger the triggerTarget.
   */
  useEffect(() => {
    console.log(`InterDepControlledSelect: ${field.name} changed. Triggering ${triggerTarget}`);
    trigger && trigger(triggerTarget);
  }, [field.value]);

  return (
    <FormControl
      fullWidth
      {...formControlProps}
      variant={selectProps.variant}
      error={hasError}
      disabled={selectProps.disabled}
      component="fieldset"
    >
      <InputLabel>{label}</InputLabel>
      <Select
        {...selectProps}
        onChange={field.onChange}
        onBlur={field.onBlur}
        name={field.name}
        value={field.value}
        label={label}
      >
        {options.map((option, index) => {
          return (
            <MenuItem key={index} {...option}>
              {option.label}
            </MenuItem>
          );
        })}
      </Select>
      {helperText && <FormHelperText error={hasError}>{helperText}</FormHelperText>}
      {hasError && <FormHelperText error={true}>{errorMessage}</FormHelperText>}
    </FormControl>
  );
}

/**
 * A Material UI Select under the control of RHF. This component triggers the validation of other fields.
 *
 * Fundamental Properties:
 * - `control` - the RHF control object returned by useForm().
 * - `name` - the name of the field this component is responsible for.
 * - `trigger` - the RHF trigger function returned by useForm().
 * - `triggerTarget` - the name of the field(s) to trigger validation on when this form changes.
 * ---
 *
 * Additional Properties:
 * - `options` - An array of options to display in the select. At minimum, each option must have a `label` and `value`.
 * - `formControlProps` - Props to pass to the `FormControl` component. Note that `error` and `variant` are ignored.
 * - `helperText` - A helper text to display below the select.
 * ---
 * @note Due to this component being controlled by a React Hook Form Controller, the following props are disallowed:
 * - `value`
 * - `onChange`
 * - `onBlur`
 * - `name`
 * - `error`
 */
function RHFInterDepSelect<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...muiprops
}: RHFSelectProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <InterDepControlledSelect {...muiprops} field={field} fieldState={fieldState} />;
      }}
    />
  );
}

export default RHFInterDepSelect;

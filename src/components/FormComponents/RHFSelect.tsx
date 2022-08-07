import React from "react";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem, { MenuItemProps } from "@mui/material/MenuItem";
import Select, { SelectProps } from "@mui/material/Select";
import { Controller, FieldValues, Path, PathValue } from "react-hook-form";
import { ControllerFieldPropType, UseControllerPropsBaseType } from "../../common/types/formTypes";

type RHFSelectOptionBase<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = {
  label: string;
  value: TValue extends any[] ? TValue[number] : TValue;
  disabled?: boolean;
};
export type RHFControlledSelectOption<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = Partial<MenuItemProps> & RHFSelectOptionBase<TValues, TName, TValue>;

type ControlledSelectPropsBase<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = {
  options: RHFControlledSelectOption<TValues, TName, TValue>[];
  label?: React.ReactNode;
  formControlProps?: Omit<FormControlProps<"fieldset">, "error" | "variant">;
  helperText?: React.ReactNode;
};

type RestrictedSelectProps = Omit<SelectProps, "value" | "onChange" | "onBlur" | "name" | "error">;

export type ControlledSelectProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>,
  TValue = PathValue<TValues, TName>
> = ControlledSelectPropsBase<TValues, TName, TValue> & ControllerFieldPropType<TValues, TName> & RestrictedSelectProps;

type ControlledSelectPropsNoField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = Omit<
  ControlledSelectProps<TValues, TName>,
  "field" | "fieldState"
>;

export type RHFSelectProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = UseControllerPropsBaseType<TValues, TName> & ControlledSelectPropsNoField<TValues, TName>;

export function ControlledSelect<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  options,
  label,
  formControlProps,
  helperText,
  ...selectProps
}: ControlledSelectProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

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
          // console.log(option);

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
 * A Material UI Select component that is controlled by a React Hook Form Controller. Contains most of the same props
 * as a regular `Select`, plus the following props:
 * @param options - An array of options to display in the select. At minimum, each option must have a `label` and `value`.
 * @param formControlProps - Props to pass to the `FormControl` component. Note that `error` and `variant` are ignored.
 * @param helperText - A helper text to display below the select.
 * ---
 * @note Due to this component being controlled by a React Hook Form Controller, the following props are disallowed:
 * - `value`
 * - `onChange`
 * - `onBlur`
 * - `name`
 * - `error`
 */
function RHFSelect<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...muiprops
}: RHFSelectProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledSelect {...muiprops} field={field} fieldState={fieldState} />;
      }}
    />
  );
}

export default RHFSelect;

import React, { useEffect } from "react";
import FormControl from "@mui/material/FormControl";
import FormControlLabel, { FormControlLabelProps } from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio, { RadioProps } from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { Controller, FieldValues, Path } from "react-hook-form";
import { RHFFieldAndFieldStateType, RHFControlAndNameType } from "../../common/types/formTypes";

type RestrictedFormControlLabelRadioProps = Omit<FormControlLabelProps, "label" | "control" | "onChange">;

export type RHFRadioButtonOption = {
  label: React.ReactNode;
  value: unknown;
  radioProps?: RadioProps;
} & RestrictedFormControlLabelRadioProps;

type ControlledRadioButtonsBaseProps = {
  options: RHFRadioButtonOption[];
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  row?: boolean;
};

type ControlledRadioButtonsProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledRadioButtonsBaseProps & RHFFieldAndFieldStateType<TValues, TName>;

type ControlledRadioButtonsPropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<ControlledRadioButtonsProps<TValues, TName>, "field" | "fieldState">;

type RHFRatioButtonsProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFControlAndNameType<TValues, TName> & ControlledRadioButtonsPropsNoField<TValues, TName>;

function ControlledRadioButtons<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  options,
  label,
  helperText,
  row = false,
}: ControlledRadioButtonsProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

  return (
    <FormControl onBlur={field.onBlur} fullWidth component="fieldset" error={hasError} variant="standard">
      <FormLabel component="legend">{label}</FormLabel>
      <RadioGroup row={row} onChange={(_, v) => field.onChange(v)}>
        {options.map((option, idx) => (
          <FormControlLabel
            key={`${idx}_${option.label}`}
            value={option.value}
            label={option.label}
            checked={option.value === field.value}
            control={
              <Radio
                color={hasError ? "error" : option.radioProps?.color ? option.radioProps.color : "primary"}
                {...option.radioProps}
              />
            }
          />
        ))}
      </RadioGroup>
      {hasError && <FormHelperText error={true}>{errorMessage}</FormHelperText>}
      {helperText && <FormHelperText error={hasError}>{helperText}</FormHelperText>}
    </FormControl>
  );
}

/**
 * A Material UI `RadioGroup` component, wrapped with a `FormControl` that is controlled by a React Hook Form Controller.
 * @param options An array of {@link RHFRadioButtonOption} objects, each of which have properties:
 * - `label`: The label for the radio button
 * - `value`: The value for the radio button
 * - `radioProps`: Any props to pass to the radio button
 * - `...rest`: Any other props to pass to the `FormControlLabel` that wraps the radio button
 * @param label The label to display above the grouping of radio buttons.
 * @param helperText The helper text to display below the grouping of radio buttons.
 * @param row Whether or not the radio buttons should be displayed in a row.
 */
function RHFRadioButtons<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...props
}: RHFRatioButtonsProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledRadioButtons field={field} fieldState={fieldState} {...props} />;
      }}
    />
  );
}

export default RHFRadioButtons;

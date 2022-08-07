import Box, { BoxProps } from "@mui/material/Box";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import { isNumber as lodashIsNumber } from "lodash";
import React from "react";
import { Controller, FieldValues, Path } from "react-hook-form";
import { ControllerFieldPropType, UseControllerPropsBaseType } from "../../common/types/formTypes";
import DebouncedInput from "../DebouncedComponents/DebouncedInput";

type ControlledMultiNumericInputBaseProps = {
  label: React.ReactNode;
  helperText?: React.ReactNode;
  formControlProps?: Omit<FormControlProps, "component" | "error">;
  boxProps?: BoxProps;
};

type ControlledMultiNumericInputProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledMultiNumericInputBaseProps & ControllerFieldPropType<TValues, TName>;

type ControlledMultiNumericInputPropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<ControlledMultiNumericInputProps<TValues, TName>, "field" | "fieldState">;

type RHFMultiNumericInputProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledMultiNumericInputPropsNoField<TValues, TName> & UseControllerPropsBaseType<TValues, TName>;

const isNumberArray = (values: any): values is number[] => {
  return values && Array.isArray(values) && values.every(val => lodashIsNumber(val));
};

function ControlledMultiNumericInput<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  label,
  formControlProps,
  helperText,
  boxProps,
}: ControlledMultiNumericInputProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

  const handleChange = (
    event: string | React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    index: number,
    currArr: number[]
  ) => {
    const valAsNumber = typeof event === "string" ? Number(event) : Number(event.target.value);
    const newValues = currArr.map((currVal, i) => (i === index ? valAsNumber : currVal));
    field.onChange(newValues);
  };

  return (
    <FormControl variant="standard" {...formControlProps} error={hasError}>
      <FormLabel>{label}</FormLabel>
      <Box display="flex" gap={1} flexDirection={{ xs: "column", sm: "row" }} {...boxProps}>
        {isNumberArray(field.value) &&
          (field.value as number[]).map((value, index, arr) => (
            <DebouncedInput
              key={`${field.name}_${index}`}
              boxProps={{ flexGrow: 1 }}
              sx={{ flexGrow: 1 }}
              onBlur={field.onBlur}
              value={value}
              error={hasError}
              onChange={e => handleChange(e, index, arr)}
              type="number"
              clearable={false}
            />
          ))}
      </Box>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
      {hasError && <FormHelperText>{errorMessage}</FormHelperText>}
    </FormControl>
  );
}

function RHFMultiNumericInput<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...controlledMultiNumericInput
}: RHFMultiNumericInputProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledMultiNumericInput field={field} fieldState={fieldState} {...controlledMultiNumericInput} />;
      }}
    />
  );
}

export default RHFMultiNumericInput;

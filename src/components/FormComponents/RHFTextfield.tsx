import React, { useEffect, useState } from "react";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { Controller, FieldValues, Path } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { RHFFieldAndFieldStateType, RHFFieldValueType, RHFControlAndNameType } from "../../common/types/formTypes";
import IconButton from "@mui/material/IconButton";
import ClearIcon from "@mui/icons-material/Clear";

type ControlledTextFieldBaseProps<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = {
  /**
   * Optional function which converts the field value to the component's inner string value.
   */
  handleFieldToInner?: (fieldValue: RHFFieldValueType<TValues, TName>, ...args: any[]) => string;
  /**
   * Optional function which converts the component's inner string value to the field value.
   */
  handleInnerToField?: (innerValue: string, ...args: any[]) => RHFFieldValueType<TValues, TName>;
  /**
   * The number of milliseconds to delay the update of the textfield's inner value to the overhead form.
   * @default 1000 (1 second)
   */
  debounceTime?: number;
  /**
   * Whether the textfield's inner value should be updated after the debounce time has elapsed. This may be useful
   * for textfields that need to auto-correct their inner value (i.e. the text gets translated into comma-separated
   * numbers and typos should be auto-removed).
   */
  shouldUpdateAfterDebounce?: boolean;
};

// To avoid conflict with the "field" prop coming from the Controller render
type RestrictedTextFieldProps = Omit<TextFieldProps, "name" | "value" | "onChange" | "onBlur">;

type ControlledTextFieldProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledTextFieldBaseProps<TValues, TName> & RHFFieldAndFieldStateType<TValues, TName> & RestrictedTextFieldProps;

type ControlledTextFieldPropsNoField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = Omit<
  ControlledTextFieldProps<TValues, TName>,
  "field" | "fieldState"
>;

type RHFTextfieldProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledTextFieldPropsNoField<TValues, TName> & RHFControlAndNameType<TValues, TName>;

function ControlledTextField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  handleFieldToInner,
  handleInnerToField,
  variant,
  shouldUpdateAfterDebounce = true,
  debounceTime = 500,
  ...muiprops
}: ControlledTextFieldProps<TValues, TName>) {
  const [innerVal, setInnerVal] = useState(handleFieldToInner ? handleFieldToInner(field.value) : field.value);
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

  // console.log(`RHFTextfield with name ${field.name} has field.value and innerValue: `, field.value, innerVal);
  /**
   * Allows for the textField to auto-correct its inner value to the field value after the form may have been updated.
   */
  useEffect(() => {
    if (!shouldUpdateAfterDebounce) return;

    if (field.value != null && field.value !== innerVal) {
      setInnerVal(handleFieldToInner ? handleFieldToInner(field.value) : field.value);
    }
  }, [field.value, shouldUpdateAfterDebounce]);

  const debouncedHandleChange = useDebouncedCallback(field.onChange, debounceTime);
  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | string) => {
    let stringVal: string;
    if (typeof event !== "string") {
      event.persist();
      stringVal = event.target.value;
    } else {
      stringVal = event;
    }
    setInnerVal(stringVal);
    debouncedHandleChange(handleInnerToField ? handleInnerToField(stringVal) : stringVal);
  };

  return (
    <TextField
      InputProps={{
        endAdornment: (
          <IconButton disabled={false} onClick={() => innerVal && handleChange("")}>
            <ClearIcon color={hasError ? "error" : "inherit"} />
          </IconButton>
        ),
      }}
      {...muiprops}
      variant={variant} // Hack; must be separated from the rest of MUI props, otherwise MUI complains of a type error
      error={hasError || muiprops.error}
      helperText={hasError ? errorMessage : muiprops.helperText}
      onChange={handleChange}
      onBlur={field.onBlur}
      name={field.name}
      value={innerVal}
    />
  );
}

/**
 * A MaterialUI TextField that is controlled by a React Hook Form controller. Contains all the same props as a regular
 * `TextField`, plus the following props:
 * @param handleFieldToInner A function that converts the field value to the inner string value.
 * @param handleInnerToField A function that converts the inner string value to the field value.
 * @param debounceTime The number of milliseconds to debounce the onChange callback.
 * @param shouldUpdateAfterDebounce Whether the inner value should be updated after the debounce time has elapsed.
 * ---
 * @note The following MaterialUI TextField props are not supported:
 * - `value`
 * - `onChange`
 * - `onBlur`
 *
 * as these are controlled by the React Hook Form controller.
 */
function RHFTextfield<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...controlledTextFieldProps
}: RHFTextfieldProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return <ControlledTextField field={field} fieldState={fieldState} {...controlledTextFieldProps} />;
      }}
    />
  );
}

export default RHFTextfield;

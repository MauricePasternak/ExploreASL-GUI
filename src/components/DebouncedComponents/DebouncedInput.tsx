import React, { useState, useEffect, useCallback } from "react";
import Box, { BoxProps } from "@mui/material/Box";
import Button, { ButtonProps } from "@mui/material/Button";
import { useDebouncedCallback } from "use-debounce";
import Textfield, { TextFieldProps } from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import ClearIcon from "@mui/icons-material/Clear";
import { FieldError } from "react-hook-form";

export interface debounceTypes {
  debounceDelay?: number;
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | string, ...args: unknown[]) => void;
  onClick?: () => string | false | Promise<string | false>;
}

export type DebouncedInputProps = debounceTypes &
  Omit<TextFieldProps, "onChange" | "variant" | "error"> & {
    boxProps?: BoxProps;
    buttonProps?: ButtonProps;
    buttonText?: string;
    clearable?: boolean;
    error?: boolean | FieldError;
    variant?: "outlined" | "standard" | "filled";
  };

function DebouncedInput({
  boxProps,
  buttonProps,
  buttonText,
  error,
  value,
  onChange,
  onClick,
  debounceDelay = 400,
  variant = "outlined",
  clearable = true,
  ...props
}: DebouncedInputProps) {
  const [innerValue, setInnerValue] = useState<string>("");

  /**
   * Hook which will allow this component to respond to changes to parent components (i.e. for versions
   * of this component which are used in form, drag & drop, etc. contexts).
   */
  useEffect(() => {
    setInnerValue(value ? (value as string) : "");
  }, [value]);

  /**
   * Wrapper around any provided onChange function, which will be debounced and propagate any change
   * events upwards in the component tree.
   */
  const debouncedHandleOnChange = useDebouncedCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | string) => {
      // console.log("The debounce callback will be called in DebouncedTextField");
      onChange && onChange(event);
    },
    debounceDelay
  );

  /**
   * Main handler of this component. Will detect changes either coming from the main Input component
   * which will be a React.ChangeEvent or changes coming from the accompanying button
   * or changes coming from the button which will be of type string. This handler will then change the
   * inner value of this component (to reflect the immediate change) and then forward the value to the
   * debounced function.
   */
  const handleOnChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | string) => {
      if (typeof event === "string") {
        setInnerValue(event);
      } else {
        event.persist();
        setInnerValue(event.currentTarget.value);
      }
      debouncedHandleOnChange(event);
    },
    [debouncedHandleOnChange]
  );

  /**
   * Main handler of the accompanying Button's click events. Expects to retrieve either a string to pass
   * onto the main handler, or false in order to exit early.
   */
  const handleOnClick = useCallback(async () => {
    if (!onClick) return;
    const result = await onClick();
    if (!result) return;
    handleOnChange(result);
  }, [onClick]);

  const hasError = typeof error === "boolean" ? error : !!error?.message;

  return (
    <Box display="flex" gap={1} {...boxProps}>
      <Textfield
        InputProps={{
          endAdornment: clearable && (
            <IconButton disabled={false} onClick={() => innerValue && handleOnChange("")}>
              <ClearIcon color={error ? "error" : "inherit"} />
            </IconButton>
          ),
        }}
        variant={variant}
        {...props}
        error={hasError}
        helperText={hasError ? (typeof error !== "boolean" ? error.message : props.helperText) : props.helperText}
        onChange={handleOnChange}
        value={innerValue}
      />
      {onClick && (
        <Button
          variant="contained"
          color={hasError ? "error" : buttonProps?.color ? buttonProps.color : "primary"}
          {...buttonProps}
          onClick={handleOnClick}
        >
          {buttonText}
        </Button>
      )}
    </Box>
  );
}

export default DebouncedInput;

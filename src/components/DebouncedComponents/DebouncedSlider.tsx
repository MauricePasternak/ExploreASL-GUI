import Box from "@mui/material/Box";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Slider, { SliderProps } from "@mui/material/Slider";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import FastIsEqual from "fast-deep-equal";
import React, { useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

type MUISliderCompatibilityProps = Omit<SliderProps, "onChange" | "value">;
type AdjacentMUITextFieldProps = Omit<TextFieldProps, "value" | "onChange" | "onBlur" | "error" | "type">;

type DebouncedSliderBaseProps = {
  value: number | number[];
  onChange: (value: number | number[], ...args: unknown[]) => void;
  error?: boolean;
  errorMessage?: React.ReactNode;
  helperText?: React.ReactNode;
  label?: React.ReactNode;
  debounceTime?: number;
  renderTextfields?: boolean;
  textFieldProps?: AdjacentMUITextFieldProps;
  formControlProps?: Omit<FormControlProps<"fieldset">, "error">;
};

export type DebouncedSliderProps = MUISliderCompatibilityProps & DebouncedSliderBaseProps;

/**
 * MUI Slider component meant to capture a number or array of numbers and communicate it to a parent component
 * in a debounced manner.
 *
 * ### Mandatory Props
 * - `value`: The value of the slider as a number or array of numbers.
 * - `onChange`: The function to call when the slider value changes.
 * The first argument is expected to be a number or array of numbers.
 *
 * ### Optional Props
 * - `error`: Whether or not the slider is in an error state.
 * - `errorMessage`: Error message for the slider when it is in an error state.
 * - `helperText`: Helper text for the slider.
 * - `label`: Label for the slider.
 * - `debounceTime`: Debounce time for communicating changes to the parent component.
 * - `renderTextfields`: Whether or not to render adjacent text fields for the slider value.
 * - `textFieldProps`: Props to pass to the adjacent text fields if they are rendered.
 * - `formControlProps`: Props to pass to the FormControl component that wraps the slider and text fields.
 */
export const DebouncedSlider = ({
  value,
  onChange,
  error,
  errorMessage,
  helperText,
  label,
  renderTextfields = true,
  debounceTime = 500,
  textFieldProps,
  formControlProps,
  ...sliderProps
}: DebouncedSliderProps) => {
  // Inner State
  const [innerValue, setInnerValue] = useState<number | number[]>(value);

  // Debounce Callback
  const debouncedOnChange = useDebouncedCallback(onChange, debounceTime);

  // Misc
  const componentClassname = sliderProps.className
    ? `${sliderProps.className} DebouncedSlider__Slider`
    : "DebouncedSlider__Slider";

  // useEffect for keeping innerValue in sync with value
  // must use fast-deep-equal in case value is an array
  useEffect(() => {
    if (!FastIsEqual(value, innerValue)) setInnerValue(value);
  }, [value]);

  /** Handler for changes to the value; updates the inner value and forwards the new value via provided onChange */
  const handleChange = (value: number | number[]) => {
    setInnerValue(value);
    debouncedOnChange(value);
  };

  const handleRenderTextfields = () =>
    Array.isArray(innerValue) ? (
      // If innerValue is an array of numbers
      innerValue.map((val, idx) => (
        <TextField
          key={`DebouncedSlider__TextField__${idx}`}
          type="number"
          className="DebouncedSlider__TextField"
          variant={textFieldProps?.variant}
          {...textFieldProps}
          onChange={(textEvent) => {
            handleChange(innerValue.map((v, i) => (i === idx ? Number(textEvent.target.value) : v)));
          }}
          error={error}
          value={val}
          inputProps={{
            ...textFieldProps?.inputProps,
            min: sliderProps.min ?? 0,
            max: sliderProps.max ?? 100,
            step: sliderProps.step ?? 1,
          }}
        />
      ))
    ) : (
      // If innerValue is a number
      <TextField
        type="number"
        className="DebouncedSlider__TextField"
        variant={textFieldProps?.variant}
        {...textFieldProps}
        onChange={(textEvent) => handleChange(Number(textEvent.target.value))}
        error={error}
        value={innerValue}
        inputProps={{
          ...textFieldProps?.inputProps,
          min: sliderProps.min ?? 0,
          max: sliderProps.max ?? 100,
          step: sliderProps.step ?? 1,
        }}
      />
    );

  return (
    <FormControl
      fullWidth
      variant="standard"
      component="fieldset"
      className="DebouncedSlider__FormControl"
      disabled={sliderProps.disabled}
      {...formControlProps}
      error={error}
    >
      <FormLabel component="legend" className="DebouncedSlider__FormLabel">
        {label}
      </FormLabel>
      <Box display="flex" gap={2} alignItems="center" className="DebouncedSlider__FlexboxWrapper">
        <Slider
          className={componentClassname}
          sx={{ color: error ? "error.main" : "default" }}
          {...sliderProps}
          value={innerValue}
          onChange={(_, values) => handleChange(values)}
        />
        {renderTextfields && handleRenderTextfields()}
      </Box>
      {helperText && (
        <FormHelperText className="DebouncedSlider__HelperText" error={error}>
          {helperText}
        </FormHelperText>
      )}
      {error && (
        <FormHelperText className="DebouncedSlider__ErrorText" error={true}>
          {errorMessage}
        </FormHelperText>
      )}
    </FormControl>
  );
};

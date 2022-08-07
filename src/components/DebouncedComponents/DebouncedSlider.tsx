import React, { useState, useCallback } from "react";
import Slider, { SliderProps } from "@mui/material/Slider";
import { useDebouncedCallback } from "use-debounce";

type DebouncedProps = {
  value?: number | number[];
  debounceTime?: number;
  onChange?: (value: number | number[]) => void;
};
export type DebouncedSliderProps = Omit<SliderProps, keyof DebouncedProps> & DebouncedProps;

/**
 * Abstract component to provide debounce behavior to the MUI Slider component (i.e. in a form).
 * @param value Either a number or numerical array to set initial inner value of the component.
 * @param onChange The function to debounce. It should accept its first argument as an Event and
 * its second argument as a number or array of numbers
 * @param debounceTime The number of milliseconds to pass before the debounced function is called.
 * Defaults to 400ms.
 * @param ...props All additional props are based on props given to MUI Slider. onChange will be
 * automatically overwritten.
 */
function DebouncedSlider({ value, onChange, debounceTime = 400, ...props }: DebouncedSliderProps) {
  const [innerValue, setInnerValue] = useState<number | number[]>(value);
  const debouncedHandleChange = useDebouncedCallback(value => {
    if (onChange) onChange(value);
  }, debounceTime);
  const handleChange = useCallback(
    (v: number | number[]) => {
      setInnerValue(v);
      if (onChange) debouncedHandleChange(v);
    },
    [debouncedHandleChange]
  );
  return <Slider {...props} value={innerValue} onChange={(e, v) => handleChange(v)} />;
}

export default DebouncedSlider;

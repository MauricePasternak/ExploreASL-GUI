import FormControlLabel, { FormControlLabelProps } from "@mui/material/FormControlLabel";
import Slider, { SliderProps } from "@mui/material/Slider";
import { styled } from "@mui/material/styles";
import Switch, { SwitchProps } from "@mui/material/Switch";
import React from "react";

interface ControlledLabelGridProps extends FormControlLabelProps {
  labelwidth: number | string;
}

export const ControlLabelGrid = styled(FormControlLabel)<ControlledLabelGridProps>(({ labelwidth }) => ({
  display: "grid",
  gridTemplateColumns: `${labelwidth} 1fr`,
}));

interface ControlledLabelSliderProps extends SliderProps {
  label: React.ReactNode;
  labelwidth: number | string;
}

export const ControlledLabelSlider = styled((props: ControlledLabelSliderProps) => {
  const { labelwidth, label, ...sliderProps } = props;
  return (
    <ControlLabelGrid
      label={label}
      labelwidth={labelwidth}
      labelPlacement="start"
      control={<Slider {...sliderProps} />}
    />
  );
})<ControlledLabelSliderProps>(() => ({
  order: 1,
}));

interface ControlledLabelSwitchProps extends SwitchProps {
  label: React.ReactNode;
  labelwidth: number | string;
}

export const ControlledLabelSwitch = styled((props: ControlledLabelSwitchProps) => {
  const { label, labelwidth, ...switchProps } = props;
  return (
    <ControlLabelGrid
      label={label}
      labelwidth={labelwidth}
      labelPlacement="start"
      control={<Switch {...switchProps} />}
    />
  );
})(() => ({
  order: 1,
}));

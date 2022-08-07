import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import Slider, { SliderProps } from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { PrimitiveAtom, useAtom } from "jotai";
import React from "react";

interface MRIViewSliderProps extends SliderProps {
  atomMRISlice: PrimitiveAtom<number>;
  label: "Axial" | "Coronal" | "Sagittal";
}

function MRIViewSlider({ atomMRISlice, label, ...sliderProps }: MRIViewSliderProps) {
  const [slice, setSlice] = useAtom(atomMRISlice);

  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      <Slider
        min={1}
        step={1}
        value={slice}
        onChange={(e, v) => !Array.isArray(v) && setSlice(v)}
        valueLabelDisplay="auto"
        {...sliderProps}
      />
      <Box display="flex" justifyContent="space-between">
        {label === "Axial" && (
          <>
            <Typography variant="caption">Inferior</Typography>
            <Typography variant="caption">Superior</Typography>
          </>
        )}
        {label === "Coronal" && (
          <>
            <Typography variant="caption">Posterior</Typography>
            <Typography variant="caption">Anterior</Typography>
          </>
        )}
        {label === "Sagittal" && (
          <>
            <Typography variant="caption">Right</Typography>
            <Typography variant="caption">Left</Typography>
          </>
        )}
      </Box>
    </FormControl>
  );
}

export default MRIViewSlider;

import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectProps } from "@mui/material/Select";
import React from "react";
import { NivoColorPaletteNameType } from "../../common/types/nivoTypes";

type ColorSelectOption = {
  label: string;
  value: NivoColorPaletteNameType;
};

const ColorSelectOptions: Record<"Categorical" | "Diverging" | "Sequential", ColorSelectOption[]> = {
  Categorical: [
    { label: "Default", value: "nivo" },
    { label: "Ten Categories", value: "category10" },
    { label: "Accented", value: "accent" },
    { label: "Dark", value: "dark2" },
    { label: "Paired", value: "paired" },
    { label: "Pastel Set 1", value: "pastel1" },
    { label: "Pastel Set 2", value: "pastel2" },
    { label: "Standard Set 1", value: "set1" },
    { label: "Standard Set 2", value: "set2" },
    { label: "Standard Set 3", value: "set3" },
  ],

  Diverging: [
    { label: "Brown to Blueish-Green", value: "brown_blueGreen" },
    { label: "Purple to Green", value: "purpleRed_green" },
    { label: "Magenta to Green", value: "pink_yellowGreen" },
    { label: "Royal Purple to Brownlish-Orange", value: "purple_orange" },
    { label: "Burgandy to Blue", value: "red_blue" },
    { label: "Burgandy to Grey", value: "red_grey" },
    { label: "Red to Yellow to Blue", value: "red_yellow_blue" },
    { label: "Red to Yellow to Green", value: "red_yellow_green" },
    { label: "Spectral", value: "spectral" },
  ],

  Sequential: [
    { label: "Blues", value: "blues" },
    { label: "Greens", value: "greens" },
    { label: "Greys", value: "greys" },
    { label: "Oranges", value: "oranges" },
    { label: "Purples", value: "purples" },
    { label: "Reds", value: "reds" },
    { label: "White to Dark Green", value: "blue_green" },
    { label: "Pale Blue to Purple", value: "blue_purple" },
    { label: "Pale Green to Blue", value: "green_blue" },
    { label: "Orange to Burgandy", value: "orange_red" },
    { label: "White to Pacific Blue", value: "purple_blue" },
    { label: "White to Magenta", value: "purple_red" },
    { label: "White to Pink to Purple", value: "red_purple" },
    { label: "Yellow to Aqua to Blue", value: "yellow_green_blue" },
    { label: "Yellow to Green", value: "yellow_green" },
    { label: "Yellow to Orange to Brown", value: "yellow_orange_brown" },
    { label: "Yellow to Orange to Red", value: "yellow_orange_red" },
  ],
};

type ColorSelectProps = Omit<SelectProps, "onChange"> & {
  onChange: (value: NivoColorPaletteNameType, ...args: unknown[]) => void;
};

function ColorSelect({ onChange, ...props }: ColorSelectProps) {
  function renderGroup(options: ColorSelectOption[]) {
    return options.map(option => (
      <MenuItem key={option.value} value={option.value}>
        {option.label}
      </MenuItem>
    ));
  }

  return (
    <Select {...props} onChange={e => onChange(e.target.value as NivoColorPaletteNameType)}>
      {Object.entries(ColorSelectOptions).flatMap(([category, options]) => {
        return [
          <ListSubheader key={`ColorSelectSubheader__${category}`}>{category}</ListSubheader>,
          renderGroup(options),
        ];
      })}
    </Select>
  );
}

export default ColorSelect;

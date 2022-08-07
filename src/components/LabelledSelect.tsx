import FormControl from "@mui/material/FormControl";
import FormHelperText, { FormHelperTextProps } from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem, { MenuItemProps } from "@mui/material/MenuItem";
import Select, { SelectProps } from "@mui/material/Select";
import React from "react";

interface MenuItemOptionProps extends MenuItemProps {
  label: string;
}

type LabelledSelectBaseProps = {
  errorMessage?: string;
  options: MenuItemOptionProps[];
  helperText?: React.ReactNode;
  helperTextProps?: FormHelperTextProps;
  variant?: "filled" | "outlined" | "standard";
};

export type LabelledSelectProps = LabelledSelectBaseProps & Omit<SelectProps, "variant">;

function LabelledSelect({
  options,
  label,
  helperText,
  helperTextProps,
  variant = "outlined",
  ...props
}: LabelledSelectProps) {
  return (
    <FormControl variant={variant} fullWidth={props.fullWidth} error={props.error} disabled={props.disabled}>
      {label && <InputLabel>{label}</InputLabel>}
      <Select {...props} variant={variant} label={label}>
        {options.map((option, index) => {
          return (
            <MenuItem key={`LabelledSelectMenuItem__${label}__${index}`} {...option}>
              {option.label}
            </MenuItem>
          );
        })}
      </Select>
      {helperText && <FormHelperText {...helperTextProps}>{helperText}</FormHelperText>}
    </FormControl>
  );
}

export default LabelledSelect;

import React from "react";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import Avatar from "@mui/material/Avatar";
import { green, red } from "@mui/material/colors";
import { GridRenderCellParams } from "@mui/x-data-grid";

export function BIDSBooleanRenderField(params: GridRenderCellParams) {
	if (params.value == null) return <></>; // When the value is null/undefined, the field should be rendered as empty

	return params.value ? (
		<Avatar sx={{ bgcolor: green[500] }}>
			<CheckIcon />
		</Avatar>
	) : (
		<Avatar sx={{ bgcolor: red[500] }}>
			<ClearIcon />
		</Avatar>
	);
}

export default BIDSBooleanRenderField;

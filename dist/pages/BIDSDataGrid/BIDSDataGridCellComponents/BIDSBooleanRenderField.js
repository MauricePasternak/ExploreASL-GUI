import React from "react";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import Avatar from "@mui/material/Avatar";
import { green, red } from "@mui/material/colors";
export function BIDSBooleanRenderField(params) {
    if (params.value == null)
        return React.createElement(React.Fragment, null); // When the value is null/undefined, the field should be rendered as empty
    return params.value ? (React.createElement(Avatar, { sx: { bgcolor: green[500] } },
        React.createElement(CheckIcon, null))) : (React.createElement(Avatar, { sx: { bgcolor: red[500] } },
        React.createElement(ClearIcon, null)));
}
export default BIDSBooleanRenderField;
//# sourceMappingURL=BIDSBooleanRenderField.js.map
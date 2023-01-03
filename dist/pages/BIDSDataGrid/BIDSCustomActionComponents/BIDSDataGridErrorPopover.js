import ErrorIcon from "@mui/icons-material/Error";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import React, { memo, useState } from "react";
import { atomBIDSColumnNames, atomBIDSErrors } from "../../../stores/BIDSDataGridStore";
import { BIDSFieldNameToDisplayName } from "../BIDSColumnDefs";
export const BIDSDataGridErrorPopover = memo(() => {
    // Local State
    const [anchorEl, setAnchorEl] = useState(null);
    // Atomic State
    const bidsErrorMapping = useAtomValue(atomBIDSErrors);
    const bidsColumnNames = new Set(useAtomValue(atomBIDSColumnNames));
    // ? Is there a better way to do this???
    const parsedErrors = [];
    for (const [fieldName, rowErrorMapping] of Object.entries(bidsErrorMapping)) {
        for (const [rowIndex, errorMessage] of Object.entries(rowErrorMapping)) {
            parsedErrors.push({
                fieldName,
                rowIndex,
                errorMessage,
            });
        }
    }
    const hasError = parsedErrors.length > 0;
    const open = Boolean(anchorEl);
    const id = open ? "BIDSErrorPopover" : undefined;
    return (React.createElement(React.Fragment, null,
        React.createElement(Button, { "aria-describedby": id, disabled: !hasError, size: "small", variant: hasError ? "contained" : "text", startIcon: React.createElement(React.Fragment, null,
                React.createElement(SearchOffIcon, null),
                hasError && React.createElement("span", { style: { color: "" } }, parsedErrors.length)), color: "error", onClick: (event) => setAnchorEl(event.currentTarget) }, "View Errors"),
        React.createElement(Popover, { id: id, open: !!anchorEl, anchorEl: anchorEl, onClose: () => setAnchorEl(null), anchorOrigin: {
                vertical: "bottom",
                horizontal: "left",
            } },
            React.createElement(Box, { padding: 1 },
                React.createElement(Typography, { variant: "subtitle1" }, "The following errors were found within the BIDS Dataframe:"),
                React.createElement(List, { sx: { maxHeight: 300 } }, parsedErrors.map((error) => (React.createElement(ListItem, { key: `${error.fieldName}__${error.rowIndex}` },
                    React.createElement(ListItemIcon, null,
                        React.createElement(ErrorIcon, { sx: { color: "error.main", fontSize: "2rem" } })),
                    React.createElement(ListItemText, { primary: error.errorMessage, secondary: bidsColumnNames.has(error.fieldName) ? (React.createElement(React.Fragment, null,
                            React.createElement(Typography, { variant: "subtitle2", component: "span" }, "Found in column"),
                            " ",
                            React.createElement(Typography, { variant: "subtitle2", component: "span", sx: { fontWeight: 800 } }, BIDSFieldNameToDisplayName[error.fieldName]),
                            " ",
                            React.createElement(Typography, { variant: "subtitle2", component: "span" },
                                "at row ID ",
                                error.rowIndex))) : (React.createElement(React.Fragment, null,
                            React.createElement(Typography, { variant: "subtitle2", component: "span" }, "This would normally be found in column"),
                            " ",
                            React.createElement(Typography, { variant: "subtitle2", component: "span", sx: { fontWeight: 800 } }, BIDSFieldNameToDisplayName[error.fieldName]),
                            ` at row ID ${error.rowIndex}.`,
                            React.createElement(Typography, { variant: "subtitle2" }, "However this column is currently not present in the spreadsheet. Use the \"ADD COLUMN\" button to add this column in if necessary."))) })))))))));
});
//# sourceMappingURL=BIDSDataGridErrorPopover.js.map
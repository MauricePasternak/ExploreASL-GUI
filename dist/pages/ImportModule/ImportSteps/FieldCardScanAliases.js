import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import FormHelperText from "@mui/material/FormHelperText";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import React from "react";
import { Controller } from "react-hook-form";
function FieldCardScanAliases({ control, name }) {
    return (React.createElement(Controller, { control: control, name: name, render: ({ field, fieldState }) => {
            const hasError = !!fieldState.error;
            const scanAliasMapping = Object.entries(field.value);
            const scanAliases = new Set(Object.values(field.value));
            const scanOptions = [
                {
                    label: "T1 Structural Scans",
                    value: "T1w",
                    disabled: scanAliases.has("T1w"),
                },
                {
                    label: "T2 Structural Scans",
                    value: "T2w",
                    disabled: scanAliases.has("T2w"),
                },
                {
                    label: "FLAIR Structural Scans",
                    value: "FLAIR",
                    disabled: scanAliases.has("FLAIR"),
                },
                {
                    label: "ASL Functional Scans",
                    value: "ASL4D",
                    disabled: scanAliases.has("ASL4D"),
                },
                {
                    label: "Proton-Density (M0) Scans",
                    value: "M0",
                    disabled: scanAliases.has("M0"),
                },
                { label: "Ignore this Folder", value: "Ignore" },
            ];
            const handleScanAliasChange = (e, folderName) => {
                const newMapping = Object.assign(Object.assign({}, field.value), { [folderName]: e.target.value });
                field.onChange(newMapping);
            };
            const renderAliases = () => scanAliasMapping.map(([folderName, scanAlias], index) => (React.createElement(ListItem, { key: `${index}_${folderName}`, sx: {
                    display: "grid",
                    gridTemplateColumns: "minmax(min(100px, 100%), 0.45fr) 130px minmax(min(200px, 100%), 1fr)",
                }, divider: index < scanAliasMapping.length - 1 },
                React.createElement(Typography, { noWrap: true, variant: "h6" }, folderName),
                React.createElement(Typography, { sx: { mx: "10px" } }, "corresponds to"),
                React.createElement(Select, { variant: "outlined", fullWidth: true, sx: { minWidth: "150px" }, value: scanAlias, onChange: e => handleScanAliasChange(e, folderName) }, scanOptions.map((option, index) => {
                    return (React.createElement(MenuItem, Object.assign({ key: `label_${option.label}_${index}` }, option), option.label));
                })))));
            return scanAliasMapping.length > 0 ? (React.createElement(Box, null,
                React.createElement(Card, null,
                    React.createElement(CardHeader, { sx: { bgcolor: hasError ? "error.main" : "primary.main", color: "primary.contrastText" }, title: "Scan Aliases" }),
                    React.createElement(CardContent, null,
                        React.createElement(List, null,
                            React.createElement(ListItem, { sx: { justifyContent: "space-between" } },
                                React.createElement(Typography, { variant: "h6" }, "Folder Name"),
                                React.createElement(Typography, { variant: "h6" }, "Scan Type")),
                            renderAliases()))),
                hasError && React.createElement(FormHelperText, { error: true }, fieldState.error.message))) : (React.createElement(Typography, { color: "error.main", variant: "h5" }, "Something went wrong. Please try again."));
        } }));
}
export default React.memo(FieldCardScanAliases);
//# sourceMappingURL=FieldCardScanAliases.js.map
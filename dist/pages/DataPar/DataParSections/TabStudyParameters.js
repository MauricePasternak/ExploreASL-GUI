import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import React from "react";
import { SecureLink } from "../../../components/NavComponents";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";
import { RHFFilepathInput, RHFFPDropzone, RHFSelect, RHFTextField } from "../../../components/RHFComponents";
export const TabStudyParameters = React.memo(({ control, trigger }) => {
    const { api } = window;
    return (React.createElement(Fade, { in: true },
        React.createElement(Box, { display: "flex", flexDirection: "column", gap: 4, position: "relative", padding: 2 },
            React.createElement(Typography, { variant: "h4" }, "Study Parameters"),
            React.createElement(OutlinedGroupBox, { label: "ExploreASL Parameters" },
                React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 2 },
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSelect, { control: control, name: "x.GUI.EASLType", label: "ExploreASL Type", options: [
                                { label: "ExploreASL from GitHub", value: "Github" },
                                { label: "Compiled ExploreASL", value: "Compiled" },
                            ], helperText: React.createElement(Typography, { variant: "caption" },
                                "Select Github if you cloned the",
                                " ",
                                React.createElement(SecureLink, { href: "https://github.com/ExploreASL/ExploreASL" }, "ExploreASL GitHub repository")) })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFFilepathInput, { control: control, name: "x.GUI.EASLPath", filepathType: "dir", dialogOptions: { properties: ["openDirectory"] }, label: "ExploreASL Path", helperText: "This is the folder that contains the ExploreASL executable." })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFFilepathInput, { control: control, name: "x.GUI.MATLABRuntimePath", filepathType: "dir", dialogOptions: { properties: ["openDirectory"] }, label: "MATLAB Runtime Path", helperText: "This is the path to the MATLAB Runtime folder version (i.e. v96, v912). Optional when ExploreASL Type is 'Github'" })))),
            React.createElement(OutlinedGroupBox, { label: "Study-Specific Parameters", mt: 2 },
                React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 2 },
                    React.createElement(Grid, { item: true, xs: 12, md: 6 },
                        React.createElement(RHFFilepathInput, { control: control, name: "x.GUI.StudyRootPath", trigger: trigger, triggerTarget: ["x.GUI.SUBJECTS", "x.dataset.exclusion"], filepathType: "dir", dialogOptions: { properties: ["openDirectory"] }, fullWidth: true, helperText: `This folder should contain BIDS-standard subfolders ("derivatives", "rawdata", "sourcedata")`, label: "Study's Root Folder" })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6 },
                        React.createElement(RHFTextField, { control: control, name: "x.dataset.name", fullWidth: true, helperText: "This is the name that will appear on ExploreASL-generated reports", label: "Study Name" })))),
            React.createElement(OutlinedGroupBox, { label: "Inclusion & Exclusion Criteria", mt: 2 },
                React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 2 },
                    React.createElement(Grid, { item: true, xs: 12, md: 6 },
                        React.createElement(RHFFPDropzone, { control: control, name: "x.GUI.SUBJECTS", trigger: trigger, triggerTarget: "x.dataset.exclusion", filepathType: "dir", dialogOptions: { properties: ["multiSelections", "openDirectory"] }, helperText: "Drop subject folders from StudyRoot/rawdata into this field", placeholderText: "Drop Subject folders from StudyRoot/rawdata here", label: "Subjects to Include", baseNamesOnly: true, extraFilterFunction: (filepath) => {
                                return api.path.parent(filepath).basename === "rawdata";
                            } })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6 },
                        React.createElement(RHFFPDropzone, { control: control, name: "x.dataset.exclusion", filepathType: "dir", dialogOptions: { properties: ["multiSelections", "openDirectory"] }, helperText: "Drop subject folders from StudyRoot/rawdata into this field", label: "Subjects to Exclude", placeholderText: "Drop Subject folders from StudyRoot/rawdata here", baseNamesOnly: true, extraFilterFunction: (filepath) => {
                                return api.path.parent(filepath).basename === "rawdata";
                            } })))))));
});
//# sourceMappingURL=TabStudyParameters.js.map
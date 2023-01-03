import FolderIcon from "@mui/icons-material/Folder";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import React from "react";
import { SecureLink } from "../../../components/NavComponents";
import { RHFFilepathInput, RHFSelect } from "../../../components/RHFComponents";
import { RHFMultiStepButtons } from "../../../components/RHFComponents/RHFMultiStep";
import { FabDialogWrapper, OutlinedGroupBox } from "../../../components/WrapperComponents";
import HelpImport__StepDefineRuntimeEnvs from "../../Help/HelpImport__StepDefineRuntimeEnvs";
import StructureByParts from "./StructureByParts";
const ExploreASLTypeOptions = [
    { label: "ExploreASL from GitHub", value: "Github" },
    { label: "Compiled ExploreASL", value: "Compiled" },
];
export function StepDefineRuntimeEnvs({ currentStep, setCurrentStep, control, handleSubmit, trigger, }) {
    const handleValidSubmit = (values) => {
        console.log("Step 'Define Runtime Envs' -- Valid Submit Values: ", values);
        setCurrentStep(currentStep + 1);
    };
    const handleInvalidSubmit = (errors) => {
        console.log("Step 'Define Runtime Envs' -- Invalid Submit Errors: ", errors);
    };
    return (React.createElement(Fade, { in: true },
        React.createElement("form", { onSubmit: handleSubmit(handleValidSubmit, handleInvalidSubmit) },
            React.createElement(Box, { mt: 1, pb: 5 },
                React.createElement(Card, null,
                    React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Define Runtime Environment"), subheader: React.createElement(Typography, null, "Specify filepaths and describe the structure of DICOM scanner output"), avatar: React.createElement(Avatar, null,
                            React.createElement(FolderIcon, null)), action: React.createElement(FabDialogWrapper, { maxWidth: "xl", PaperProps: { sx: { minWidth: "499px" } }, sx: { marginTop: "40px" } },
                            React.createElement(HelpImport__StepDefineRuntimeEnvs, null)) }),
                    React.createElement(Divider, null),
                    React.createElement(CardContent, null,
                        React.createElement(OutlinedGroupBox, { label: "ExploreASL Runtime", labelBackgroundColor: (theme) => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff"), mt: 3 },
                            React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 1 },
                                React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                                    React.createElement(RHFSelect, { control: control, name: "EASLType", label: "ExploreASL Type", options: ExploreASLTypeOptions, helperText: React.createElement(Typography, { variant: "caption" },
                                            "Select Github if you cloned the",
                                            " ",
                                            React.createElement(SecureLink, { href: "https://github.com/ExploreASL/ExploreASL" }, "ExploreASL GitHub repository")) })),
                                React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                                    React.createElement(RHFFilepathInput, { control: control, name: "EASLPath", filepathType: "dir", dialogOptions: { properties: ["openDirectory"], title: "Select ExploreASL Directory" }, label: "ExploreASL Path", helperText: "This is the folder that contains the ExploreASL executable." })),
                                React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                                    React.createElement(RHFFilepathInput, { control: control, name: "MATLABRuntimePath", filepathType: "dir", dialogOptions: { properties: ["openDirectory"], title: "Select MATLAB Runtime v## Directory" }, label: "MATLAB Runtime Path", helperText: "This is the path to the MATLAB Runtime folder version (i.e. v96, v912). Optional when ExploreASL Type is 'Github'" })))),
                        React.createElement(OutlinedGroupBox, { label: "Study Structure", mt: 3, p: 0.5, labelBackgroundColor: (theme) => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff") },
                            React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 1 },
                                React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                                    React.createElement(RHFFilepathInput, { control: control, name: "StudyRootPath", filepathType: "dir", dialogOptions: { properties: ["openDirectory"] }, label: "Study Root Path", helperText: "This is the root of your dataset. Must contain a folder called sourcedata." })),
                                React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 8 },
                                    React.createElement(StructureByParts, { trigger: trigger, control: control, name: "SourcedataStructure" }))))))),
            React.createElement(RHFMultiStepButtons, { currentStep: currentStep, setCurrentStep: setCurrentStep }))));
}
//# sourceMappingURL=StepDefineRuntimeEnvs.js.map
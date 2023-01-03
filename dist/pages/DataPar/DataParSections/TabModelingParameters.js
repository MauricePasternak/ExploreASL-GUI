import CalculateIcon from "@mui/icons-material/Calculate";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import { useSetAtom } from "jotai";
import { range as lodashRange } from "lodash";
import React from "react";
import { RHFCheckable, RHFCheckableGroup, RHFSelect, RHFSlider, } from "../../../components/RHFComponents";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";
import { atomDataParSliceReadoutTimeDialogOpen } from "../../../stores/DataParStore";
const SliceReadoutTimeMarks = lodashRange(0, 101, 10).map((i) => ({ label: i.toString(), value: i }));
const LambdaMarks = [
    { label: "0.01", value: 0.01 },
    { label: "0.25", value: 0.25 },
    { label: "0.5", value: 0.5 },
    { label: "0.75", value: 0.75 },
    { label: "1", value: 1 },
    { label: "1.25", value: 1.25 },
];
const T2ArtMarks = [
    { label: 1, value: 1 },
    ...lodashRange(10, 101, 10).map((i) => ({ label: i.toString(), value: i })),
];
const T1TimeTissueMarks = [
    { label: 1, value: 1 },
    ...lodashRange(1000, 5001, 1000).map((i) => ({ label: i.toString(), value: i })),
];
const T1TimeBloodMarks = [
    { label: 1, value: 1 },
    ...lodashRange(1000, 5001, 1000).map((i) => ({ label: i.toString(), value: i })),
];
const ApplyQuantOptions = [
    { label: "Apply Scale Slopes to ASL Volumes", value: 1 },
    { label: "Apply Scale Slopes to M0 Volumes", value: 1 },
    { label: "Convert PWI arbitrary units to standard", value: 1 },
    { label: "Quantify M0 arbitrary units", value: 1 },
    { label: "Perform division by M0", value: 1 },
    { label: "Apply all scaling", value: 1 },
];
const nCompartmentsOptions = [
    { label: "Single Compartment", value: 1 },
    { label: "Dual Compartment", value: 2 },
];
export const TabModelingParameters = React.memo(({ control }) => {
    const setSliceReadoutTimeDialogOpen = useSetAtom(atomDataParSliceReadoutTimeDialogOpen);
    return (React.createElement(Fade, { in: true },
        React.createElement(Box, { display: "flex", flexDirection: "column", gap: 4, position: "relative", padding: 2 },
            React.createElement(Typography, { variant: "h4" }, "Modeling Parameters"),
            React.createElement(OutlinedGroupBox, { label: "Ancillary ASL Acquisition Backup Parameters" },
                React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 2, alignItems: "center" },
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(Button, { fullWidth: true, variant: "contained", size: "large", sx: { minHeight: 70 }, endIcon: React.createElement(CalculateIcon, { fontSize: "large" }), onClick: () => setSliceReadoutTimeDialogOpen(true) }, "Help me calculate Slice Readout Time")),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSlider, { control: control, name: "x.Q.SliceReadoutTime", label: "Slice Readout Time", helperText: "This field is only required for studies containing 2D acquisitions. Units are in milliseconds. Values are typically between 20 and 65. This should be set to 0 for 3D acquisitions.", min: 0, max: 100, step: 1, marks: SliceReadoutTimeMarks, renderTextfields: true, textFieldProps: { sx: { ml: 3 } } })))),
            React.createElement(OutlinedGroupBox, { label: "CBF Quantification Parameters" },
                React.createElement(Grid, { container: true, rowSpacing: 3, columnSpacing: 3, marginTop: 0, padding: 2 },
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSlider, { control: control, name: "x.Q.Lambda", label: "Lambda", helperText: "See Alsop et al. 2015", min: 0.01, max: 1, step: 0.01, marks: LambdaMarks, renderTextfields: true, textFieldProps: { sx: { ml: 3 } } })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSlider, { control: control, name: "x.Q.T2art", label: "T2* of Arterial Blood", helperText: "Times are in milliseconds", min: 1, max: 100, step: 1, marks: T2ArtMarks, renderTextfields: true, textFieldProps: { sx: { ml: 3 } } })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSlider, { control: control, name: "x.Q.BloodT1", label: "T1 of Arterial Blood", helperText: "Times are in milliseconds", min: 1, max: 5000, step: 1, marks: T1TimeBloodMarks, renderTextfields: true, textFieldProps: { sx: { ml: 3, minWidth: 85 } } })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSlider, { control: control, name: "x.Q.TissueT1", label: "T1 of Brain Tissue", helperText: "Times are in milliseconds", min: 1, max: 5000, step: 1, marks: T1TimeTissueMarks, renderTextfields: true, textFieldProps: { sx: { ml: 3, minWidth: 85 } } })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFSelect, { control: control, name: "x.Q.nCompartments", options: nCompartmentsOptions, label: "Number of Compartments", helperText: "Select the number of compartments that the quantification modeling should be based on" })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFCheckable, { control: control, label: "Save CBF Timeseries", name: "x.Q.SaveCBF4D", valWhenChecked: true, valWhenUnchecked: false, helperText: "Will only produce a 4D timeseries if the original ASL series is a timeseries" })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFCheckable, { control: control, name: "x.Q.bUseBasilQuantification", valWhenChecked: true, valWhenUnchecked: false, label: "Perform BASIL quantification?", helperText: "Also performs BASIL quantification in additional to ExploreASL's quantification" })),
                    React.createElement(Grid, { item: true, xs: 12, md: 6, xl: 4 },
                        React.createElement(RHFCheckableGroup, { control: control, name: "x.Q.ApplyQuantification", type: "checkbox", keepUncheckedValue: true, uncheckedValue: 0, label: "CBF Quantification Control", options: ApplyQuantOptions })))))));
});
//# sourceMappingURL=TabModelingParameters.js.map
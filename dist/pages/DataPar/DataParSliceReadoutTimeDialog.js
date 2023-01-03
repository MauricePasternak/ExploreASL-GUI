import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import { useAtom } from "jotai";
import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { DataParSliceReadoutTimeCalcSchema } from "../../common/schemas/DataParSchemas/DataParSliceReadoutTimeCalcSchema";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import { RHFSelect, RHFSlider } from "../../components/RHFComponents";
import { atomDataParSliceReadoutTimeDialogOpen, defaultSliceReadoutTimeCalcValues } from "../../stores/DataParStore";
const DataParSliceReadoutTimeResolver = YupResolverFactoryBase(DataParSliceReadoutTimeCalcSchema);
const DataParSliceReadoutTimeASLTypeOptions = [
    { value: "PASL", label: "PASL" },
    { value: "CASL", label: "CASL" },
    { value: "PCASL", label: "PCASL" },
];
function estimateSliceReadoutTime(data) {
    if (data.ArterialSpinLabelingType === "PASL") {
        return Math.round((data.RepetitionTime - data.PostLabelingDelay) / data.NSlices);
    }
    else {
        return Math.round((data.RepetitionTime - data.PostLabelingDelay - data.LabelingDuration) / data.NSlices);
    }
}
export const DataParSliceReadoutTimeDialog = ({ setValue }) => {
    // Inner form state
    const { control, reset, getValues, handleSubmit, watch } = useForm({
        defaultValues: defaultSliceReadoutTimeCalcValues,
        resolver: DataParSliceReadoutTimeResolver,
    });
    // Inner State
    const [open, setOpen] = useAtom(atomDataParSliceReadoutTimeDialogOpen);
    const [currentValue, setCurrentValue] = useState(estimateSliceReadoutTime(getValues()));
    // Reflect form changes to inner state
    useEffect(() => {
        const subscription = watch((data) => {
            setCurrentValue(estimateSliceReadoutTime(data));
        });
        return () => subscription.unsubscribe();
    }, [watch]);
    const handleValidSubmit = (data) => {
        console.log(`DataParSliceReadoutTimeDialog: handleValidSubmit: data: ${JSON.stringify(data, null, 2)}`);
        const SliceReadoutTime = estimateSliceReadoutTime(data);
        console.log(`DataParSliceReadoutTimeDialog: handleValidSubmit: SliceReadoutTime: ${SliceReadoutTime}`);
        setValue("x.Q.SliceReadoutTime", SliceReadoutTime);
        setOpen(false);
    };
    const handleInvalidSubmit = (errors) => {
        console.log(`DataParSliceReadoutTimeDialog: handleInvalidSubmit: errors: ${JSON.stringify(errors, null, 2)}`);
    };
    return (React.createElement(Dialog, { open: open, maxWidth: "md" },
        React.createElement(DialogTitle, null, "Estimate Slice ReadoutTime"),
        React.createElement(DialogContent, null,
            React.createElement(DialogContentText, null, "Specifying the following fields will allow for an estimation of the Slice Readout Time"),
            React.createElement(Stack, { gap: 3 },
                React.createElement(Divider, { sx: { marginTop: 2 } }),
                React.createElement(RHFSlider, { control: control, name: "RepetitionTime", min: 1, max: 10000, step: 1, renderTextfields: true, label: "Minimal Repetition Time", helperText: "Units are in milliseconds. This is usually somewhat shorter (~100-500ms) than the Repetition Time. It excludes the time between the last 2D slice being acquired and the start of the next Repetition Time sequence." }),
                React.createElement(RHFSelect, { control: control, name: "ArterialSpinLabelingType", options: DataParSliceReadoutTimeASLTypeOptions, fullWidth: true, label: "Arterial Spin Labeling Type", helperText: "The type of ASL labeling strategy used" }),
                React.createElement(RHFSlider, { control: control, name: "PostLabelingDelay", min: 1, max: 5000, step: 1, renderTextfields: true, label: "Post Labeling Delay", helperText: "Units are in milliseconds. For PASL acquisitions, use the value of the Inversion Time (TI) for this field." }),
                React.createElement(RHFSlider, { control: control, name: "LabelingDuration", min: 1, max: 5000, step: 1, renderTextfields: true, label: getValues().ArterialSpinLabelingType === "PASL"
                        ? "Bolus Cut Off Delay Time (first value)"
                        : "Labeling Duration", helperText: "Units are in milliseconds. For PCASL/CASL acquisitions, use the Labeling Duration value. Otherwise, use the first value of the Bolus Cut Off Delay Time (if Q2TIPS; QUIPSS and QUIPSSII have only the single value)." }),
                React.createElement(RHFSlider, { control: control, name: "NSlices", min: 1, max: 200, step: 1, renderTextfields: true, label: "Number of Slices in a single volume", helperText: "This is the number of 2D slices that make up a single ASL brain volume" }),
                React.createElement(DialogContentText, { variant: "h5" }, `Current Estimated Slice Readout Time: ${estimateSliceReadoutTime(getValues())}`))),
        React.createElement(DialogActions, null,
            React.createElement(Button, { type: "button", onClick: () => {
                    reset();
                    setOpen(false);
                } }, "Cancel"),
            React.createElement(Button, { disabled: currentValue > 100 || currentValue <= 0, onClick: handleSubmit(handleValidSubmit, handleInvalidSubmit) }, "OK"))));
};
//# sourceMappingURL=DataParSliceReadoutTimeDialog.js.map
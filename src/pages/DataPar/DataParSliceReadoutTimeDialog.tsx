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
import { SubmitErrorHandler, SubmitHandler, useForm, UseFormSetValue } from "react-hook-form";
import { DataParSliceReadoutTimeCalcSchema } from "../../common/schemas/DataParSchemas/DataParSliceReadoutTimeCalcSchema";
import { DataParValuesType } from "../../common/types/ExploreASLDataParTypes";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import { RHFSelect, RHFSelectOption, RHFSlider } from "../../components/RHFComponents";
import { atomDataParSliceReadoutTimeDialogOpen, defaultSliceReadoutTimeCalcValues } from "../../stores/DataParStore";

type DataParSliceReadoutTimeDialogProps = {
	setValue: UseFormSetValue<DataParValuesType>;
};

const DataParSliceReadoutTimeResolver = YupResolverFactoryBase<any, typeof defaultSliceReadoutTimeCalcValues>(
	DataParSliceReadoutTimeCalcSchema
);

const DataParSliceReadoutTimeASLTypeOptions: RHFSelectOption<
	typeof defaultSliceReadoutTimeCalcValues,
	"ArterialSpinLabelingType"
>[] = [
	{ value: "PASL", label: "PASL" },
	{ value: "CASL", label: "CASL" },
	{ value: "PCASL", label: "PCASL" },
];

function estimateSliceReadoutTime(data: typeof defaultSliceReadoutTimeCalcValues) {
	if (data.ArterialSpinLabelingType === "PASL") {
		return Math.round((data.RepetitionTime - data.PostLabelingDelay) / data.NSlices);
	} else {
		return Math.round((data.RepetitionTime - data.PostLabelingDelay - data.LabelingDuration) / data.NSlices);
	}
}

export const DataParSliceReadoutTimeDialog = ({ setValue }: DataParSliceReadoutTimeDialogProps) => {
	// Inner form state
	const { control, reset, getValues, handleSubmit, watch } = useForm<typeof defaultSliceReadoutTimeCalcValues>({
		defaultValues: defaultSliceReadoutTimeCalcValues,
		resolver: DataParSliceReadoutTimeResolver,
	});

	// Inner State
	const [open, setOpen] = useAtom(atomDataParSliceReadoutTimeDialogOpen);
	const [currentValue, setCurrentValue] = useState(estimateSliceReadoutTime(getValues()));

	// Reflect form changes to inner state
	useEffect(() => {
		const subscription = watch((data) => {
			setCurrentValue(estimateSliceReadoutTime(data as typeof defaultSliceReadoutTimeCalcValues));
		});
		return () => subscription.unsubscribe();
	}, [watch]);

	const handleValidSubmit: SubmitHandler<typeof defaultSliceReadoutTimeCalcValues> = (data) => {
		console.log(`DataParSliceReadoutTimeDialog: handleValidSubmit: data: ${JSON.stringify(data, null, 2)}`);
		const SliceReadoutTime = estimateSliceReadoutTime(data);
		console.log(`DataParSliceReadoutTimeDialog: handleValidSubmit: SliceReadoutTime: ${SliceReadoutTime}`);
		setValue("x.Q.SliceReadoutTime", SliceReadoutTime);
		setOpen(false);
	};

	const handleInvalidSubmit: SubmitErrorHandler<typeof defaultSliceReadoutTimeCalcValues> = (errors) => {
		console.log(`DataParSliceReadoutTimeDialog: handleInvalidSubmit: errors: ${JSON.stringify(errors, null, 2)}`);
	};

	return (
		<Dialog open={open} maxWidth="md">
			<DialogTitle>Estimate Slice ReadoutTime</DialogTitle>
			<DialogContent>
				<DialogContentText>
					Specifying the following fields will allow for an estimation of the Slice Readout Time
				</DialogContentText>
				<Stack gap={3}>
					<Divider sx={{ marginTop: 2 }} />
					<RHFSlider
						control={control}
						name="RepetitionTime"
						min={1}
						max={10_000}
						step={1}
						renderTextfields
						label="Minimal Repetition Time"
						helperText="Units are in milliseconds. This is usually somewhat shorter (~100-500ms) than the Repetition Time. It excludes the time between the last 2D slice being acquired and the start of the next Repetition Time sequence."
					/>
					<RHFSelect
						control={control}
						name="ArterialSpinLabelingType"
						options={DataParSliceReadoutTimeASLTypeOptions}
						fullWidth
						label="Arterial Spin Labeling Type"
						helperText="The type of ASL labeling strategy used"
					/>
					<RHFSlider
						control={control}
						name="PostLabelingDelay"
						min={1}
						max={5000}
						step={1}
						renderTextfields
						label="Post Labeling Delay"
						helperText="Units are in milliseconds. For PASL acquisitions, use the value of the Inversion Time (TI) for this field."
					/>
					<RHFSlider
						control={control}
						name="LabelingDuration"
						min={1}
						max={5000}
						step={1}
						renderTextfields
						label={
							getValues().ArterialSpinLabelingType === "PASL"
								? "Bolus Cut Off Delay Time (first value)"
								: "Labeling Duration"
						}
						helperText="Units are in milliseconds. For PCASL/CASL acquisitions, use the Labeling Duration value. Otherwise, use the first value of the Bolus Cut Off Delay Time (if Q2TIPS; QUIPSS and QUIPSSII have only the single value)."
					/>
					<RHFSlider
						control={control}
						name="NSlices"
						min={1}
						max={200}
						step={1}
						renderTextfields
						label="Number of Slices in a single volume"
						helperText="This is the number of 2D slices that make up a single ASL brain volume"
					/>
					<DialogContentText variant="h5">{`Current Estimated Slice Readout Time: ${estimateSliceReadoutTime(
						getValues()
					)}`}</DialogContentText>
				</Stack>
			</DialogContent>
			<DialogActions>
				<Button
					type="button"
					onClick={() => {
						reset();
						setOpen(false);
					}}
				>
					Cancel
				</Button>
				<Button
					disabled={currentValue > 100 || currentValue <= 0}
					onClick={handleSubmit(handleValidSubmit, handleInvalidSubmit)}
				>
					OK
				</Button>
			</DialogActions>
		</Dialog>
	);
};

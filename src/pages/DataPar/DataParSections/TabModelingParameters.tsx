import CalculateIcon from "@mui/icons-material/Calculate";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import { useSetAtom } from "jotai";
import { range as lodashRange } from "lodash";
import React from "react";
import { Control, UseFormTrigger } from "react-hook-form";
import { DataParValuesType } from "../../../common/types/ExploreASLDataParTypes";
import {
	RHFCheckable,
	RHFCheckableGroup,
	RHFCheckableOption,
	RHFSelect,
	RHFSelectOption,
	RHFSlider,
} from "../../../components/RHFComponents";
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

const ApplyQuantOptions: RHFCheckableOption<"checkbox", DataParValuesType, "x.Q.ApplyQuantification">[] = [
	{ label: "Apply Scale Slopes to ASL Volumes", value: 1 },
	{ label: "Apply Scale Slopes to M0 Volumes", value: 1 },
	{ label: "Convert PWI arbitrary units to standard", value: 1 },
	{ label: "Quantify M0 arbitrary units", value: 1 },
	{ label: "Perform division by M0", value: 1 },
	{ label: "Apply all scaling", value: 1 },
];

const nCompartmentsOptions: RHFSelectOption<DataParValuesType, "x.Q.nCompartments">[] = [
	{ label: "Single Compartment", value: 1 },
	{ label: "Dual Compartment", value: 2 },
];

type TabModelingParametersProps = {
	control: Control<DataParValuesType>;
	trigger: UseFormTrigger<DataParValuesType>;
};

export const TabModelingParameters = React.memo(({ control }: TabModelingParametersProps) => {
	const setSliceReadoutTimeDialogOpen = useSetAtom(atomDataParSliceReadoutTimeDialogOpen);

	return (
		<Fade in>
			<Box display="flex" flexDirection="column" gap={4} position="relative" padding={2}>
				<Typography variant="h4">Modeling Parameters</Typography>
				<OutlinedGroupBox label="Ancillary ASL Acquisition Backup Parameters">
					<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2} alignItems="center">
						<Grid item xs={12} md={6} xl={4}>
							<Button
								fullWidth
								variant="contained"
								size="large"
								sx={{ minHeight: 70 }}
								endIcon={<CalculateIcon fontSize="large" />}
								onClick={() => setSliceReadoutTimeDialogOpen(true)}
							>
								Help me calculate Slice Readout Time
							</Button>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSlider
								control={control}
								name="x.Q.SliceReadoutTime"
								label="Slice Readout Time"
								helperText="This field is only required for studies containing 2D acquisitions. Units are in milliseconds. Values are typically between 20 and 65. This should be set to 0 for 3D acquisitions."
								min={0}
								max={100}
								step={1}
								marks={SliceReadoutTimeMarks}
								renderTextfields
								textFieldProps={{ sx: { ml: 3 } }}
							/>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
				<OutlinedGroupBox label="CBF Quantification Parameters">
					<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSlider
								control={control}
								name="x.Q.Lambda"
								label="Lambda"
								helperText="See Alsop et al. 2015"
								min={0.01}
								max={1}
								step={0.01}
								marks={LambdaMarks}
								renderTextfields
								textFieldProps={{ sx: { ml: 3 } }}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSlider
								control={control}
								name="x.Q.T2art"
								label="T2* of Arterial Blood"
								helperText="Times are in milliseconds"
								min={1}
								max={100}
								step={1}
								marks={T2ArtMarks}
								renderTextfields
								textFieldProps={{ sx: { ml: 3 } }}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSlider
								control={control}
								name="x.Q.BloodT1"
								label="T1 of Arterial Blood"
								helperText="Times are in milliseconds"
								min={1}
								max={5000}
								step={1}
								marks={T1TimeBloodMarks}
								renderTextfields
								textFieldProps={{ sx: { ml: 3, minWidth: 85 } }}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSlider
								control={control}
								name="x.Q.TissueT1"
								label="T1 of Brain Tissue"
								helperText="Times are in milliseconds"
								min={1}
								max={5000}
								step={1}
								marks={T1TimeTissueMarks}
								renderTextfields
								textFieldProps={{ sx: { ml: 3, minWidth: 85 } }}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSelect
								control={control}
								name="x.Q.nCompartments"
								options={nCompartmentsOptions}
								label="Number of Compartments"
								helperText="Select the number of compartments that the quantification modeling should be based on"
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								control={control}
								label="Save CBF Timeseries"
								name="x.Q.SaveCBF4D"
								valWhenChecked={true}
								valWhenUnchecked={false}
								helperText="Will only produce a 4D timeseries if the original ASL series is a timeseries"
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								control={control}
								name="x.Q.bUseBasilQuantification"
								valWhenChecked={true}
								valWhenUnchecked={false}
								label="Perform BASIL quantification?"
								helperText="Also performs BASIL quantification in additional to ExploreASL's quantification"
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckableGroup
								control={control}
								name="x.Q.ApplyQuantification"
								type="checkbox"
								keepUncheckedValue
								uncheckedValue={0}
								label="CBF Quantification Control"
								options={ApplyQuantOptions}
							/>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
			</Box>
		</Fade>
	);
});

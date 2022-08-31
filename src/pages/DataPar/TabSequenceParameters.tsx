import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { partialRight as lodashPartialRight, range as lodashRange } from "lodash";
import React from "react";
import { Control, UseFormTrigger } from "react-hook-form";
import { DataParValuesType } from "../../common/types/ExploreASLDataParTypes";
import { getNumbersFromDelimitedString } from "../../common/utilityFunctions/stringFunctions";
import RHFCheckables, { RHFCheckablesOption } from "../../components/FormComponents/RHFCheckables";
import RHFInterDepSelect, {
  RHFInterDepControlledSelectOption
} from "../../components/FormComponents/RHFInterDepSelect";
import RHFSelect, { RHFControlledSelectOption } from "../../components/FormComponents/RHFSelect";
import RHFSingleCheckable from "../../components/FormComponents/RHFSingleCheckable";
import RHFSlider from "../../components/FormComponents/RHFSlider";
import RHFTextfield from "../../components/FormComponents/RHFTextfield";
import OutlinedGroupBox from "../../components/OutlinedGroupBox";

const M0Options: RHFInterDepControlledSelectOption<DataParValuesType, "x.Q.M0">[] = [
  { label: "M0 Scan is already present in the dataset", value: "separate_scan" },
  { label: "Use mean of control ASL scans as an M0 substitute", value: "UseControlAsM0" },
];

const VendorOptions: RHFControlledSelectOption<DataParValuesType, "x.Q.Vendor">[] = [
  { label: "Siemens", value: "Siemens" },
  { label: "General Electric", value: "GE_product" },
  { label: "Philips", value: "Philips" },
];

const SequenceOptions: RHFControlledSelectOption<DataParValuesType, "x.Q.Sequence">[] = [
  { label: "3D GRaSE", value: "3D_GRASE" },
  { label: "3D Spiral", value: "3D_spiral" },
  { label: "2D EPI", value: "2D_EPI" },
];

const readoutDimOptions: RHFControlledSelectOption<DataParValuesType, "x.Q.readoutDim">[] = [
  { label: "2D", value: "2D" },
  { label: "3D", value: "3D" },
];

const LabellingOptions: RHFControlledSelectOption<DataParValuesType, "x.Q.LabelingType">[] = [
  { label: "Pseudo-continuous ASL", value: "CASL" },
  { label: "Pulsed ASL", value: "PASL" },
];

const BackgroundSuppressionNumberPulsesMarks = [...Array(11).keys()].map(i => ({ label: i.toString(), value: i }));
const LabelingDurationMarks = lodashRange(0, 5001, 1000).map(i => ({ label: i.toString(), value: i }));
const PostLabelingDelayMarks = lodashRange(0, 5001, 1000).map(i => ({ label: i.toString(), value: i }));
const SliceReadoutTimeMarks = lodashRange(0, 101, 10).map(i => ({ label: i.toString(), value: i }));
const LambdaMarks = [
  { label: "0.01", value: 0.01 },
  { label: "0.25", value: 0.25 },
  { label: "0.5", value: 0.5 },
  { label: "0.75", value: 0.75 },
  { label: "1", value: 1 },
  { label: "1.25", value: 1.25 },
];
const T2ArtMarks = [{ label: 1, value: 1 }, ...lodashRange(10, 101, 10).map(i => ({ label: i.toString(), value: i }))];
const T1TimeTissueMarks = [
  { label: 1, value: 1 },
  ...lodashRange(1000, 5001, 1000).map(i => ({ label: i.toString(), value: i })),
];
const T1TimeBloodMarks = [
  { label: 1, value: 1 },
  ...lodashRange(1000, 5001, 1000).map(i => ({ label: i.toString(), value: i })),
];

const ApplyQuantOptions: RHFCheckablesOption<"checkbox", DataParValuesType, "x.Q.ApplyQuantification">[] = [
  { label: "Apply Scale Slopes to ASL Volumes", value: 1 },
  { label: "Apply Scale Slopes to M0 Volumes", value: 1 },
  { label: "Convert PWI arbitrary units to standard", value: 1 },
  { label: "Quantify M0 arbitrary units", value: 1 },
  { label: "Perform division by M0", value: 1 },
];

const nCompartmentsOptions: RHFControlledSelectOption<DataParValuesType, "x.Q.nCompartments">[] = [
  { label: "Single Compartment", value: 1 },
  { label: "Dual Compartment", value: 2 },
];

function TabSequenceParameters({
  control,
  trigger,
}: {
  control: Control<DataParValuesType>;
  trigger: UseFormTrigger<DataParValuesType>;
}) {
  return (
    <Fade in>
      <Box display="flex" flexDirection="column" gap={4} position="relative" padding={2}>
        <Typography variant="h4">Sequence Parameters</Typography>
        <OutlinedGroupBox label="ASL Scan Acquisition Parameters">
          <Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSelect
                control={control}
                name="x.Q.Vendor"
                options={VendorOptions}
                label="Scanner Manufacturer"
                helperText="Select the name of the manufacturer of the MRI scanner which acquired the ASL scans"
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSelect
                control={control}
                name="x.Q.Sequence"
                options={SequenceOptions}
                label="Sequence"
                helperText="Select the type of ASL sequence that was used"
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSelect
                control={control}
                name="x.Q.readoutDim"
                options={readoutDimOptions}
                label="Readout Dimension"
                helperText="Select the dimensionality of the ASL scan output"
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSelect
                control={control}
                name="x.Q.LabelingType"
                options={LabellingOptions}
                label="Labeling Type"
                helperText="Select the type of ASL labeling used"
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFInterDepSelect
                control={control}
                name="x.Q.M0"
                trigger={trigger}
                triggerTarget="x.Q.BackgroundSuppressionPulseTime"
                options={M0Options}
                label="M0 Strategy"
                helperText="Was there an M0 scan acquired or should a substitute be made?"
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSlider
                control={control}
                name="x.Q.BackgroundSuppressionNumberPulses"
                min={0}
                max={10}
                step={1}
                label="Background Suppression Number of Pulses"
                marks={BackgroundSuppressionNumberPulsesMarks}
                helperText="Keep at zero if you wish this field to be ignored"
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFTextfield
                control={control}
                name="x.Q.BackgroundSuppressionPulseTime"
                fullWidth
                label="Background Pulse Suppression Timings"
                helperText="Specify as comma-separated positive numbers representing timings in milliseconds. Leave blank if not applicable."
                handleInnerToField={lodashPartialRight(getNumbersFromDelimitedString, ",", "float")}
                handleFieldToInner={(numbers: number[]) => (numbers && Array.isArray(numbers)) ? numbers.join(", ") : ""}
                debounceTime={2000}
                shouldUpdateAfterDebounce
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSlider
                control={control}
                name="x.Q.LabelingDuration"
                label="Labeling Duration"
                helperText="Units are in milliseconds"
                min={0}
                max={5000}
                step={1}
                marks={LabelingDurationMarks}
                renderTextfields
                textFieldProps={{ sx: { ml: 3, minWidth: 85 } }}
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSlider
                control={control}
                name="x.Q.Initial_PLD"
                label="Post Label Delay"
                helperText="Units are in milliseconds"
                min={0}
                max={5000}
                step={1}
                marks={PostLabelingDelayMarks}
                renderTextfields
                textFieldProps={{ sx: { ml: 3, minWidth: 85 } }}
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFSlider
                control={control}
                name="x.Q.SliceReadoutTime"
                label="Slice Readout Time"
                helperText="Units are in milliseconds"
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
              <RHFCheckables
                control={control}
                name="x.Q.ApplyQuantification"
                type="checkbox"
                keepUncheckedValue
                uncheckedValue={0}
                label="CBF Quantification Control"
                options={ApplyQuantOptions}
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <Stack rowGap={3}>
                <RHFSelect
                  control={control}
                  name="x.Q.nCompartments"
                  options={nCompartmentsOptions}
                  label="Number of Compartments"
                  helperText="Select the number of compartments that the quantification model is based on"
                />
                <RHFSingleCheckable
                  control={control}
                  label="Save CBF Timeseries"
                  name="x.Q.SaveCBF4D"
                  valWhenChecked={true}
                  valWhenUnchecked={false}
                  helperText="Will only produce a 4D timeseries if the original ASL series is a timeseries"
                />
              </Stack>
            </Grid>
          </Grid>
        </OutlinedGroupBox>
      </Box>
    </Fade>
  );
}

export default React.memo(TabSequenceParameters);

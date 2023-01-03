import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import { isUndefined as lodashIsUndefined } from "lodash";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { range as lodashRange } from "lodash";
import React from "react";
import { Control, UseFieldArrayRemove, UseFormSetValue, UseFormTrigger, useWatch } from "react-hook-form";
import {
	ASLLabelingType,
	ImportSchemaType,
	M0TypeType,
	PulseSequenceType,
} from "../../../common/types/ImportSchemaTypes";
import { getNumbersFromDelimitedString } from "../../../common/utils/stringFunctions";
import ExpandMore from "../../../components/ExpandMore";
import {
	RHFCheckable,
	RHFFPDropzone,
	RHFSelect,
	RHFSelectOption,
	RHFSlider,
	RHFTextField,
} from "../../../components/RHFComponents";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";
import { ImportSingleContextDefaultValueMapping } from "../../../stores/ImportPageStore";
import { BolusCutOffDelayTimeSlider } from "./BolusCutOffDelayTimeSlider";

type SingleImportContextProps = {
	contextIndex: number;
	control: Control<ImportSchemaType>;
	remove: UseFieldArrayRemove;
	trigger: UseFormTrigger<ImportSchemaType>;
	setFieldValue: UseFormSetValue<ImportSchemaType>;
};

const ASLSeriesPatternOptions: RHFSelectOption<ImportSchemaType, `ImportContexts.${number}.ASLSeriesPattern`>[] = [
	{ label: "Alternating Control, Label Series", value: "control-label" },
	{ label: "Alternating Label, Control Series", value: "label-control" },
	{ label: "Intermediate Perfusion Weighted Image", value: "deltam" },
	{ label: "Complete Perfusion (CBF) Image", value: "cbf" },
];

const ASLManufacturerOptions: RHFSelectOption<ImportSchemaType, `ImportContexts.${number}.Manufacturer`>[] = [
	{ label: "General Electric (GE)", value: "GE" },
	{ label: "Philips", value: "Philips" },
	{ label: "Siemens", value: "Siemens" },
];

const MRIPulseSequenceTypeOptions: RHFSelectOption<ImportSchemaType, `ImportContexts.${number}.PulseSequenceType`>[] = [
	{ label: "3D Acquisition with Spiral Gradient Recalled EPI (Spiral)", value: "3D_spiral" },
	{ label: "3D Acquisition with Gradient & Spin EPI (GRASE)", value: "3D_GRASE" },
	{ label: "2D Acquisition with Spin EPI (EPI)", value: "2D_EPI" },
];

const ASLTypeOptions: RHFSelectOption<ImportSchemaType, `ImportContexts.${number}.ArterialSpinLabelingType`>[] = [
	{ label: "Pulsed ASL", value: "PASL" },
	{ label: "Pseudo-continuous ASL", value: "PCASL" },
	{ label: "Continuous ASL", value: "CASL" },
];

const ASLBolusCutOffTechniqueOptions: RHFSelectOption<
	ImportSchemaType,
	`ImportContexts.${number}.BolusCutOffTechnique`
>[] = [
	{ label: "No technique was used", value: "" },
	{ label: "QUIPSS", value: "QUIPSS" },
	{ label: "QUIPSSII", value: "QUIPSSII" },
	{ label: "Q2TIPS", value: "Q2TIPS" },
];

const M0TypeOptions: RHFSelectOption<ImportSchemaType, `ImportContexts.${number}.M0Type`>[] = [
	{ label: "The M0 is a separate entity", value: "Separate" },
	{ label: "The M0 is within the ASL series", value: "Included" },
	{ label: "No M0 exists for these scans", value: "Absent" },
	{ label: "Use a single number estimate instead", value: "Estimate" },
];

function SingleImportContext({ contextIndex, control, remove, trigger, setFieldValue }: SingleImportContextProps) {
	const isFirst = contextIndex === 0;
	const [expanded, setExpanded] = React.useState(true);
	const contextValues = useWatch({ control, name: `ImportContexts.${contextIndex}` });

	console.log(`Single Import Context ${contextIndex} rendered with values:`, contextValues);

	// Handlers
	const handleM0TypeChange = (m0Type: M0TypeType) => {
		if (m0Type !== "Estimate") {
			setFieldValue(`ImportContexts.${contextIndex}.M0Estimate`, undefined);
		} else {
			setFieldValue(`ImportContexts.${contextIndex}.M0Estimate`, ImportSingleContextDefaultValueMapping.M0Estimate);
		}
	};
	const handlePulseSequenceTypeChange = (pulseSequenceType: PulseSequenceType) => {
		if (pulseSequenceType === "2D_EPI") {
			setFieldValue(
				`ImportContexts.${contextIndex}.SliceReadoutTime`,
				ImportSingleContextDefaultValueMapping.SliceReadoutTime
			);
		} else {
			setFieldValue(`ImportContexts.${contextIndex}.SliceReadoutTime`, undefined);
		}
	};
	const handleArterialSpinLabelingTypeChange = (aslType: ASLLabelingType) => {
		if (aslType === "PASL") {
			setFieldValue(`ImportContexts.${contextIndex}.LabelingDuration`, undefined);
			setFieldValue(
				`ImportContexts.${contextIndex}.BolusCutOffFlag`,
				ImportSingleContextDefaultValueMapping.BolusCutOffFlag
			);
			setFieldValue(
				`ImportContexts.${contextIndex}.BolusCutOffTechnique`,
				ImportSingleContextDefaultValueMapping.BolusCutOffTechnique
			);
			setFieldValue(
				`ImportContexts.${contextIndex}.BolusCutOffDelayTime`,
				ImportSingleContextDefaultValueMapping.BolusCutOffDelayTime
			);
		} else {
			if (!contextValues.LabelingDuration) {
				setFieldValue(
					`ImportContexts.${contextIndex}.LabelingDuration`,
					ImportSingleContextDefaultValueMapping.LabelingDuration
				);
			}
			setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffFlag`, undefined);
			setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffTechnique`, undefined);
			setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffDelayTime`, undefined);
		}
	};

	return (
		<Card>
			<CardHeader
				title={<Typography variant="h6">Acquisition Context {contextIndex + 1}</Typography>}
				avatar={
					<ExpandMore expand={expanded} onClick={() => setExpanded(!expanded)}>
						<ExpandMoreIcon />
					</ExpandMore>
				}
				action={
					<Box>
						{!isFirst && (
							<IconButton onClick={() => remove(contextIndex)}>
								<CloseIcon />
							</IconButton>
						)}
					</Box>
				}
			/>
			<Divider />
			<Collapse in={expanded}>
				<CardContent>
					<RHFFPDropzone
						control={control}
						name={`ImportContexts.${contextIndex}.Paths`}
						filepathType="dir"
						dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
						label="Subjects/Visits/Sessions that this Context Applies To"
						helperText="Drop Subject, Visit, and/or Session folders into this field to indicate that these are the items that are encompassed by this context."
						placeholderText="Drop Folders Here"
					/>
					<OutlinedGroupBox
						label="ASL Context"
						mt={3}
						labelBackgroundColor={(theme) => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
					>
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
							<Grid item xs={12} md={6} xl={3}>
								<RHFSelect
									control={control}
									name={`ImportContexts.${contextIndex}.ASLSeriesPattern`}
									label="ASL Series Pattern"
									options={ASLSeriesPatternOptions}
									helperText="Describes the general pattern of the ASL series (i.e. does it alternate between control and label volumes?)."
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFSlider
									control={control}
									name={`ImportContexts.${contextIndex}.NVolumes`}
									label="Number of Volumes in ASL Series"
									min={1}
									step={1}
									max={250}
									renderTextfields
									helperText="NOTE: If there aren't any embedded M0 or dummy volumes, this number is optional and can be ignored."
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFTextField
									control={control}
									name={`ImportContexts.${contextIndex}.M0PositionInASL`}
									label="M0 Positions within ASL Series"
									fullWidth
									debounceTime={2000}
									helperText="Describe the locations of any embeded M0 scans that are contained within the ASL timeseries. Specify as comma-separated positive integers. Leave blank if not applicable."
									innerToField={getNumbersFromDelimitedString}
									fieldToInner={(numbers: number[]) => (numbers && Array.isArray(numbers) ? numbers.join(", ") : "")}
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFTextField
									control={control}
									name={`ImportContexts.${contextIndex}.DummyPositionInASL`}
									label="Dummy Positions within ASL Series"
									fullWidth
									debounceTime={2000}
									helperText="Describe the locations of any dummy scans that should be extracted out of the ASL timeseries. Specify as comma-separated positive integers. Leave blank if not applicable."
									innerToField={getNumbersFromDelimitedString}
									fieldToInner={(numbers: number[]) => (numbers && Array.isArray(numbers) ? numbers.join(", ") : "")}
								/>
							</Grid>
						</Grid>
					</OutlinedGroupBox>
					<OutlinedGroupBox
						label="M0 Scan Information"
						mt={5}
						labelBackgroundColor={(theme) => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
					>
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
							<Grid item xs={12} md={6} xl={3}>
								<RHFSelect
									control={control}
									name={`ImportContexts.${contextIndex}.M0Type`}
									label="M0 Type"
									helperText="The nature of the M0 scan (i.e. is it a separate scan or a volume within the ASL series?)."
									options={M0TypeOptions}
									onChange={handleM0TypeChange}
								/>
							</Grid>
							{contextValues.M0Type === "Estimate" && (
								<Grid item xs={12} md={6} xl={3}>
									<RHFSlider
										control={control}
										name={`ImportContexts.${contextIndex}.M0Estimate`}
										min={1}
										max={1_000_000_000}
										step={1}
										renderTextfields
										label="M0 Estimate"
										helperText="A numerical value to use as the M0 estimate if no M0 scan is available."
									/>
								</Grid>
							)}
						</Grid>
					</OutlinedGroupBox>
					<OutlinedGroupBox
						label="Additional ASL Sequence Information"
						mt={5}
						labelBackgroundColor={(theme) => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
					>
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
							<Grid item xs={12} md={6} xl={3}>
								<RHFSelect
									control={control}
									name={`ImportContexts.${contextIndex}.Manufacturer`}
									label="Scanner Manufacturer"
									helperText="The manufacturer of the scanner used to acquire the ASL series."
									options={ASLManufacturerOptions}
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFSlider
									control={control}
									name={`ImportContexts.${contextIndex}.MagneticFieldStrength`}
									renderTextfields
									min={0.1}
									max={14}
									step={0.1}
									label="Magnetic Field Strength (T)"
									helperText="Strength of the magnetic field used to acquire the ASL series."
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFSelect
									control={control}
									name={`ImportContexts.${contextIndex}.PulseSequenceType`}
									options={MRIPulseSequenceTypeOptions}
									label="MRI Pulse Sequence Type"
									helperText="The MRI pulse sequence used for image acquisition"
									onChange={handlePulseSequenceTypeChange}
								/>
							</Grid>
							{contextValues.PulseSequenceType === "2D_EPI" && (
								<Grid item xs={12} md={6} xl={3}>
									<RHFSlider
										control={control}
										name={`ImportContexts.${contextIndex}.SliceReadoutTime`}
										min={0.001}
										max={0.2}
										step={0.001}
										renderTextfields
										label="Timing between 2D Slice Readouts"
										helperText="The time elapsed between the completion of a 2D slice readout and the next complete 2D slice readout. Times are in seconds. This value is typically between 0.03 and 0.065 seconds."
									/>
								</Grid>
							)}
							<Grid item xs={12} md={6} xl={3}>
								<RHFSelect
									control={control}
									name={`ImportContexts.${contextIndex}.ArterialSpinLabelingType`}
									label="Arterial Spin Labeling Type"
									helperText="Describes the labeling strategy used during the ASL scan acquisition. ExploreASL will incorpate the same quantification strategy for CASL as PCASL."
									options={ASLTypeOptions}
									onChange={handleArterialSpinLabelingTypeChange}
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFTextField
									control={control}
									name={`ImportContexts.${contextIndex}.PostLabelingDelay`}
									label="Post Labeling Delay"
									fullWidth
									debounceTime={2000}
									helperText="Enter either a single positive number or a comma-separated list of numbers. Units are in seconds."
									innerToField={(stringValue) => {
										const numbers = getNumbersFromDelimitedString(stringValue, { sort: false, unique: false });
										if (numbers.length === 1) {
											return numbers[0];
										}
										return numbers;
									}}
									fieldToInner={(value) => {
										if (lodashIsUndefined(value)) return "";
										if (typeof value === "number") {
											return value.toString();
										} else {
											return value.join(", ");
										}
									}}
								/>
							</Grid>
							{contextValues.ArterialSpinLabelingType !== "PASL" && (
								<Grid item xs={12} md={6} xl={3}>
									<RHFTextField
										control={control}
										name={`ImportContexts.${contextIndex}.LabelingDuration`}
										label="Labeling Duration"
										fullWidth
										debounceTime={2000}
										helperText="Enter either a single positive number or a comma-separated list of numbers. Units are in seconds."
										innerToField={(stringValue) => {
											const numbers = getNumbersFromDelimitedString(stringValue, { sort: false, unique: false });
											if (numbers.length === 1) {
												return numbers[0];
											}
											return numbers;
										}}
										fieldToInner={(value) => {
											if (lodashIsUndefined(value)) return "";
											if (typeof value === "number") {
												return value.toString();
											} else {
												return value.join(", ");
											}
										}}
									/>
								</Grid>
							)}
							{contextValues.ArterialSpinLabelingType === "PASL" && (
								<>
									<Grid item xs={12} md={6} xl={3}>
										<RHFCheckable
											control={control}
											name={`ImportContexts.${contextIndex}.BolusCutOffFlag`}
											trigger={trigger}
											triggerTarget={`ImportContexts.${contextIndex}.BolusCutOffTechnique`}
											label="Bolus Cut-Off Flag"
											helperText="Was a bolus cut-off technique used? (checked if yes)"
											valWhenChecked={true}
											valWhenUnchecked={false}
										/>
									</Grid>
									<Grid item xs={12} md={6} xl={3}>
										<RHFSelect
											control={control}
											name={`ImportContexts.${contextIndex}.BolusCutOffTechnique`}
											label="Bolus Cut-Off Technique"
											helperText="The technique used to perform the bolus cut-off."
											options={ASLBolusCutOffTechniqueOptions}
											trigger={trigger}
											triggerTarget={[
												`ImportContexts.${contextIndex}.BolusCutOffFlag`,
												`ImportContexts.${contextIndex}.BolusCutOffDelayTime`,
											]}
										/>
									</Grid>
									<Grid item xs={12} md={6} xl={3}>
										<BolusCutOffDelayTimeSlider
											control={control}
											contextIndex={contextIndex}
											setFieldValue={setFieldValue}
										/>
									</Grid>
								</>
							)}
						</Grid>
					</OutlinedGroupBox>
					<OutlinedGroupBox
						label="Background Suppression Information"
						mt={5}
						labelBackgroundColor={(theme) => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
					>
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
							<Grid item xs={12} md={6} xl={3}>
								<RHFSlider
									control={control}
									name={`ImportContexts.${contextIndex}.BackgroundSuppressionNumberPulses`}
									trigger={trigger}
									triggerTarget={`ImportContexts.${contextIndex}.BackgroundSuppressionPulseTime`}
									label="Number of Background Suppression Pulses"
									min={0}
									max={10}
									step={2}
									marks={lodashRange(11)
										.map((n) => ({ label: `${n}`, value: n }))
										.filter((n) => n.value % 2 === 0)}
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFTextField
									control={control}
									name={`ImportContexts.${contextIndex}.BackgroundSuppressionPulseTime`}
									fullWidth
									label="Background Pulse Suppression Timings"
									helperText="Specify as comma-separated positive numbers in seconds. Leave blank if not applicable."
									innerToField={getNumbersFromDelimitedString}
									fieldToInner={(numbers: number[]) => (numbers && Array.isArray(numbers) ? numbers.join(", ") : "")}
									debounceTime={2000}
								/>
							</Grid>
						</Grid>
					</OutlinedGroupBox>
				</CardContent>
			</Collapse>
		</Card>
	);
}

export default SingleImportContext;

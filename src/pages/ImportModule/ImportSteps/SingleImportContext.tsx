import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
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
import { Control, Controller, UseFieldArrayRemove, UseFormSetValue, UseFormTrigger, useWatch } from "react-hook-form";
import { parseFieldError } from "../../../common/utils/formFunctions";
import { DebouncedSlider } from "../../../components/DebouncedComponents";
import { ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
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

const ASLSequenceOptions: RHFSelectOption<ImportSchemaType, `ImportContexts.${number}.ArterialSpinLabelingType`>[] = [
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

	return (
		<Card>
			<CardHeader
				title={
					isFirst ? (
						<Typography variant="h6">Global Context</Typography>
					) : (
						<Typography variant="h6">Additional Context {contextIndex}</Typography>
					)
				}
				subheader={
					isFirst && (
						<Typography>
							This context will apply to all subjects that have not been specified in any other contexts. If this is the
							only context, then it applies to all subjects under sourcedata.
						</Typography>
					)
				}
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
					{!isFirst && (
						<RHFFPDropzone
							control={control}
							name={`ImportContexts.${contextIndex}.Paths`}
							filepathType="dir"
							dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
							label="Subjects/Visits/Sessions Within this Context"
							helperText="Drop Subject, Visit, and/or Session folders into this field to indicate that these are the items that are encompassed by this context."
							placeholderText="Drop Folders Here"
						/>
					)}

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
									helperText="The number of volumes in the ASL series."
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFTextField
									control={control}
									name={`ImportContexts.${contextIndex}.M0PositionInASL`}
									label="M0 Positions within ASL Series"
									fullWidth
									debounceTime={2000}
									helperText="Specify as comma-separated positive integers. Leave blank if not applicable."
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
									helperText="Specify as comma-separated positive integers. Leave blank if not applicable."
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
								/>
							</Grid>
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
								<RHFSelect
									control={control}
									name={`ImportContexts.${contextIndex}.ArterialSpinLabelingType`}
									label="ASL Sequence Type"
									helperText="The type of ASL sequence used"
									options={ASLSequenceOptions}
									trigger={trigger}
									triggerTarget={[
										`ImportContexts.${contextIndex}.BolusCutOffFlag`,
										`ImportContexts.${contextIndex}.LabelingDuration`,
									]}
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFSlider
									control={control}
									name={`ImportContexts.${contextIndex}.PostLabelingDelay`}
									min={0}
									max={5}
									step={0.001}
									renderTextfields
									label="Post Labeling Delay"
									helperText="Units are in seconds. If you want this field ignored, set to 0."
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={3}>
								<RHFSlider
									control={control}
									name={`ImportContexts.${contextIndex}.LabelingDuration`}
									min={0}
									max={5}
									step={0.001}
									renderTextfields
									label="Labeling Duration"
									helperText="Units are in seconds. If you want this field ignored, set to 0."
								/>
							</Grid>
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
									step={1}
									marks={lodashRange(11).map((n) => ({ label: `${n}`, value: n }))}
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

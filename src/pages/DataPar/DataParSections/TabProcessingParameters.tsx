import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import FormLabel from "@mui/material/FormLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React from "react";
import { Control } from "react-hook-form";
import {
	RHFCheckable,
	RHFCheckableGroup,
	RHFCheckableOption,
	RHFMultiNumeric,
	RHFSelect,
	RHFSelectOption,
	RHFSlider,
} from "../../../components/RHFComponents";
import { DataParValuesType, EASLAtlasNamesType } from "../../../common/types/ExploreASLDataParTypes";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";

const qualityOptions: RHFSelectOption<DataParValuesType, "x.settings.Quality">[] = [
	{ label: "Low", value: 0 },
	{ label: "High (longer processing times)", value: 1 },
];

const bRegistrationContrastOptions: RHFSelectOption<DataParValuesType, "x.modules.asl.bRegistrationContrast">[] = [
	{ label: "Control ASL -> T1w", value: 0 },
	{ label: "CBF -> pseudoCBF template, controlling for CoV", value: 1 },
	{ label: "Mixture of the above two options", value: 2 },
	{ label: "Forced CBF -> pseudoCBF, irrespective of CoV", value: 3 },
];

const bAffineRegistrationOptions: RHFSelectOption<DataParValuesType, "x.modules.asl.bAffineRegistration">[] = [
	{ label: "Affine Registration Disabled", value: 0 },
	{ label: "Affine Registration Disabled", value: 1 },
	{ label: "Affine Registration based on CoV of PWI", value: 2 },
];

const bDCTRegistrationOptions: RHFSelectOption<DataParValuesType, "x.modules.asl.bDCTRegistration">[] = [
	{ label: "DCT Registration Disabled", value: 0 },
	{ label: "DCT Registration Enabled", value: 1 },
	{ label: "DCT Registration with Partial Volume Correction", value: 2 },
];

const atlasOptions: RHFCheckableOption<"checkbox", DataParValuesType, "x.S.Atlases">[] = [
	{ label: "WholeBrain Grey Matter", value: "TotalGM" },
	{ label: "Wholebrain White Matter", value: "DeepWM" },
	{ label: "MNI Cortical Atlas", value: "MNI_Structural" },
	{ label: "Hammers Atlas", value: "Hammers" },
	{ label: "Hammers Atlas adapted to DARTEL template of IXI550 space", value: "HammersCAT12" },
	{ label: "Harvard-Oxford Cortical", value: "HOcort_CONN" },
	{ label: "Harvard-Oxford Subcortical", value: "HOsub_CONN" },
	{ label: "Harvard-Oxford Thalamus", value: "Thalamus" },
	{ label: "OASIS Atlas", value: "Mindboggle_OASIS_DKT31_CMA" },
];

const bMaskingOptions: RHFCheckableOption<"checkbox", DataParValuesType, "x.S.bMasking">[] = [
	{ label: "Mask ROIs with subject-specific mask", value: 1 },
	{ label: "Use a susceptibility mask", value: 1 },
	{ label: "Use a vascular mask", value: 1 },
	{ label: "Use subject-specific tissue masking", value: 1 },
];

const WMHsegmAlgOptions: RHFSelectOption<DataParValuesType, "x.modules.WMHsegmAlg">[] = [
	{ label: "Lesion Prediction Algorithm (LPA)", value: "LPA" },
	{ label: "Lesion Growth Algorithm (LGA)", value: "LGA" },
];

export const TabProcessingParameters = React.memo(({ control }: { control: Control<DataParValuesType> }) => {
	return (
		<Fade in>
			<Box display="flex" flexDirection="column" gap={4} position="relative" padding={2}>
				<Typography variant="h4">Processing Parameters</Typography>
				<OutlinedGroupBox label="General Processing Parameters">
					<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSelect
								control={control}
								name="x.settings.Quality"
								options={qualityOptions}
								label="Processing & Image Quality"
								helperText="Affects the quality of the processed images and the speed of processing."
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={8}>
							<Stack>
								<FormLabel>Handling of Folders & Missing Scans</FormLabel>
								<Grid container>
									<Grid item xs={12} xl={6}>
										<RHFCheckable
											name="x.settings.DELETETEMP"
											control={control}
											isSwitch={true}
											label="Delete Temporary Folders & Files"
											valWhenChecked={1}
											valWhenUnchecked={0}
										/>
									</Grid>
									<Grid item xs={12} xl={6}>
										<RHFCheckable
											name="x.settings.SkipIfNoFlair"
											control={control}
											isSwitch={true}
											label="Skip Subjects Missing a FLAIR scan"
											valWhenChecked={1}
											valWhenUnchecked={0}
										/>
									</Grid>
									<Grid item xs={12} xl={6}>
										<RHFCheckable
											name="x.settings.SkipIfNoASL"
											control={control}
											isSwitch={true}
											label="Skip Subjects Missing a ASL scan"
											valWhenChecked={1}
											valWhenUnchecked={0}
										/>
									</Grid>
									<Grid item xs={12} xl={6}>
										<RHFCheckable
											name="x.settings.SkipIfNoM0"
											control={control}
											isSwitch={true}
											label="Skip Subjects Missing an M0 scan"
											valWhenChecked={1}
											valWhenUnchecked={0}
										/>
									</Grid>
								</Grid>
							</Stack>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
				<OutlinedGroupBox label="Structural Module Processing Parameters">
					<Grid container rowSpacing={0} columnSpacing={3} marginTop={0} padding={2}>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								name="x.modules.structural.bSegmentSPM12"
								control={control}
								label="Use SPM12 Segmentation over CAT12"
								isSwitch={true}
								valWhenChecked={1}
								valWhenUnchecked={0}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								name="x.modules.structural.bHammersCAT12"
								control={control}
								label="Provide Hammers Volumetric ROI results"
								isSwitch={true}
								valWhenChecked={1}
								valWhenUnchecked={0}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								name="x.modules.structural.bFixResolution"
								control={control}
								label="Resample to a CAT12-compatible resolution"
								isSwitch={true}
								valWhenChecked={true}
								valWhenUnchecked={false}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								name="x.modules.bRunLongReg"
								control={control}
								label="Run Longitudinal Structural Registration"
								isSwitch={true}
								valWhenChecked={1}
								valWhenUnchecked={0}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								name="x.modules.bRunDARTEL"
								control={control}
								label="Run DARTEL instead of Geodesic Shooting"
								isSwitch={true}
								valWhenChecked={1}
								valWhenUnchecked={0}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4} mt={2}>
							<RHFSelect
								name="x.modules.WMHsegmAlg"
								control={control}
								options={WMHsegmAlgOptions}
								label="WHM Segmentation Algorithm"
								helperText="Which algorithm to use when identifying white matter hyperintensities"
							/>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
				<OutlinedGroupBox label="ASL Module Processing Parameters">
					<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
						<Grid item xs={12} md={6} xl={4}>
							<Stack rowGap={2}>
								<FormLabel>Motion Correction Settings</FormLabel>
								<RHFCheckable
									control={control}
									name="x.modules.asl.motionCorrection"
									label="Run Motion Correction"
									isSwitch={true}
									valWhenChecked={1}
									valWhenUnchecked={0}
								/>
								<RHFSlider
									control={control}
									name="x.modules.asl.SpikeRemovalThreshold"
									label="Motion T-Statistic Threshold"
									renderTextfields
									min={0.01}
									max={1}
									step={0.01}
									helperText="This is the minimal increase in T-value statistic that will be considered an improval during motion correction."
								/>
							</Stack>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<FormLabel>Partial Volume Correction Settings</FormLabel>
							<Stack rowGap={1}>
								<RHFCheckable
									control={control}
									name="x.modules.asl.bPVCNativeSpace"
									label="Implement PVC in Native Space?"
									isSwitch
									valWhenChecked={1}
									valWhenUnchecked={0}
								/>
								<RHFCheckable
									control={control}
									name="x.modules.asl.bPVCGaussianMM"
									label="Use a Gaussian Kernel?"
									isSwitch
									valWhenChecked={1}
									valWhenUnchecked={0}
								/>
								<RHFMultiNumeric control={control} name="x.modules.asl.PVCNativeSpaceKernel" label="PVC Kernel Shape" />
							</Stack>
						</Grid>

						<Grid item xs={12} md={6} xl={4}>
							<RHFSelect
								control={control}
								name="x.modules.asl.bAffineRegistration"
								label="Affine Registration"
								helperText="Specifies if the ASL-T1w rigid-body registration is followed up by an affine registration"
								options={bAffineRegistrationOptions}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSelect
								control={control}
								name="x.modules.asl.bDCTRegistration"
								label="DCT Registration"
								helperText="Specifies if DCT registration should be included on top of affine registration"
								options={bDCTRegistrationOptions}
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSelect
								control={control}
								name="x.modules.asl.bRegistrationContrast"
								label="Source of Image Contrast"
								helperText="Specifies the image contrast used for registration"
								options={bRegistrationContrastOptions}
							/>
						</Grid>

						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								control={control}
								name="x.modules.asl.bUseMNIasDummyStructural"
								label="Use MNI152 Template as a Structural Volume stand-in for missing data when co-registering?"
								isSwitch={true}
								valWhenChecked={1}
								valWhenUnchecked={0}
							/>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
				<OutlinedGroupBox label="M0 Scan Processing Parameters">
					<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
						<Grid item xs={12} md={6} xl={4}>
							<RHFSlider
								control={control}
								name="x.modules.asl.M0_GMScaleFactor"
								label="M0 Scaling Factor"
								min={1}
								max={1000}
								step={1}
								renderTextfields
								helperText="Multiplicatively scale the M0 image by this factor prior to quantification"
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								control={control}
								name="x.modules.asl.M0_conventionalProcessing"
								valWhenChecked={0}
								valWhenUnchecked={1}
								label="Use ExploreASL's enhanced M0 processing?"
								helperText="This provides improved smoothing and masking processing of the M0 image"
							/>
						</Grid>
						<Grid item xs={12} md={6} xl={4}>
							<RHFCheckable
								control={control}
								name="x.modules.asl.bRegisterM02ASL"
								label="Should M0 be registered to the mean control ASL image?"
								isSwitch={true}
								valWhenChecked={1}
								valWhenUnchecked={0}
								helperText="This has no effect if there isn't an M0 scan present or if a numerical estimate is used instead of an M0 image for CBF quantification."
							/>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
				<OutlinedGroupBox label="Population Module Processing Parameters">
					<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
						<Grid item xs={12} md={6}>
							<RHFCheckableGroup
								control={control}
								name="x.S.Atlases"
								options={atlasOptions}
								label="Atlases To Run"
								keepUncheckedValue={false}
								type="checkbox"
								uncheckedValue={"None" as EASLAtlasNamesType}
							/>
						</Grid>
						<Grid item xs={12} md={6}>
							<RHFCheckableGroup
								control={control}
								name="x.S.bMasking"
								options={bMaskingOptions}
								label="Masking Options"
								keepUncheckedValue={false}
								uncheckedValue={0}
								type="checkbox"
							/>
						</Grid>
					</Grid>
				</OutlinedGroupBox>
			</Box>
		</Fade>
	);
});

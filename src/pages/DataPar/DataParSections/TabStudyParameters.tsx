import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import React from "react";
import { Control, UseFormTrigger } from "react-hook-form";
import { SecureLink } from "../../../components/NavComponents";
import { DataParValuesType } from "../../../common/types/ExploreASLDataParTypes";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";
import { RHFFilepathInput, RHFFPDropzone, RHFSelect, RHFTextField } from "../../../components/RHFComponents";

export const TabStudyParameters = React.memo(
	({ control, trigger }: { control: Control<DataParValuesType>; trigger: UseFormTrigger<DataParValuesType> }) => {
		const { api } = window;

		return (
			<Fade in>
				<Box display="flex" flexDirection="column" gap={4} position="relative" padding={2}>
					<Typography variant="h4">Study Parameters</Typography>
					<OutlinedGroupBox label="ExploreASL Parameters">
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
							<Grid item xs={12} md={6} xl={4}>
								<RHFSelect
									control={control}
									name="x.GUI.EASLType"
									label="ExploreASL Type"
									options={[
										{ label: "ExploreASL from GitHub", value: "Github" },
										{ label: "Compiled ExploreASL", value: "Compiled" },
									]}
									helperText={
										<Typography variant="caption">
											Select Github if you cloned the{" "}
											<SecureLink href="https://github.com/ExploreASL/ExploreASL">
												ExploreASL GitHub repository
											</SecureLink>
										</Typography>
									}
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={4}>
								<RHFFilepathInput
									control={control}
									name="x.GUI.EASLPath"
									filepathType="dir"
									dialogOptions={{ properties: ["openDirectory"] }}
									label="ExploreASL Path"
									helperText="This is the folder that contains the ExploreASL executable."
								/>
							</Grid>
							<Grid item xs={12} md={6} xl={4}>
								<RHFFilepathInput
									control={control}
									name="x.GUI.MATLABRuntimePath"
									filepathType="dir"
									dialogOptions={{ properties: ["openDirectory"] }}
									label="MATLAB Runtime Path"
									helperText="This is the path to the MATLAB Runtime folder version (i.e. v96, v912). Optional when ExploreASL Type is 'Github'"
								/>
							</Grid>
						</Grid>
					</OutlinedGroupBox>
					<OutlinedGroupBox label="Study-Specific Parameters" mt={2}>
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
							<Grid item xs={12} md={6}>
								<RHFFilepathInput
									control={control}
									name="x.GUI.StudyRootPath"
									trigger={trigger}
									triggerTarget={["x.GUI.SUBJECTS", "x.dataset.exclusion"]}
									filepathType="dir"
									dialogOptions={{ properties: ["openDirectory"] }}
									fullWidth
									helperText={`This folder should contain BIDS-standard subfolders ("derivatives", "rawdata", "sourcedata")`}
									label="Study's Root Folder"
								/>
							</Grid>
							<Grid item xs={12} md={6}>
								<RHFTextField
									control={control}
									name="x.dataset.name"
									fullWidth
									helperText="This is the name that will appear on ExploreASL-generated reports"
									label="Study Name"
								/>
							</Grid>
						</Grid>
					</OutlinedGroupBox>
					<OutlinedGroupBox label="Inclusion & Exclusion Criteria" mt={2}>
						<Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={2}>
							<Grid item xs={12} md={6}>
								<RHFFPDropzone
									control={control}
									name="x.GUI.SUBJECTS"
									trigger={trigger}
									triggerTarget={"x.dataset.exclusion"}
									filepathType="dir"
									dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
									helperText="Drop subject folders from StudyRoot/rawdata into this field"
									placeholderText="Drop Subject folders from StudyRoot/rawdata here"
									label="Subjects to Include"
									baseNamesOnly
									extraFilterFunction={(filepath) => {
										return api.path.parent(filepath).basename === "rawdata";
									}}
								/>
							</Grid>
							<Grid item xs={12} md={6}>
								<RHFFPDropzone
									control={control}
									name="x.dataset.exclusion"
									filepathType="dir"
									dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
									helperText="Drop subject folders from StudyRoot/rawdata into this field"
									label="Subjects to Exclude"
									placeholderText="Drop Subject folders from StudyRoot/rawdata here"
									baseNamesOnly
									extraFilterFunction={(filepath) => {
										return api.path.parent(filepath).basename === "rawdata";
									}}
								/>
							</Grid>
						</Grid>
					</OutlinedGroupBox>
				</Box>
			</Fade>
		);
	}
);

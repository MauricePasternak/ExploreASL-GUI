import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import Grid from "@mui/material/Grid";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import React from "react";
import { Control, UseFormTrigger } from "react-hook-form";
import RHFInterDepFilepathTextField from "../../components/FormComponents/RHFInterDepFilepathTextfield";
import { DataParValuesType } from "../../common/types/ExploreASLDataParTypes";
import RHFFilepathDropzone from "../../components/FormComponents/RHFFilepathDropzone";
import RHFFilepathTextField from "../../components/FormComponents/RHFFilepathTextfield";
import RHFSelect from "../../components/FormComponents/RHFSelect";
import RHFTextfield from "../../components/FormComponents/RHFTextfield";
import OutlinedGroupBox from "../../components/OutlinedGroupBox";

function TabStudyParameters({
  control,
  trigger,
}: {
  control: Control<DataParValuesType>;
  trigger: UseFormTrigger<DataParValuesType>;
}) {
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
                    <Link href="https://github.com/ExploreASL/ExploreASL" target="_blank">
                      ExploreASL GitHub repository
                    </Link>
                  </Typography>
                }
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFFilepathTextField
                control={control}
                name="x.GUI.EASLPath"
                filepathType="dir"
                dialogOptions={{ properties: ["openDirectory"] }}
                label="ExploreASL Path"
                helperText="This is the folder that contains the ExploreASL executable."
              />
            </Grid>
            <Grid item xs={12} md={6} xl={4}>
              <RHFFilepathTextField
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
              <RHFInterDepFilepathTextField
                control={control}
                name="x.GUI.StudyRootPath"
                trigger={trigger}
                triggerTarget="x.GUI.SUBJECTS"
                filepathType="dir"
                dialogOptions={{ properties: ["openDirectory"] }}
                fullWidth
                helperText={`This folder should contain BIDS-standard subfolders ("derivatives", "rawdata", "sourcedata")`}
                label="Study's Root Folder"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextfield
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
              <RHFFilepathDropzone
                control={control}
                name="x.GUI.SUBJECTS"
                filepathType="dir"
                dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
                helperText="Drop subject folders from StudyRoot/rawdata into this field"
                placeholderText="Drop Subject folders from StudyRoot/rawdata here"
                label="Subjects to Include"
                baseNamesOnly
                extraFilterFunction={filepath => {
                  return api.path.parent(filepath).basename === "rawdata";
                }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFFilepathDropzone
                control={control}
                name="x.dataset.exclusion"
                filepathType="dir"
                dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
                helperText="Drop subject folders from StudyRoot/rawdata into this field"
                label="Subjects to Exclude"
                placeholderText="Drop Subject folders from StudyRoot/rawdata here"
                baseNamesOnly
                extraFilterFunction={filepath => {
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

export default React.memo(TabStudyParameters);

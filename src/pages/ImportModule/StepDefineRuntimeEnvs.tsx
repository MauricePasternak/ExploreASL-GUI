import FolderIcon from "@mui/icons-material/Folder";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import React from "react";
import { DeepRequired, FieldErrorsImpl } from "react-hook-form";
import { ImportSchemaType } from "../../common/types/ImportSchemaTypes";
import RHFFilepathTextField from "../../components/FormComponents/RHFFilepathTextfield";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../components/FormComponents/RHFMultiStep";
import RHFSelect from "../../components/FormComponents/RHFSelect";
import { SecureLink } from "../../components/NavComponents";
import OutlinedGroupBox from "../../components/OutlinedGroupBox";
import FabDialogWrapper from "../../components/WrapperComponents/FabDialogWrapper";
import HelpImport__StepDefineRuntimeEnvs from "../Help/HelpImport__StepDefineRuntimeEnvs";
import StructureByParts from "./StructureByParts";

function StepDefineRuntimeEnvs({
  currentStep,
  setCurrentStep,
  control,
  handleSubmit,
  trigger,
}: RHFMultiStepReturnProps<ImportSchemaType>) {
  const handleValidSubmit = (values: ImportSchemaType) => {
    console.log("Step 'Define Runtime Envs' -- Valid Submit Values: ", values);
    setCurrentStep(currentStep + 1);
  };

  const handleInvalidSubmit = (errors: FieldErrorsImpl<DeepRequired<ImportSchemaType>>) => {
    console.log("Step 'Define Runtime Envs' -- Invalid Submit Errors: ", errors);
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Box mt={1} pb={5}>
        <Card>
          <CardHeader
            title={<Typography variant="h4">Define Runtime Environment</Typography>}
            subheader={<Typography>Specify filepaths and describe the structure of DICOM scanner output</Typography>}
            avatar={
              <Avatar>
                <FolderIcon />
              </Avatar>
            }
            action={
              <FabDialogWrapper maxWidth="xl" PaperProps={{ sx: { minWidth: "499px" } }} sx={{ marginTop: "40px" }}>
                <HelpImport__StepDefineRuntimeEnvs />
              </FabDialogWrapper>
            }
          />
          <Divider />
          <CardContent>
            <OutlinedGroupBox
              label="ExploreASL Runtime"
              labelBackgroundColor={theme => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
              mt={3}
            >
              <Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={1}>
                <Grid item xs={12} md={6} xl={4}>
                  <RHFSelect
                    control={control}
                    name="EASLType"
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
                  <RHFFilepathTextField
                    control={control}
                    name="EASLPath"
                    filepathType="dir"
                    dialogOptions={{ properties: ["openDirectory"], title: "Select ExploreASL Directory" }}
                    label="ExploreASL Path"
                    helperText="This is the folder that contains the ExploreASL executable."
                  />
                </Grid>

                <Grid item xs={12} md={6} xl={4}>
                  <RHFFilepathTextField
                    control={control}
                    name="MATLABRuntimePath"
                    filepathType="dir"
                    dialogOptions={{ properties: ["openDirectory"] }}
                    label="MATLAB Runtime Path"
                    helperText="This is the path to the MATLAB Runtime folder version (i.e. v96, v912). Optional when ExploreASL Type is 'Github'"
                  />
                </Grid>
              </Grid>
            </OutlinedGroupBox>
            <OutlinedGroupBox
              label="Study Structure"
              mt={3}
              p={0.5}
              labelBackgroundColor={theme => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
            >
              <Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={1}>
                <Grid item xs={12} md={6} xl={4}>
                  <RHFFilepathTextField
                    control={control}
                    name="StudyRootPath"
                    filepathType="dir"
                    dialogOptions={{ properties: ["openDirectory"] }}
                    label="Study Root Path"
                    helperText="This is the root of your dataset. Must contain a folder called sourcedata."
                  />
                </Grid>
                <Grid item xs={12} md={6} xl={8}>
                  <StructureByParts trigger={trigger} control={control} name="SourcedataStructure" />
                </Grid>
              </Grid>
            </OutlinedGroupBox>
          </CardContent>
        </Card>
      </Box>
      <RHFMultiStepButtons currentStep={currentStep} setCurrentStep={setCurrentStep} />
    </form>
  );
}

export default StepDefineRuntimeEnvs;

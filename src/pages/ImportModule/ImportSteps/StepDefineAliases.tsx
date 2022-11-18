import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { zipObject as lodashZipObject } from "lodash";
import React, { useCallback, useEffect } from "react";
import { SubmitErrorHandler, SubmitHandler } from "react-hook-form";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import AliasIcon from "../../../assets/svg/AliasIcon.svg";
import { ImportScanType, ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
import { assignSelfKeysOnly } from "../../../common/utilityFunctions/objectFunctions";
import { RHFMapping } from "../../../components/RHFComponents";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../../components/RHFComponents/RHFMultiStep";
import HelpImport__StepDefineAliases from "../../Help/HelpImport__StepDefineAliases";
import FieldCardScanAliases from "./FieldCardScanAliases";
import { getAliasBasenames } from "../ImportModuleHelperFunctions";

export function StepDefineAliases({
  currentStep,
  setCurrentStep,
  control,
  setValue,
  getValues,
  handleSubmit,
}: RHFMultiStepReturnProps<ImportSchemaType>) {
  // TODO Look into use a FSWatcher to invoke setupAliases in case a user tries to change filepaths mid-form
  /**
   * Handler for populating the alias basenames with the most up-to-date values.
   */
  const setupAliases = useCallback(async () => {
    const {
      StudyRootPath,
      SourcedataStructure,
      MappingScanAliases,
      MappingSessionAliases,
      MappingVisitAliases,
    } = getValues();

    // Retrieve a list of the basenames of files at the appropriate levels for
    // Scan, Session, and Visit.
    const result = await getAliasBasenames(StudyRootPath, SourcedataStructure);
    if (!result) return;

    const { scanBasenames, sessionBasenames, visitBasenames } = result;

    // Create default values for the aliases
    const defaultScanAliases: Record<string, ImportScanType> = lodashZipObject(
      scanBasenames,
      scanBasenames.map(() => "Ignore")
    );
    const defaultSessionAliases: Record<string, string> = lodashZipObject(
      sessionBasenames,
      sessionBasenames.map((_, i) => `ASL_${i + 1}`) // +1 to account for MATLAB indexing
    );
    const defaultVisitAliases: Record<string, string> = lodashZipObject(visitBasenames, visitBasenames);

    // Overwrite the default values with the current form values
    const updatedScanAliases = assignSelfKeysOnly(defaultScanAliases, MappingScanAliases);
    const updatedSessionAliases = assignSelfKeysOnly(defaultSessionAliases, MappingSessionAliases);
    const updatedVisitAliases = assignSelfKeysOnly(defaultVisitAliases, MappingVisitAliases);

    console.log("Step `DefineAliases` -- useEffect -- updatedScanAliases", updatedScanAliases);
    console.log("Step `DefineAliases` -- useEffect -- updatedSessionAliases", updatedSessionAliases);
    console.log("Step `DefineAliases` -- useEffect -- updatedVisitAliases", updatedVisitAliases);

    // Set the values in the form
    setValue("MappingScanAliases", updatedScanAliases);
    setValue("MappingSessionAliases", updatedSessionAliases);
    setValue("MappingVisitAliases", updatedVisitAliases);
  }, [getValues]);

  useEffect(() => {
    setupAliases();
  }, []);

  const handleValidSubmit: SubmitHandler<ImportSchemaType> = async (values) => {
    console.log("Step 'Define Aliases' -- Valid Submit Values: ", values);
    setCurrentStep(currentStep + 1);
  };

  const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = (errors) => {
    console.log("Step 'Define Aliases' -- Invalid Submit Errors: ", errors);
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Box mt={1} pb={5} display="flex" gap={2} flexDirection="column" position="relative">
        <Card>
          <CardHeader
            title={<Typography variant="h4">Define Aliases</Typography>}
            subheader={<Typography>Define mappings of current folder names to your preferred aliases</Typography>}
            action={
              <FabDialogWrapper
                maxWidth="xl"
                // fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
                PaperProps={{ sx: { minWidth: "499px" } }}
                sx={{ marginTop: "40px" }}
              >
                <HelpImport__StepDefineAliases />
              </FabDialogWrapper>
            }
            avatar={
              <Avatar>
                <SvgIcon component={AliasIcon} inheritViewBox fontSize="large" />
              </Avatar>
            }
          />
          <CardContent>
            <FieldCardScanAliases control={control} name="MappingScanAliases" />
            <RHFMapping
              control={control}
              name="MappingVisitAliases"
              type="textfield"
              title="Visit Aliases"
              keysSubtitle="Folder Name"
              valuesSubtitle="Visit Alias"
            />
            <RHFMapping
              control={control}
              name="MappingSessionAliases"
              type="textfield"
              title="Session Aliases"
              keysSubtitle="Folder Name"
              valuesSubtitle="Session Alias"
            />
          </CardContent>
        </Card>
      </Box>
      <RHFMultiStepButtons currentStep={currentStep} setCurrentStep={setCurrentStep} />
    </form>
  );
}

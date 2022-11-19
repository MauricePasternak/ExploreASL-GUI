import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useSetAtom } from "jotai";
import { cloneDeep as lodashCloneDeep } from "lodash";
import React, { useEffect } from "react";
import { SubmitErrorHandler, SubmitHandler, useFieldArray } from "react-hook-form";
import ContextIcon from "../../../assets/svg/ContextIcon.svg";
import { GUIIMPORTFILE_BASENAME, SOURCESTRUCTUREFILE_BASENAME, STUDYPARFILE_BASENAME } from "../../../common/GLOBALS";
import { SchemaImportPar } from "../../../common/schemas/ImportSchemas/ImportSchema";
import { ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
import { YupValidate } from "../../../common/utilityFunctions/formFunctions";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../../components/RHFComponents/RHFMultiStep";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import { DefaultImportSingleContext } from "../../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../../stores/SnackbarStore";
import HelpImport__StepDefineAdditionalContext from "../../Help/HelpImport__StepDefineAdditionalContext";
import {
  buildSourceStructureJSON,
  buildStudyParJSON,
  updateContextSpecificRegexps,
} from "../ImportModuleHelperFunctions";
import SingleImportContext from "./SingleImportContext";

export function StepDefineContexts({
  currentStep,
  setCurrentStep,
  control,
  trigger,
  getValues,
  setValue,
  handleSubmit,
}: RHFMultiStepReturnProps<ImportSchemaType>) {
  const { api } = window;
  const { fields, append, remove } = useFieldArray({ control: control, name: "ImportContexts" });
  const setImportSnackbar = useSetAtom(atomImportModuleSnackbar);

  console.log("Step 'Define Contexts' -- rendered with fields", fields);

  const handleValidSubmit: SubmitHandler<ImportSchemaType> = async (values) => {
    console.log("Step 'Define Contexts' -- Valid Submit Values: ", values);

    // Form values must be adjusted to translate Paths into folderHierarchy for each context
    // const adjustedValues = await updateFolderHierarchyPerContext(values);
    const adjustedValues = await updateContextSpecificRegexps(values);
    if (!adjustedValues) {
      setImportSnackbar({
        severity: "error",
        title: "Error interpreting Contexts",
        message: [
          "Could not interpret folder structure for one or more contexts.",
          "Please ensure that the filepaths you have provided actually exist and do not have any illegal characters (i.e. $^&).",
        ],
      });
      return;
    }

    // Build the sourceStructure.json file
    const sourceStructureJSON = await buildSourceStructureJSON(adjustedValues);
    if (!sourceStructureJSON) {
      setImportSnackbar({
        severity: "error",
        title: "Error building sourceStructure.json",
        message: [
          "Could not build sourceStructure.json file.",
          "Please ensure that the filepaths you have provided actually exist and do not have any illegal characters (i.e. $^&).",
        ],
      });
      return;
    }

    // Build the studyPar.json file
    const studyParJSON = await buildStudyParJSON(adjustedValues);
    if (!studyParJSON) {
      setImportSnackbar({
        severity: "error",
        title: "Error creating studyPar.json",
        message: [
          "Could not create studyPar.json file.",
          "Please ensure that the filepaths you have provided actually exist and do not have any illegal characters (i.e. $^&).",
        ],
      });
      return;
    }

    try {
      const createdGUIImportJSONFile = await api.path.writeJSON(
        api.path.asPath(values.StudyRootPath, GUIIMPORTFILE_BASENAME).path,
        adjustedValues,
        { spaces: 1 }
      );
      const createdSourceStructureFile = await api.path.writeJSON(
        api.path.asPath(values.StudyRootPath, SOURCESTRUCTUREFILE_BASENAME).path,
        sourceStructureJSON,
        { spaces: 1 }
      );
      const createdStudyParFile = await api.path.writeJSON(
        api.path.asPath(values.StudyRootPath, STUDYPARFILE_BASENAME).path,
        studyParJSON,
        { spaces: 1 }
      );

      if (
        await Promise.all([
          api.path.filepathExists(createdGUIImportJSONFile.path),
          api.path.filepathExists(createdSourceStructureFile.path),
          api.path.filepathExists(createdStudyParFile.path),
        ])
      ) {
        setCurrentStep(currentStep + 1);
      }
    } catch (error) {
      setImportSnackbar({
        severity: "error",
        title: "Error while writing Import Parameters",
        message: [
          `One of the import configuration files could not be written to the study root folder.`,
          `It is possible that the folder this filepath is meant to be written in has special privileges.`,
          `Please check the permissions of this folder and try again.`,
        ],
      });
    }
  };

  const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = (errors) => {
    console.debug("Step 'Define Content' -- Invalid Submit Errors: ", errors);
  };

  /**
   * useEffect for populating fields from an existing ImportPar.json file if it is valid
   */
  useEffect(() => {
    async function handleLoadImportPar() {
      const currentValues = getValues();
      console.log(
        "Step 'Define Contexts' -- useEffect -- searching for ImportPar.json in ",
        currentValues.StudyRootPath
      );

      try {
        const importParPath = api.path.asPath(currentValues.StudyRootPath, GUIIMPORTFILE_BASENAME);
        if (!(await api.path.filepathExists(importParPath.path))) return;

        console.log(
          "Step 'Define Contexts' -- useEffect -- ImportPar.json found at ",
          importParPath.path,
          "...validating"
        );
        const { payload, error } = await api.path.readJSONSafe(importParPath.path);
        if (!("ImportContexts" in payload) || error) return;

        // Validate the data
        const { errors, values } = await YupValidate(SchemaImportPar, payload as ImportSchemaType);
        if (Object.keys(errors).length > 0) {
          console.log("Step 'Define Contexts' -- useEffect -- loaded ImportPar.json did not pass validation: ", errors);
          return;
        }
        setValue("ImportContexts", values.ImportContexts, { shouldValidate: false });
        return;
      } catch (error) {
        console.warn(`Step 'Define Contexts' -- useEffect -- Error while loading/validating ImportPar.json: `, error);
        return;
      }
    }

    handleLoadImportPar();
  }, []);

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Card elevation={3} sx={{ marginBottom: 2 }}>
        <CardHeader
          title={<Typography variant="h4">Define Additional Context</Typography>}
          subheader={
            <Typography>
              Define the specific nature of the ASL sequence acquisition to allow for the Import Module to properly
              convert the series into NIFTI format. Allows for multiple contexts for complex datasets.
            </Typography>
          }
          avatar={
            <Avatar>
              <SvgIcon component={ContextIcon} inheritViewBox />
            </Avatar>
          }
          action={
            <FabDialogWrapper
              maxWidth="xl"
              // fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
              PaperProps={{ sx: { minWidth: "499px" } }}
              sx={{ marginTop: "40px" }}
            >
              <HelpImport__StepDefineAdditionalContext />
            </FabDialogWrapper>
          }
        />
        <Divider />
        <CardContent>
          <Button
            fullWidth
            variant="contained"
            onClick={() => {
              const defaultContext = lodashCloneDeep(DefaultImportSingleContext);
              defaultContext.IsGlobal = false; // This allows for proper validation of the form.
              append(defaultContext);
            }}
          >
            Add a context
          </Button>
        </CardContent>
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            {fields.map((field, fieldIndex) => {
              return (
                <SingleImportContext
                  key={field.id}
                  contextIndex={fieldIndex}
                  remove={remove}
                  control={control}
                  trigger={trigger}
                />
              );
            })}
          </Stack>
        </CardContent>
      </Card>
      <RHFMultiStepButtons currentStep={currentStep} setCurrentStep={setCurrentStep} />
    </form>
  );
}

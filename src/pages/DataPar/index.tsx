import CircleIcon from "@mui/icons-material/Circle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import { isEmpty as lodashIsEmpty } from "lodash";
import React from "react";
import { SubmitErrorHandler, SubmitHandler, useForm } from "react-hook-form";
import { DATAPARFILE_BASENAME } from "../../common/GLOBALS";
import { DataParFieldNameTranslator } from "../../common/schemas/DataParFieldNameTranslator";
import { SchemaDataPar } from "../../common/schemas/DataParSchema";
import { DataParValuesType } from "../../common/types/ExploreASLDataParTypes";
import {
  correctYupValidatedContent,
  formatErrorsForDisplay,
  parseNestedFormattedYupErrors,
  YupResolverFactoryBase,
  YupValidate,
} from "../../common/utilityFunctions/formFunctions";
import { stringArrToRegex } from "../../common/utilityFunctions/stringFunctions";
import AtomicSnackbarMessage from "../../components/AtomicSnackbarMessage";
import FabDialogWrapper from "../../components/WrapperComponents/FabDialogWrapper";
import { atomDataParCurrentTab, defaultDataParValues } from "../../stores/DataParStore";
import { atomDataParModuleSnackbar } from "../../stores/SnackbarStore";
import HelpDataPar__DataPar from "../Help/HelpDataPar__DataPar";
import DataParTabs from "./DataParTabs";
import TabProcessingParameters from "./TabProcessingParameters";
import TabSequenceParameters from "./TabSequenceParameters";
import TabStudyParameters from "./TabStudyParameters";

function DataParPage() {
  const { api } = window;
  const currentDataParTab = useAtomValue(atomDataParCurrentTab);
  const setDataParSnackbar = useSetAtom(atomDataParModuleSnackbar);
  const bag = useForm({
    defaultValues: defaultDataParValues,
    resolver: YupResolverFactoryBase(SchemaDataPar),
    reValidateMode: "onChange",
  });
  const { control, handleSubmit, reset } = bag;

  /**
   * Handler for saving the data par values to a DataPar.json file located at the indicated Study Root Path
   * @param values The values from the form
   */
  const handleValidSubmit: SubmitHandler<DataParValuesType> = async values => {
    // Correct the regex field using the known subjects
    let subjectRegexp = stringArrToRegex(values.x.GUI.SUBJECTS, { isStartEndBound: false });
    console.log("subjectRegexp", subjectRegexp);

    subjectRegexp = `^${subjectRegexp}(?:_\\w+)?$`;
    values.x.dataset.subjectRegexp = subjectRegexp;

    // Correct the excluded field
    if (values.x.dataset.exclusion.length > 0) {
      const updatedExclusionNames = [];
      const exclusionRegexpInit = stringArrToRegex(values.x.dataset.exclusion, { isStartEndBound: false });
      const exclusionRegexp = new RegExp(`^${exclusionRegexpInit}(?:_\\w+)?$`);
      for (const fp of await api.path.glob(`${values.x.GUI.StudyRootPath}/derivatives/ExploreASL`, "*", {
        onlyDirectories: true,
        onlyFiles: false,
      })) {
        const name = fp.path.split("/").pop();
        if (exclusionRegexp.test(name)) {
          updatedExclusionNames.push(name);
        }
      }
      values.x.dataset.exclusion = updatedExclusionNames;
    }

    // Save the values to the DataPar.json file in BOTH the studyRootPath and the derivatives
    try {
      const dataParFilePath_1 = `${values.x.GUI.StudyRootPath}/${DATAPARFILE_BASENAME}`;
      const dataParFilePath_2 = `${values.x.GUI.StudyRootPath}/derivatives/ExploreASL/${DATAPARFILE_BASENAME}`;
      await api.path.writeJSON(dataParFilePath_1, values, { spaces: 1 });
      await api.path.writeJSON(dataParFilePath_2, values, { spaces: 1 });
      setDataParSnackbar({
        severity: "success",
        title: "Data Parameters saved successfully",
        message: ["Saved the data parameters to:", api.path.osSpecificString(dataParFilePath_1)],
      });
    } catch (error) {
      setDataParSnackbar({
        severity: "error",
        title: "Could not save Data Parameters to the desired JSON file",
        message: ["The following errors were detected:", error.message],
      });
    }
  };

  const handleInvalidSubmit: SubmitErrorHandler<DataParValuesType> = errors => {
    const parsedErrors = parseNestedFormattedYupErrors(errors);
    console.log("Form errors: ", parsedErrors);
  };

  /**
   * Handler for loading DataParValues from an existing DataPar.json file
   */
  const handleLoadDataPar = async () => {
    const { canceled, filePaths } = await api.invoke("Dialog:OpenDialog", {
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled) return;

    // Load in the contents of the JSON file and early-exit if there was an issue
    const [jsonFile] = filePaths;
    const { error: loadDataParError, payload: jsonFileContent } = await api.path.readJSONSafe(jsonFile);
    if (loadDataParError) {
      console.warn("Error loading DataPar.json file: ", loadDataParError);
      setDataParSnackbar({
        severity: "error",
        title: "Error loading JSON file",
        message: loadDataParError.message,
      });
      return;
    }

    // Validate the JSON file
    console.log("Pre-Validation values", jsonFileContent);
    const { values, errors } = await YupValidate(SchemaDataPar, jsonFileContent as DataParValuesType);
    console.log("Post-Validation errors: ", errors);
    console.log("Post-Validation values: ", values);
    console.log("Post-Validation original values: ", jsonFileContent);

    // If there are no errors, set the values to the loaded values and early exit
    if (lodashIsEmpty(errors)) {
      // Set the values in the form
      console.log("No Errors found for the loaded DataPar.json file", values);
      // setDataParValues(values as DataParValuesType);
      reset(values);
      return;
    }

    // If there are errors, correct them, set the corrected values, and display the errors
    const correctedValues = correctYupValidatedContent(jsonFileContent, errors, defaultDataParValues);
    console.log("Corrected JSON file value and errors: ", correctedValues);

    const parsedErrors = formatErrorsForDisplay(errors, DataParFieldNameTranslator);
    console.log("Formatted errors: ", parsedErrors);

    const finalErrorMessage = (
      <div>
        <Typography>
          The following fields were found to be invalid when loading the data parameters file. They have been replaced
          with defaults.
        </Typography>
        <List>
          {parsedErrors.map((error, index) => (
            <ListItem key={`DataParLoadErrorItem_${index}`}>
              <ListItemIcon>
                <CircleIcon />
              </ListItemIcon>
              <ListItemText>{error}</ListItemText>
            </ListItem>
          ))}
        </List>
      </div>
    );
    setDataParSnackbar({
      severity: "warning",
      title: "Loaded DataPar.json, but errors were found and corrected",
      titleVariant: "h6",
      message: finalErrorMessage,
    });
    reset(correctedValues);
    // setDataParValues(correctedValues);
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <FabDialogWrapper
        maxWidth="xl"
        fabProps={{ sx: { position: "absolute", top: "130px", right: "1rem", zIndex: 1 } }}
        PaperProps={{ sx: { minWidth: "499px" } }}
        sx={{ marginTop: "40px" }}
      >
        <HelpDataPar__DataPar />
      </FabDialogWrapper>
      <AtomicSnackbarMessage atomConfig={atomDataParModuleSnackbar} />
      <DataParTabs {...bag} />
      <Box className="DataPar__TabContentContainer" pb={7.5}>
        {currentDataParTab === "StudyParameters" && <TabStudyParameters control={control} />}
        {currentDataParTab === "SequenceParameters" && <TabSequenceParameters control={control} />}
        {currentDataParTab === "ProcessParameters" && <TabProcessingParameters control={control} />}
      </Box>
      <Paper
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          borderRadius: 0,
          display: "flex",
          justifyContent: "space-between",
          gap: 1,
          padding: 1,
          zIndex: 10, // Labels can clip through without this being present
        }}
        elevation={10}
      >
        <Button variant="contained" type="submit" fullWidth>
          Submit
        </Button>
        <Button
          variant="contained"
          sx={{ backgroundColor: theme => theme.palette.orange.main }}
          type="button"
          fullWidth
          onClick={handleLoadDataPar}
        >
          Load
        </Button>
      </Paper>
    </form>
  );
}

export default React.memo(DataParPage);

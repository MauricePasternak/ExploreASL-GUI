import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import { isEmpty as lodashIsEmpty } from "lodash";
import React, { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { SchemaRunEASLSingleStudySetup } from "../../../common/schemas/RunEASLSchema";
import { YupValidate } from "../../../common/utilityFunctions/formFunctions";
import AtomicFilepathTreeView from "../../../components/FileTreeViewComponents/AtomicFilepathTreeView";
import { ControlledFilepathTextField } from "../../../components/FormComponents/RHFFilepathTextfield";
import FabDialogWrapper from "../../../components/WrapperComponents/FabDialogWrapper";
import HelpProcessStudies__PrepareAReRun from "../../../pages/Help/HelpProcessStudies__PrepareAReRun";
import { atomStudyRootPathsByAllStudies, atomStudyStatusByAllStudies } from "../../../stores/ProcessStudiesStore";
import {
  atomReRunStudiesSelectedNodes,
  atomReRunStudiesTree,
  ReRunStudiesChannelBaseName
} from "../../../stores/ReRunStudiesStore";

function SubmoduleReRunAStudy() {
  const { api } = window;
  const [studyPathToReRun, setStudyPathToReRun] = useState("");
  const [isValid, setIsValid] = useState(false);
  const currentStudyPaths = useAtomValue(atomStudyRootPathsByAllStudies);
  const currentStatuses = useAtomValue(atomStudyStatusByAllStudies);
  const selectedNodes = useAtomValue(atomReRunStudiesSelectedNodes);
  const { control, watch, setError, clearErrors } = useForm({
    defaultValues: { studyRootPath: studyPathToReRun },
  });
  const currentFormValue = watch("studyRootPath");

  const checkIfIsRunning = (filepath: string): boolean => {
    for (let index = 0; index < currentStudyPaths.length; index++) {
      const studyPath = currentStudyPaths[index];
      const currentStatus = currentStatuses[index];
      if (studyPath === filepath && currentStatus !== "Standby") return true;
    }
    return false;
  };

  async function ValidateReRunPath(filepath: string) {
    const { values, errors } = await YupValidate(SchemaRunEASLSingleStudySetup, { studyRootPath: filepath });

    if (!lodashIsEmpty(errors)) {
      const error = errors.studyRootPath;
      setError("studyRootPath", { type: "validate", message: error.message });
      setIsValid(false);
      return;
    }

    setIsValid(true);
    setStudyPathToReRun(`${values.studyRootPath}`);
    clearErrors();
  }

  useEffect(() => {
    const checkIfIsValid = async () => {
      const isRunning = checkIfIsRunning(currentFormValue);
      if (isRunning) {
        setError("studyRootPath", { type: "RunningElsewhere", message: "Study is already running" });
        setIsValid(false);
        return;
      }
      await ValidateReRunPath(currentFormValue);
    };
    checkIfIsValid();
  }, [currentStatuses, currentFormValue]);

  const handleDeleteFilepaths = async () => {
    for (const node of selectedNodes) {
      await api.path.deleteFilepath(node.filepath.path);
    }
  };

  return (
    <Box rowGap={3} padding={3} flexGrow={1} display="flex" flexDirection="column" position="relative">
      <FabDialogWrapper
        maxWidth="xl"
        fabProps={{ sx: { position: "absolute", top: "20px", right: "1rem", zIndex: 1 } }}
        PaperProps={{ sx: { minWidth: "499px" } }}
        sx={{ marginTop: "40px" }}
      >
        <HelpProcessStudies__PrepareAReRun />
      </FabDialogWrapper>
      <Typography variant="h4">Prepare A Re-Run</Typography>
      <form>
        <Controller
          control={control}
          name="studyRootPath"
          render={({ field, fieldState }) => {
            return (
              <ControlledFilepathTextField
                field={field}
                fieldState={fieldState}
                label="Study Root Path"
                filepathType="dir"
                dialogOptions={{
                  properties: ["openDirectory"],
                }}
                helperText='The root folder of the study. Expected to contain "derivatives/ExploreASL", "rawdata" and "sourcedata" subfolders'
              />
            );
          }}
        />
      </form>
      {isValid && studyPathToReRun && (
        <>
          <AtomicFilepathTreeView
            watchChannel={ReRunStudiesChannelBaseName}
            rootPath={`${studyPathToReRun}/derivatives/ExploreASL/lock`}
            atomTree={atomReRunStudiesTree}
            atomSelectedNodes={atomReRunStudiesSelectedNodes}
          />
          <Paper elevation={2} sx={{ padding: 3, position: "fixed", bottom: 0, left: 0, width: "100%" }}>
            <Button variant="contained" fullWidth onClick={handleDeleteFilepaths} disabled={selectedNodes.length === 0}>
              Delete Selected Steps To Allow For Re-run
            </Button>
          </Paper>
        </>
      )}
    </Box>
  );
}

export default React.memo(SubmoduleReRunAStudy);

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import CircleIcon from "@mui/icons-material/Circle";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAtom, useSetAtom } from "jotai";
import { isEmpty as lodashIsEmpty, range as lodashRange, sum as lodashSum, cloneDeep as lodashCloneDeep, set as lodashSet, } from "lodash";
import React, { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { Regex } from "../../../common/utils/Regex";
import { DATAPARFILE_BASENAME } from "../../../common/GLOBALS";
import { DataParFieldNameTranslator } from "../../../common/schemas/DataParSchemas/DataParFieldNameTranslator";
import { SchemaDataPar } from "../../../common/schemas/DataParSchemas/DataParSchema";
import { SchemaRunEASLSingleStudySetup } from "../../../common/schemas/ProcessStudiesSchemas/RunEASLSchema";
import { formatErrorsForDisplay, YupResolverFactoryBase, YupValidate } from "../../../common/utils/formFunctions";
import LabelledSelect from "../../../components/RegularFormComponents/LabelledSelect";
import { atomProcStudyPIDs, atomSetModuleToRunForAStudy, atomSetNumCoresForAStudy, atomSetPathForAStudy, atomSetStatusForAStudy, ProcessStudiesChannelBaseName, } from "../../../stores/ProcessStudiesStore";
import { atomProcessStudiesSnackbar } from "../../../stores/SnackbarStore";
import RunEASLAccordionSummary from "./RunEASLAccordionSummary";
import RunEASLPauseResumeTerminateControls from "./RunEASLPauseResumeTerminateControls";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";
import { IPCProgressWithLabel, IPCQuill } from "../../../components/IPCComponents";
import { DebouncedFilepathInput } from "../../../components/DebouncedComponents";
function RunEASLSingleStudySetup({ studyIndex, studyRootPath, isDuplicatePath, numUsedCoresAllStudies, numUsedCoresForThisStudy, whichModulesToRun, currentStatus, }) {
    const { api } = window;
    const [pids, setPids] = useAtom(atomProcStudyPIDs);
    const changeNumCores = useSetAtom(atomSetNumCoresForAStudy);
    const changeStatus = useSetAtom(atomSetStatusForAStudy);
    const changeModulesToRun = useSetAtom(atomSetModuleToRunForAStudy);
    const changeDataParPath = useSetAtom(atomSetPathForAStudy);
    const setProcessStudiesSnackbar = useSetAtom(atomProcessStudiesSnackbar);
    const { control, handleSubmit, formState: { errors }, watch, } = useForm({
        defaultValues: { studyRootPath: studyRootPath },
        resolver: YupResolverFactoryBase(SchemaRunEASLSingleStudySetup),
    });
    // console.log(
    //   `RunEASLSingleStudySetup: studyIndex: ${studyIndex} has rendered with studyRootPath: ${studyRootPath} and isDuplicatePath: ${isDuplicatePath}`
    // );
    // Variables stemming from the study setup props
    const channelName = `${ProcessStudiesChannelBaseName}${studyIndex}`;
    const numPhysicalCores = Math.floor(api.cpuCount / 2);
    const numCoresUsedByOtherStudies = numUsedCoresAllStudies - numUsedCoresForThisStudy;
    const coreLabelOptions = lodashRange(1, numPhysicalCores + 1).map((count) => ({
        label: `${count}`,
        value: count,
        disabled: count > numPhysicalCores - numCoresUsedByOtherStudies || (whichModulesToRun === "Population" && count > 1),
    }));
    const modulesToRunOptions = [
        { label: "Structural Module", value: "Structural" },
        { label: "ASL Module", value: "ASL" },
        { label: "Structural and ASL Modules", value: "Both" },
        {
            label: "Population Module",
            value: "Population",
            disabled: numUsedCoresForThisStudy > 1,
        },
    ];
    /**
     * useEffect for updating the studyRootPath atom when the studyRootPath textfield changes
     */
    useEffect(() => {
        const subscription = watch(({ studyRootPath: formStudyRootPath }) => {
            // console.log(
            //   `Subscription in StudySetup${studyIndex}. The current formStudyRootPath is ${formStudyRootPath} while the provided studyRootPath is ${studyRootPath}`
            // );
            if (studyRootPath !== formStudyRootPath) {
                // console.log(`Syncing the studyRootPath atom with the formStudyRootPath for study ${studyIndex}`);
                changeDataParPath({ studyIndex, newStudyRootPath: formStudyRootPath });
            }
        });
        return () => {
            console.log(`Unsubscribing from StudySetup${studyIndex}`);
            subscription.unsubscribe();
        };
    }, [watch]);
    function handleFeedbackProcessError(pid, err) {
        console.warn(`Study ${channelName} has received a childProcessHasErrored Event with error: ${err}`);
        pids.includes(pid) && setPids((currentPids) => currentPids.filter((p) => p !== pid));
    }
    function handleFeedbackProcessClosed(pid, exitCode, runSummary) {
        const numUnsuccesfulProcs = lodashSum(runSummary.exitSummaries.map((summary) => (summary.exitCode !== 0 ? 1 : 0)));
        console.log(`Study ${channelName} -- handleFeedbackProcessClosed callback has givens:\n`, JSON.stringify({ pid, exitCode, runSummary, numUnsuccesfulProcs }, null, 2));
        const reportError = numUnsuccesfulProcs > 0 || runSummary.numIncompleteSteps > 0;
        if (reportError) {
            setProcessStudiesSnackbar({
                severity: "error",
                title: numUnsuccesfulProcs > 0 ? "Errors in one or more cores" : "Finished with incomplete steps",
                message: [
                    "Run Error Summary:",
                    `Number of alloted cores which reported an error: ${numUnsuccesfulProcs}`,
                    `Number of incomplete steps: ${runSummary.numIncompleteSteps}`,
                    "The following a general summary of which parts failed and when (some of these may be false-positives if this was due to a crash):",
                    ...runSummary.missedStepsMessages,
                    " ",
                    "Please refer to the logs directory located within derivatives/ExploreASL for this study to ascertain what errors occured.",
                ],
            });
        }
        else {
            setProcessStudiesSnackbar({
                severity: "success",
                title: "Successful ExploreASL Run",
                message: [
                    "Completed all anticipated steps.",
                    "Please remember to cite this program if you intend to publish these results.",
                ],
            });
        }
        console.log(`Study ${channelName} -- handleFeedbackProcessClosed will now reset status to Standby and clear its PIDS`);
        changeStatus({ studyIndex, status: "Standby" });
        pids.length > 0 && setPids([]);
        api.invoke("App:SoundNotification");
    }
    /**
     * useEffects for api-related tasks
     */
    useEffect(() => {
        api.on(`${channelName}:childProcessHasErrored`, handleFeedbackProcessError);
        api.on(`${channelName}:childProcessHasClosed`, handleFeedbackProcessClosed);
        // On unmount, remove the event listeners
        return () => {
            api.removeAllListeners(`${channelName}:childProcessHasErrored`);
            api.removeAllListeners(`${channelName}:childProcessHasClosed`);
        };
    }, []);
    /**
     * Starts up processing the individual study using ExploreASL
     * @param studyRootPath the path to the study data directory. Should be pre-validated to contain a DataPar.json file.
     */
    const handleValidSubmit = ({ studyRootPath }) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        console.log("handleValidSubmit", studyRootPath);
        // Load the data par JSON file
        const jsonFilePath = `${studyRootPath}/${DATAPARFILE_BASENAME}`;
        const { error: loadDataParError, payload: initialDataParJSON } = yield api.path.readJSONSafe(jsonFilePath);
        if (loadDataParError) {
            console.warn("Error loading DataPar.json", loadDataParError);
            setProcessStudiesSnackbar({
                severity: "error",
                title: loadDataParError.type === "FileIsNotJSON"
                    ? "Provided filepath is not a valid JSON file"
                    : "Invalid syntax in JSON file",
                message: loadDataParError.message,
            });
            yield api.invoke("App:SoundNotification");
            return;
        }
        // Minor formatting operations before validation
        // Correct the exclusions field by removing the trailing "_#"
        const exclusion = (_b = (_a = initialDataParJSON.x) === null || _a === void 0 ? void 0 : _a.dataset) === null || _b === void 0 ? void 0 : _b.exclusion;
        let originalExclusion = lodashCloneDeep(exclusion);
        console.log("exclusion", exclusion);
        if (exclusion && Array.isArray(exclusion) && exclusion.length > 0) {
            const exclusionRegex = new Regex(`(?<SUBJECT>.*?)(?:_\\d+)?$`);
            const reformattedExclusion = exclusion
                .map((v) => {
                const match = exclusionRegex.search(v);
                return match ? match.groupsObject.SUBJECT : null;
            })
                .filter((v) => v);
            console.log("reformattedExclusion", reformattedExclusion);
            initialDataParJSON.x.dataset.exclusion = Array.from(new Set(reformattedExclusion));
        }
        // Validate the data par JSON file
        const { errors: validateDataParError, values: dataParValues } = yield YupValidate(SchemaDataPar, initialDataParJSON);
        if (!lodashIsEmpty(validateDataParError)) {
            console.warn("Error validating DataPar.json", validateDataParError);
            const parsedErrors = formatErrorsForDisplay(validateDataParError, DataParFieldNameTranslator);
            const finalErrorMessage = (React.createElement("div", null,
                React.createElement(Typography, null, "The following fields were found to be invalid and/or missing when loading the data parameters file. Please correct them in the \"Define Parameters\" step of this program and try again."),
                React.createElement(List, null, parsedErrors.map((error, index) => (React.createElement(ListItem, { key: `ProcessStudiesLoadErrorItem_${index}` },
                    React.createElement(ListItemIcon, null,
                        React.createElement(CircleIcon, null)),
                    React.createElement(ListItemText, null, error)))))));
            yield api.invoke("App:SoundNotification");
            setProcessStudiesSnackbar({
                severity: "error",
                title: "Invalid data parameters file",
                message: finalErrorMessage,
            });
            return;
        }
        // Last check, the number of cores shouldn't be greater than the number of subjects selected to process
        let finalNumCores = numUsedCoresForThisStudy;
        if (whichModulesToRun !== "Population" && numUsedCoresForThisStudy > dataParValues.x.GUI.SUBJECTS.length) {
            finalNumCores = dataParValues.x.GUI.SUBJECTS.length;
        }
        // Re-adjust some fields back to what ExploreASL accepts
        if (originalExclusion && ((_d = (_c = dataParValues.x) === null || _c === void 0 ? void 0 : _c.dataset) === null || _d === void 0 ? void 0 : _d.exclusion)) {
            lodashSet(dataParValues, "x.dataset.exclusion", originalExclusion);
        }
        // Call the backend to start the process
        const startupEASLResult = yield api.invoke("ExploreASL:RunExploreASL", channelName, dataParValues, {
            studyRootPath: studyRootPath,
            numberOfCores: finalNumCores,
            whichModulesToRun: whichModulesToRun,
        });
        if (startupEASLResult.GUIMessage.severity !== "success") {
            yield api.invoke("App:SoundNotification");
            setProcessStudiesSnackbar({
                severity: startupEASLResult.GUIMessage.severity,
                title: startupEASLResult.GUIMessage.title,
                message: startupEASLResult.GUIMessage.messages,
            });
            return;
        }
        // Otherwise, all is ready to be updated
        setPids(startupEASLResult.payload.pids);
        changeStatus({ studyIndex, status: "Running" });
        console.log(`Set the following PIDs: ${pids}`);
        console.log(`Set the following status: ${status}`);
    });
    const handleInvalidSubmit = (error) => {
        console.log("handleInvalidSubmit", error);
    };
    return (React.createElement(Accordion, { defaultExpanded: true },
        React.createElement(RunEASLAccordionSummary, { studyIndex: studyIndex, currentStatus: currentStatus }),
        React.createElement(AccordionDetails, null,
            React.createElement(Grid, { container: true, spacing: 2 },
                React.createElement(Grid, { item: true, xs: 12, md: 6, className: "StudySetupForm", display: "flex", flexDirection: "column" },
                    React.createElement("form", { onSubmit: handleSubmit(handleValidSubmit, handleInvalidSubmit), style: { display: "flex", flexDirection: "column", flexGrow: 1 } },
                        React.createElement(Box, { rowGap: 3, mt: 3, justifyContent: "space-between", flexGrow: 1, display: "flex", flexDirection: "column" },
                            React.createElement(OutlinedGroupBox, { label: "Study Settings", labelBackgroundColor: (theme) => theme.palette.mode === "dark" ? "#1e1e1e" : theme.palette.background.paper, display: "flex", flexDirection: "column", flexGrow: 1, padding: 3 },
                                React.createElement(Stack, { rowGap: 3 },
                                    React.createElement(Controller, { control: control, name: "studyRootPath", render: ({ field, fieldState }) => {
                                            var _a;
                                            // Adjust error when is a duplicate
                                            const alteredFieldState = isDuplicatePath
                                                ? Object.assign(Object.assign({}, fieldState), { error: {
                                                        message: "Another study is already using this indicated filepath",
                                                        type: "DuplicateError",
                                                    } }) : fieldState;
                                            return (React.createElement(DebouncedFilepathInput, Object.assign({}, field, { label: "Study Root Path", filepathType: "dir", dialogOptions: {
                                                    properties: ["openDirectory"],
                                                    title: "Select the Study Root Folder",
                                                }, errorMessage: (_a = alteredFieldState.error) === null || _a === void 0 ? void 0 : _a.message, error: !!alteredFieldState.error, disabled: currentStatus !== "Standby", helperText: 'The root folder of the study. Expected to contain "derivatives/ExploreASL", "rawdata" and "sourcedata" subfolders', buttonProps: { disabled: currentStatus !== "Standby" } })));
                                        } }),
                                    React.createElement(LabelledSelect, { disabled: currentStatus !== "Standby", options: coreLabelOptions, value: numUsedCoresForThisStudy, label: "Number of Cores Allocated for this Study", fullWidth: true, helperText: "Take care that each extra core adds ~3.5GB of memory usage", onChange: (e) => changeNumCores({ studyIndex: studyIndex, numberOfCores: Number(e.target.value) }) }),
                                    React.createElement(LabelledSelect, { disabled: currentStatus !== "Standby", options: modulesToRunOptions, value: whichModulesToRun, label: "Modules to Run", fullWidth: true, helperText: "The Population Module requires that only 1 core be alloted", onChange: (e) => changeModulesToRun({
                                            studyIndex: studyIndex,
                                            moduleToRun: e.target.value,
                                        }) }))),
                            React.createElement(OutlinedGroupBox, { label: "Run Control", labelBackgroundColor: (theme) => theme.palette.mode === "dark" ? "#1e1e1e" : theme.palette.background.paper, padding: 3 },
                                React.createElement(Box, null,
                                    React.createElement(Typography, null, "Progress"),
                                    React.createElement(IPCProgressWithLabel, { channelName: channelName })),
                                React.createElement(RunEASLPauseResumeTerminateControls, { studyIndex: studyIndex, channelName: channelName, currentStatus: currentStatus }),
                                React.createElement(Button, { sx: { minHeight: "100px", fontSize: (theme) => theme.typography.h4.fontSize }, variant: "contained", type: "submit", color: "primary", fullWidth: true, disabled: 
                                    // Do not run if there are errors with the folderPath, its already running or is a copy of another filepath
                                    currentStatus !== "Standby" || Object.keys(errors).length > 0 || isDuplicatePath, endIcon: React.createElement(DirectionsRunIcon, { fontSize: "large", sx: { ml: (theme) => theme.spacing(2), transform: "scale(2.5)" } }) }, "Run Study"))))),
                React.createElement(Grid, { item: true, xs: 12, md: 6, display: "flex", flexDirection: "column" },
                    React.createElement(OutlinedGroupBox, { label: "Program Feedback", labelBackgroundColor: (theme) => theme.palette.mode === "dark" ? "#1e1e1e" : theme.palette.background.paper, padding: 3, mt: 3, flexGrow: 1 },
                        React.createElement(IPCQuill, { channelName: channelName, defaultHeight: 561 })))))));
}
export default React.memo(RunEASLSingleStudySetup);
//# sourceMappingURL=RunEASLSingleStudySetup.js.map
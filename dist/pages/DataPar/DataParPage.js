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
import { useForm } from "react-hook-form";
import { DATAPARFILE_BASENAME } from "../../common/GLOBALS";
import { DataParFieldNameTranslator } from "../../common/schemas/DataParSchemas/DataParFieldNameTranslator";
import { SchemaDataPar } from "../../common/schemas/DataParSchemas/DataParSchema";
import { correctYupValidatedContent, formatErrorsForDisplay, parseNestedFormattedYupErrors, YupResolverFactoryBase, YupValidate, } from "../../common/utils/formFunctions";
import { Regex } from "../../common/utils/Regex";
import { stringArrToRegex } from "../../common/utils/stringFunctions";
import { AtomicSnackbarMessage } from "../../components/AtomicComponents";
import { FabDialogWrapper } from "../../components/WrapperComponents";
import { atomDataParCurrentTab, atomDataParDefaultValues } from "../../stores/DataParStore";
import { atomDataParModuleSnackbar } from "../../stores/SnackbarStore";
import HelpDataPar__DataPar from "../Help/HelpDataPar__DataPar";
import { TabProcessingParameters, TabSequenceParameters, TabStudyParameters } from "./DataParSections";
import { DataParSliceReadoutTimeDialog } from "./DataParSliceReadoutTimeDialog";
import DataParTabs from "./DataParTabs";
export const DataParPage = React.memo(() => {
    const { api } = window;
    // Atomic State
    const currentDataParTab = useAtomValue(atomDataParCurrentTab);
    const setDataParSnackbar = useSetAtom(atomDataParModuleSnackbar);
    const defaultDataParValues = useAtomValue(atomDataParDefaultValues);
    // Form State
    const bag = useForm({
        defaultValues: defaultDataParValues,
        resolver: YupResolverFactoryBase(SchemaDataPar),
        reValidateMode: "onChange",
    });
    const { control, handleSubmit, reset, trigger, setValue } = bag;
    /**
     * Handler for saving the data par values to a DataPar.json file located at the indicated Study Root Path
     * @param values The values from the form
     */
    const handleValidSubmit = (values) => __awaiter(void 0, void 0, void 0, function* () {
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
            for (const fp of yield api.path.glob(`${values.x.GUI.StudyRootPath}/derivatives/ExploreASL`, "*", {
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
            yield api.path.writeJSON(dataParFilePath_1, values, { spaces: 1 });
            yield api.path.writeJSON(dataParFilePath_2, values, { spaces: 1 });
            setDataParSnackbar({
                severity: "success",
                title: "Data Parameters saved successfully",
                message: ["Saved the data parameters to:", api.path.osSpecificString(dataParFilePath_1)],
            });
        }
        catch (error) {
            setDataParSnackbar({
                severity: "error",
                title: "Could not save Data Parameters to the desired JSON file",
                message: ["The following errors were detected:", error.message],
            });
        }
    });
    const handleInvalidSubmit = (errors) => {
        const parsedErrors = parseNestedFormattedYupErrors(errors);
        console.log("Form errors: ", parsedErrors);
    };
    /**
     * Handler for loading DataParValues from an existing DataPar.json file
     */
    const handleLoadDataPar = () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const { canceled, filePaths } = yield api.invoke("Dialog:OpenDialog", {
            title: "Select a dataPar.json file",
            properties: ["openFile"],
            filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (canceled)
            return;
        // Load in the contents of the JSON file and early-exit if there was an issue
        const [jsonFile] = filePaths;
        const { error: loadDataParError, payload: jsonFileContent } = yield api.path.readJSONSafe(jsonFile);
        if (loadDataParError) {
            console.warn("Error loading DataPar.json file: ", loadDataParError);
            setDataParSnackbar({
                severity: "error",
                title: "Error loading JSON file",
                message: loadDataParError.message,
            });
            return;
        }
        // Minor formatting operations before validation
        // Correct the exclusions field by removing the trailing "_#"
        const exclusion = (_b = (_a = jsonFileContent.x) === null || _a === void 0 ? void 0 : _a.dataset) === null || _b === void 0 ? void 0 : _b.exclusion;
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
            jsonFileContent.x.dataset.exclusion = Array.from(new Set(reformattedExclusion));
        }
        // Validate the JSON file
        console.log("Pre-Validation values", jsonFileContent);
        const { values, errors } = yield YupValidate(SchemaDataPar, jsonFileContent);
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
        const finalErrorMessage = (React.createElement("div", null,
            React.createElement(Typography, null, "The following fields were found to be invalid when loading the data parameters file. They have been replaced with defaults."),
            React.createElement(List, null, parsedErrors.map((error, index) => (React.createElement(ListItem, { key: `DataParLoadErrorItem_${index}` },
                React.createElement(ListItemIcon, null,
                    React.createElement(CircleIcon, null)),
                React.createElement(ListItemText, null, error)))))));
        setDataParSnackbar({
            severity: "warning",
            title: "Loaded DataPar.json, but errors were found and corrected",
            titleVariant: "h6",
            message: finalErrorMessage,
        });
        reset(correctedValues);
        // Set the form into a submitted state so that changes immediately update validation
        // (initially RHF validates on a onSubmit mode and switches to an onChange mode only after the form is submitted)
        handleSubmit(() => { })();
    });
    return (React.createElement("form", { onSubmit: handleSubmit(handleValidSubmit, handleInvalidSubmit) },
        React.createElement(FabDialogWrapper, { maxWidth: "xl", fabProps: { sx: { position: "absolute", top: "130px", right: "1rem", zIndex: 1 } }, PaperProps: { sx: { minWidth: "499px" } }, sx: { marginTop: "40px" } },
            React.createElement(HelpDataPar__DataPar, null)),
        React.createElement(AtomicSnackbarMessage, { atomConfig: atomDataParModuleSnackbar }),
        React.createElement(DataParSliceReadoutTimeDialog, { setValue: setValue }),
        React.createElement(DataParTabs, Object.assign({}, bag)),
        React.createElement(Box, { className: "DataPar__TabContentContainer", pb: 7.5 },
            currentDataParTab === "StudyParameters" && React.createElement(TabStudyParameters, { control: control, trigger: trigger }),
            currentDataParTab === "ModelingParameters" && React.createElement(TabSequenceParameters, { control: control, trigger: trigger }),
            currentDataParTab === "ProcessParameters" && React.createElement(TabProcessingParameters, { control: control })),
        React.createElement(Paper, { sx: {
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
            }, elevation: 10 },
            React.createElement(Button, { variant: "contained", type: "submit", fullWidth: true }, "Save"),
            React.createElement(Button, { variant: "contained", sx: { backgroundColor: (theme) => theme.palette.orange.main }, type: "button", fullWidth: true, onClick: handleLoadDataPar }, "Load"))));
});
//# sourceMappingURL=DataParPage.js.map
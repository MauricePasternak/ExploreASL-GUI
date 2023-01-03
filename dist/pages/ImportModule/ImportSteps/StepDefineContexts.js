var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useSetAtom } from "jotai";
import { cloneDeep as lodashCloneDeep } from "lodash";
import React, { useEffect } from "react";
import { useFieldArray } from "react-hook-form";
import ContextIcon from "../../../assets/svg/ContextIcon.svg";
import { GUIIMPORTFILE_BASENAME, SOURCESTRUCTUREFILE_BASENAME, STUDYPARFILE_BASENAME } from "../../../common/GLOBALS";
import { RHFMultiStepButtons } from "../../../components/RHFComponents/RHFMultiStep";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import { ImportSingleContextDefault } from "../../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../../stores/SnackbarStore";
import HelpImport__StepDefineAdditionalContext from "../../Help/HelpImport__StepDefineAdditionalContext";
import { buildSourceStructureJSON, buildStudyParJSON, fetchGUIImportPar, updateContextSpecificRegexps, } from "../ImportModuleHelperFunctions";
import SingleImportContext from "./SingleImportContext";
export function StepDefineContexts({ currentStep, setCurrentStep, control, trigger, getValues, setValue, handleSubmit, }) {
    const { api } = window;
    const { fields, append, remove } = useFieldArray({ control: control, name: "ImportContexts" });
    const setImportSnackbar = useSetAtom(atomImportModuleSnackbar);
    console.log("Step 'Define Contexts' -- rendered with fields", fields);
    const handleValidSubmit = (values) => __awaiter(this, void 0, void 0, function* () {
        console.log("Step 'Define Contexts' -- Valid Submit Values: ", values);
        // Form values must be adjusted to translate Paths into folderHierarchy for each context
        const adjustedValues = yield updateContextSpecificRegexps(lodashCloneDeep(values));
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
        const sourceStructureJSON = yield buildSourceStructureJSON(adjustedValues);
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
        const studyParJSON = yield buildStudyParJSON(adjustedValues);
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
            const createdGUIImportJSONFile = yield api.path.writeJSON(api.path.asPath(values.StudyRootPath, GUIIMPORTFILE_BASENAME).path, values, // We don't necessarily want to write the adjusted values here, as the auto-generated extra contexts would be troublesome upon reload
            { spaces: 1 });
            const createdSourceStructureFile = yield api.path.writeJSON(api.path.asPath(values.StudyRootPath, SOURCESTRUCTUREFILE_BASENAME).path, sourceStructureJSON, { spaces: 1 });
            const createdStudyParFile = yield api.path.writeJSON(api.path.asPath(values.StudyRootPath, STUDYPARFILE_BASENAME).path, studyParJSON, { spaces: 1 });
            if (yield Promise.all([
                api.path.filepathExists(createdGUIImportJSONFile.path),
                api.path.filepathExists(createdSourceStructureFile.path),
                api.path.filepathExists(createdStudyParFile.path),
            ])) {
                setCurrentStep(currentStep + 1);
            }
        }
        catch (error) {
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
    });
    const handleInvalidSubmit = (errors) => {
        console.debug("Step 'Define Content' -- Invalid Submit Errors: ", errors);
    };
    /**
     * useEffect for populating fields from an existing ImportPar.json file if it is valid
     */
    useEffect(() => {
        function handleLoadImportPar() {
            return __awaiter(this, void 0, void 0, function* () {
                const currentValues = getValues();
                try {
                    const payload = yield fetchGUIImportPar(currentValues.StudyRootPath);
                    if (!payload || !("ImportContexts" in payload))
                        return;
                    setValue("ImportContexts", payload.ImportContexts, {
                        shouldValidate: false,
                        shouldTouch: false,
                        shouldDirty: false,
                    });
                    return;
                }
                catch (error) {
                    console.warn(`Step 'Define Contexts' -- useEffect -- Error while loading/validating ImportPar.json: `, error);
                    return;
                }
            });
        }
        handleLoadImportPar();
    }, []);
    return (React.createElement(Fade, { in: true },
        React.createElement("form", { onSubmit: handleSubmit(handleValidSubmit, handleInvalidSubmit) },
            React.createElement(Card, { elevation: 3, sx: { marginBottom: 2 } },
                React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Define Scan Acquisition Context"), subheader: React.createElement(Typography, null, "Define the specific nature of the ASL scan acquisition to allow for the Import Module to properly convert the series into NIFTI format. Supports defining multiple acquisition contexts for complex datasets."), avatar: React.createElement(Avatar, null,
                        React.createElement(SvgIcon, { component: ContextIcon, inheritViewBox: true })), action: React.createElement(FabDialogWrapper, { maxWidth: "xl", 
                        // fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
                        PaperProps: { sx: { minWidth: "499px" } }, sx: { marginTop: "40px" } },
                        React.createElement(HelpImport__StepDefineAdditionalContext, null)) }),
                React.createElement(Divider, null),
                React.createElement(CardContent, null,
                    React.createElement(Button, { fullWidth: true, variant: "contained", onClick: () => {
                            const defaultContext = lodashCloneDeep(ImportSingleContextDefault);
                            append(defaultContext);
                        } }, "Add a context")),
                React.createElement(Divider, null),
                React.createElement(CardContent, null,
                    React.createElement(Stack, { spacing: 1 }, fields.map((field, fieldIndex) => {
                        return (React.createElement(SingleImportContext, { key: field.id, contextIndex: fieldIndex, remove: remove, control: control, trigger: trigger, setFieldValue: setValue }));
                    })))),
            React.createElement(RHFMultiStepButtons, { currentStep: currentStep, setCurrentStep: setCurrentStep }))));
}
//# sourceMappingURL=StepDefineContexts.js.map
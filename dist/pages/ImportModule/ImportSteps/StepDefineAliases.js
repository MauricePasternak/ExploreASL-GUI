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
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { zipObject as lodashZipObject } from "lodash";
import React, { useCallback, useEffect } from "react";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import AliasIcon from "../../../assets/svg/AliasIcon.svg";
import { assignSelfKeysOnly } from "../../../common/utils/objectFunctions";
import { RHFMapping } from "../../../components/RHFComponents";
import { RHFMultiStepButtons } from "../../../components/RHFComponents/RHFMultiStep";
import HelpImport__StepDefineAliases from "../../Help/HelpImport__StepDefineAliases";
import FieldCardScanAliases from "./FieldCardScanAliases";
import { fetchGUIImportPar, getAliasBasenames } from "../ImportModuleHelperFunctions";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";
export function StepDefineAliases({ currentStep, setCurrentStep, control, setValue, getValues, handleSubmit, }) {
    const { api } = window;
    /** Handler for populating the alias basenames with the most up-to-date values. */
    const setupAliases = useCallback(() => __awaiter(this, void 0, void 0, function* () {
        const { StudyRootPath, SourcedataStructure, MappingScanAliases, MappingSessionAliases, MappingVisitAliases } = getValues();
        // If there exists an EASLGUI_ImportPar.json file, then we can use the values from that file to populate the form.
        const fetchGUIImportParResult = yield fetchGUIImportPar(StudyRootPath);
        // Retrieve a list of the basenames of files at the appropriate levels for
        // Scan, Session, and Visit.
        const result = yield getAliasBasenames(StudyRootPath, SourcedataStructure);
        if (!result)
            return;
        const { scanBasenames, sessionBasenames, visitBasenames } = result;
        // Create default values for the aliases
        const defaultScanAliases = fetchGUIImportParResult && "MappingScanAliases" in fetchGUIImportParResult
            ? lodashZipObject(scanBasenames, scanBasenames.map((basename) => { var _a; return (_a = fetchGUIImportParResult.MappingScanAliases[basename]) !== null && _a !== void 0 ? _a : "Ignore"; }))
            : lodashZipObject(scanBasenames, scanBasenames.map(() => "Ignore"));
        const defaultSessionAliases = fetchGUIImportParResult && "MappingSessionAliases" in fetchGUIImportParResult
            ? lodashZipObject(sessionBasenames, sessionBasenames.map((basename, i) => { var _a; return (_a = fetchGUIImportParResult.MappingSessionAliases[basename]) !== null && _a !== void 0 ? _a : `ASL_${i + 1}`; }))
            : lodashZipObject(sessionBasenames, sessionBasenames.map((_, i) => `ASL_${i + 1}`) // +1 to account for MATLAB indexing
            );
        const defaultVisitAliases = fetchGUIImportParResult && "MappingVisitAliases" in fetchGUIImportParResult
            ? lodashZipObject(visitBasenames, visitBasenames.map((basename) => { var _a; return (_a = fetchGUIImportParResult.MappingVisitAliases[basename]) !== null && _a !== void 0 ? _a : basename; }))
            : lodashZipObject(visitBasenames, visitBasenames);
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
    }), [getValues]);
    useEffect(() => {
        setupAliases();
    }, []);
    const handleValidSubmit = (values) => __awaiter(this, void 0, void 0, function* () {
        console.log("Step 'Define Aliases' -- Valid Submit Values: ", values);
        setCurrentStep(currentStep + 1);
    });
    const handleInvalidSubmit = (errors) => {
        console.log("Step 'Define Aliases' -- Invalid Submit Errors: ", errors);
    };
    return (React.createElement(Fade, { in: true },
        React.createElement("form", { onSubmit: handleSubmit(handleValidSubmit, handleInvalidSubmit) },
            React.createElement(Box, { mt: 1, pb: 5, display: "flex", gap: 2, flexDirection: "column", position: "relative" },
                React.createElement(Card, null,
                    React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Define Aliases"), subheader: React.createElement(Typography, null, "Define mappings of current folder names to your preferred aliases"), action: React.createElement(FabDialogWrapper, { maxWidth: "xl", 
                            // fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
                            PaperProps: { sx: { minWidth: "499px" } }, sx: { marginTop: "40px" } },
                            React.createElement(HelpImport__StepDefineAliases, null)), avatar: React.createElement(Avatar, null,
                            React.createElement(SvgIcon, { component: AliasIcon, inheritViewBox: true, fontSize: "large" })) }),
                    React.createElement(CardContent, null,
                        React.createElement(FieldCardScanAliases, { control: control, name: "MappingScanAliases" }),
                        React.createElement(RHFMapping, { control: control, name: "MappingVisitAliases", type: "textfield", title: "Visit Aliases", keysSubtitle: "Folder Name", valuesSubtitle: "Visit Alias", placeholder: React.createElement(React.Fragment, null,
                                React.createElement(Divider, null),
                                React.createElement(Typography, { padding: 2 }, "No Visit Folder Level was specified in the previous step. Go back if this was not expected.")) }),
                        React.createElement(RHFMapping, { control: control, name: "MappingSessionAliases", type: "textfield", title: "Session Aliases", keysSubtitle: "Folder Name", valuesSubtitle: "Session Alias", placeholder: React.createElement(React.Fragment, null,
                                React.createElement(Divider, null),
                                React.createElement(Typography, { padding: 2 }, "No Session Folder Level was specified in the previous step. Go back if this was not expected")) })))),
            React.createElement(RHFMultiStepButtons, { currentStep: currentStep, setCurrentStep: setCurrentStep }))));
}
//# sourceMappingURL=StepDefineAliases.js.map
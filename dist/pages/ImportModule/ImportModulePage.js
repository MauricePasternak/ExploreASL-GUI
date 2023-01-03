import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import { useAtomValue } from "jotai";
import React from "react";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { SchemaImportStepDefineAliases, SchemaImportStepDefineMultiContext, SchemaImportStepDefineRuntimeEnvs, } from "../../common/schemas/ImportSchemas/ImportSchema";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import { AtomicSnackbarMessage } from "../../components/AtomicComponents";
import { RHFMultiStep, RHFMultiStepStepper } from "../../components/RHFComponents";
import { atomImportModuleFormDefaultValues } from "../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../stores/SnackbarStore";
import { StepDefineAliases, StepDefineContexts, StepDefineRuntimeEnvs, StepRunImportModule } from "./ImportSteps";
const importModuleSchemas = [
    SchemaImportStepDefineRuntimeEnvs,
    SchemaImportStepDefineAliases,
    SchemaImportStepDefineMultiContext,
];
const ImportModulePaper = styled(Box)(({ theme }) => ({
    padding: theme.spacing(2),
    backgroundColor: theme.palette.mode === "dark" ? "#121212" : "white",
    position: "fixed",
    width: "100%",
    top: APPBARHEIGHTPIXELS,
    left: 0,
    zIndex: 1051,
    height: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
}));
export const ImportModulePage = React.memo(() => {
    const importModuleFormDefaultValues = useAtomValue(atomImportModuleFormDefaultValues);
    return (React.createElement(Box, { padding: 1 },
        React.createElement(RHFMultiStep, { defaultValues: importModuleFormDefaultValues, schemas: [...importModuleSchemas], resolverFactory: YupResolverFactoryBase }, (bag) => {
            const { currentStep, control } = bag;
            return (React.createElement(React.Fragment, null,
                React.createElement(ImportModulePaper, null,
                    React.createElement(RHFMultiStepStepper, { className: "ImportModuleStepper", sx: { width: "100%" }, control: control, currentStep: currentStep, steps: [
                            {
                                label: "Define Folder Structure",
                                fieldNames: ["EASLPath", "EASLType", "MATLABRuntimePath", "StudyRootPath", "SourcedataStructure"],
                            },
                            {
                                label: "Define Aliases",
                                fieldNames: ["MappingScanAliases", "MappingSessionAliases", "MappingVisitAliases"],
                            },
                            {
                                label: "Define ASL Acquisition Context",
                                fieldNames: ["ImportContexts"],
                            },
                        ] })),
                React.createElement(Box, { mt: 6.5 },
                    currentStep === 0 && React.createElement(StepDefineRuntimeEnvs, Object.assign({}, bag)),
                    currentStep === 1 && React.createElement(StepDefineAliases, Object.assign({}, bag)),
                    currentStep === 2 && React.createElement(StepDefineContexts, Object.assign({}, bag)),
                    currentStep === 3 && React.createElement(StepRunImportModule, Object.assign({}, bag))),
                React.createElement(AtomicSnackbarMessage, { atomConfig: atomImportModuleSnackbar })));
        })));
});
//# sourceMappingURL=ImportModulePage.js.map
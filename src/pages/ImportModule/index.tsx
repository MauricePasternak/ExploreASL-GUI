import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import React from "react";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { YupResolverFactoryBase } from "../../common/utilityFunctions/formFunctions";
import {
  SchemaImportDefineContext,
  SchemaImportStepDefineAliases,
  SchemaImportStepDefineMultiContext,
  SchemaImportStepDefineRuntimeEnvs,
} from "../../common/schemas/ImportSchema";
import RHFMultiStep, { RHFMultiStepStepper } from "../../components/FormComponents/RHFMultiStep";
import { ImportModuleFormDefaultValues } from "../../stores/ImportPageStore";
import StepDefineAliases from "./StepDefineAliases";
import StepDefineContexts from "./StepDefineContexts";
import StepDefineRuntimeEnvs from "./StepDefineRuntimeEnvs";
import StepRunImportModule from "./StepRunImportModule";

const importModuleSchemas = [
  SchemaImportStepDefineRuntimeEnvs,
  SchemaImportStepDefineAliases,
  // SchemaImportDefineContext,
  SchemaImportStepDefineMultiContext
];

const ImportModulePaper = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  backgroundColor: theme.palette.mode === "dark" ? "#121212" : "white",
  position: "fixed",
  width: "100%",
  top: APPBARHEIGHTPIXELS,
  left: 0,
  zIndex: 10,
  height: "48px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}));

function ImportModulePage() {
  return (
    <Box padding={1}>
      <RHFMultiStep
        data={ImportModuleFormDefaultValues}
        schemas={[...importModuleSchemas]}
        resolverFactory={YupResolverFactoryBase}
      >
        {bag => {
          const { currentStep, control } = bag;

          return (
            <>
              <ImportModulePaper>
                <RHFMultiStepStepper
                  sx={{ width: "100%" }}
                  control={control}
                  currentStep={currentStep}
                  steps={[
                    {
                      label: "Define Folder Structure",
                      fieldNames: ["EASLPath", "EASLType", "MATLABRuntimePath", "StudyRootPath", "SourcedataStructure"],
                    },
                    {
                      label: "Define Aliases",
                      fieldNames: ["MappingScanAliases", "MappingSessionAliases", "MappingVisitAliases"],
                    },
                    {
                      label: "Define Additional Context",
                      fieldNames: [
                        // "ASLManufacturer",
                        // "ASLSequence",
                        // "ASLSeriesPattern",
                        // "BackgroundSuppression",
                        // "BackgroundSuppressionNumberPulses",
                        // "BackgroundSuppressionPulseTime",
                        // "DummyPositionInASL",
                        // "LabelingDuration",
                        // "PostLabelingDelay",
                      ],
                    },
                  ]}
                />
              </ImportModulePaper>
              <Box mt={6.5}>
                {currentStep === 0 && <StepDefineRuntimeEnvs {...bag} />}
                {currentStep === 1 && <StepDefineAliases {...bag} />}
                {currentStep === 2 && <StepDefineContexts {...bag} />}
                {currentStep === 3 && <StepRunImportModule {...bag} />}
              </Box>
            </>
          );
        }}
      </RHFMultiStep>
    </Box>
  );
}

export default React.memo(ImportModulePage);

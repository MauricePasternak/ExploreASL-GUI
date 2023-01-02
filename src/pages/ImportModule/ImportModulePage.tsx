import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import React from "react";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import {
	SchemaImportStepDefineAliases,
	SchemaImportStepDefineMultiContext,
	SchemaImportStepDefineRuntimeEnvs,
} from "../../common/schemas/ImportSchemas/ImportSchema";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import { AtomicSnackbarMessage } from "../../components/AtomicComponents";
import { RHFMultiStep, RHFMultiStepStepper } from "../../components/RHFComponents";
import { ImportModuleFormDefaultValues } from "../../stores/ImportPageStore";
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
	return (
		<Box padding={1}>
			<RHFMultiStep
				data={ImportModuleFormDefaultValues}
				schemas={[...importModuleSchemas]}
				resolverFactory={YupResolverFactoryBase}
			>
				{(bag) => {
					const { currentStep, control } = bag;
					return (
						<>
							<ImportModulePaper>
								<RHFMultiStepStepper
									className="ImportModuleStepper"
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
											label: "Define ASL Acquisition Context",
											fieldNames: ["ImportContexts"],
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
							<AtomicSnackbarMessage atomConfig={atomImportModuleSnackbar} />
						</>
					);
				}}
			</RHFMultiStep>
		</Box>
	);
});

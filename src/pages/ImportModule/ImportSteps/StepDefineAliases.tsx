import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { zipObject as lodashZipObject } from "lodash";
import React, { useCallback, useEffect } from "react";
import { SubmitErrorHandler, SubmitHandler } from "react-hook-form";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import AliasIcon from "../../../assets/svg/AliasIcon.svg";
import { ImportScanType, ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
import { assignSelfKeysOnly } from "../../../common/utils/objectFunctions";
import { RHFMapping } from "../../../components/RHFComponents";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../../components/RHFComponents/RHFMultiStep";
import HelpImport__StepDefineAliases from "../../Help/HelpImport__StepDefineAliases";
import FieldCardScanAliases from "./FieldCardScanAliases";
import { fetchGUIImportPar, getAliasBasenames } from "../ImportModuleHelperFunctions";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";

export function StepDefineAliases({
	currentStep,
	setCurrentStep,
	control,
	setValue,
	getValues,
	handleSubmit,
}: RHFMultiStepReturnProps<ImportSchemaType>) {
	const { api } = window;

	/** Handler for populating the alias basenames with the most up-to-date values. */
	const setupAliases = useCallback(async () => {
		const { StudyRootPath, SourcedataStructure, MappingScanAliases, MappingSessionAliases, MappingVisitAliases } =
			getValues();

		// If there exists an EASLGUI_ImportPar.json file, then we can use the values from that file to populate the form.
		const fetchGUIImportParResult = await fetchGUIImportPar(StudyRootPath);

		// Retrieve a list of the basenames of files at the appropriate levels for
		// Scan, Session, and Visit.
		const result = await getAliasBasenames(StudyRootPath, SourcedataStructure);
		if (!result) return;

		const { scanBasenames, sessionBasenames, visitBasenames } = result;

		// Create default values for the aliases
		const defaultScanAliases: Record<string, ImportScanType> =
			fetchGUIImportParResult && "MappingScanAliases" in fetchGUIImportParResult
				? lodashZipObject(
						scanBasenames,
						scanBasenames.map((basename) => fetchGUIImportParResult.MappingScanAliases[basename] ?? "Ignore")
				  )
				: lodashZipObject(
						scanBasenames,
						scanBasenames.map(() => "Ignore")
				  );
		const defaultSessionAliases: Record<string, string> =
			fetchGUIImportParResult && "MappingSessionAliases" in fetchGUIImportParResult
				? lodashZipObject(
						sessionBasenames,
						sessionBasenames.map(
							(basename, i) => fetchGUIImportParResult.MappingSessionAliases[basename] ?? `ASL_${i + 1}`
						)
				  )
				: lodashZipObject(
						sessionBasenames,
						sessionBasenames.map((_, i) => `ASL_${i + 1}`) // +1 to account for MATLAB indexing
				  );
		const defaultVisitAliases: Record<string, string> =
			fetchGUIImportParResult && "MappingVisitAliases" in fetchGUIImportParResult
				? lodashZipObject(
						visitBasenames,
						visitBasenames.map((basename) => fetchGUIImportParResult.MappingVisitAliases[basename] ?? basename)
				  )
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
	}, [getValues]);

	useEffect(() => {
		setupAliases();
	}, []);

	const handleValidSubmit: SubmitHandler<ImportSchemaType> = async (values) => {
		console.log("Step 'Define Aliases' -- Valid Submit Values: ", values);
		setCurrentStep(currentStep + 1);
	};

	const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = (errors) => {
		console.log("Step 'Define Aliases' -- Invalid Submit Errors: ", errors);
	};

	return (
		<Fade in>
			<form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
				<Box mt={1} pb={5} display="flex" gap={2} flexDirection="column" position="relative">
					<Card>
						<CardHeader
							title={<Typography variant="h4">Define Aliases</Typography>}
							subheader={<Typography>Define mappings of current folder names to your preferred aliases</Typography>}
							action={
								<FabDialogWrapper
									maxWidth="xl"
									// fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
									PaperProps={{ sx: { minWidth: "499px" } }}
									sx={{ marginTop: "40px" }}
								>
									<HelpImport__StepDefineAliases />
								</FabDialogWrapper>
							}
							avatar={
								<Avatar>
									<SvgIcon component={AliasIcon} inheritViewBox fontSize="large" />
								</Avatar>
							}
						/>
						<CardContent>
							<FieldCardScanAliases control={control} name="MappingScanAliases" />
							<RHFMapping
								control={control}
								name="MappingVisitAliases"
								type="textfield"
								title="Visit Aliases"
								keysSubtitle="Folder Name"
								valuesSubtitle="Visit Alias"
								placeholder={
									<>
										<Divider />
										<Typography padding={2}>
											No Visit Folder Level was specified in the previous step. Go back if this was not expected.
										</Typography>
									</>
								}
							/>
							<RHFMapping
								control={control}
								name="MappingSessionAliases"
								type="textfield"
								title="Session Aliases"
								keysSubtitle="Folder Name"
								valuesSubtitle="Session Alias"
								placeholder={
									<>
										<Divider />
										<Typography padding={2}>
											No Session Folder Level was specified in the previous step. Go back if this was not expected
										</Typography>
									</>
								}
							/>
						</CardContent>
					</Card>
				</Box>
				<RHFMultiStepButtons currentStep={currentStep} setCurrentStep={setCurrentStep} />
			</form>
		</Fade>
	);
}

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
import { SubmitErrorHandler, SubmitHandler, useFieldArray } from "react-hook-form";
import ContextIcon from "../../../assets/svg/ContextIcon.svg";
import { GUIIMPORTFILE_BASENAME, SOURCESTRUCTUREFILE_BASENAME, STUDYPARFILE_BASENAME } from "../../../common/GLOBALS";
import { ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../../components/RHFComponents/RHFMultiStep";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import { ImportSingleContextDefault } from "../../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../../stores/SnackbarStore";
import HelpImport__StepDefineAdditionalContext from "../../Help/HelpImport__StepDefineAdditionalContext";
import {
	buildSourceStructureJSON,
	buildStudyParJSON,
	fetchGUIImportPar,
	updateContextSpecificRegexps,
} from "../ImportModuleHelperFunctions";
import SingleImportContext from "./SingleImportContext";

export function StepDefineContexts({
	currentStep,
	setCurrentStep,
	control,
	trigger,
	getValues,
	setValue,
	handleSubmit,
}: RHFMultiStepReturnProps<ImportSchemaType>) {
	const { api } = window;
	const { fields, append, remove } = useFieldArray({ control: control, name: "ImportContexts" });
	const setImportSnackbar = useSetAtom(atomImportModuleSnackbar);

	console.log("Step 'Define Contexts' -- rendered with fields", fields);

	const handleValidSubmit: SubmitHandler<ImportSchemaType> = async (values) => {
		console.log("Step 'Define Contexts' -- Valid Submit Values: ", values);

		// Form values must be adjusted to translate Paths into folderHierarchy for each context
		const adjustedValues = await updateContextSpecificRegexps(lodashCloneDeep(values));
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
		const sourceStructureJSON = await buildSourceStructureJSON(adjustedValues);
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
		const studyParJSON = await buildStudyParJSON(adjustedValues);
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
			const createdGUIImportJSONFile = await api.path.writeJSON(
				api.path.asPath(values.StudyRootPath, GUIIMPORTFILE_BASENAME).path,
				values, // We don't necessarily want to write the adjusted values here, as the auto-generated extra contexts would be troublesome upon reload
				{ spaces: 1 }
			);
			const createdSourceStructureFile = await api.path.writeJSON(
				api.path.asPath(values.StudyRootPath, SOURCESTRUCTUREFILE_BASENAME).path,
				sourceStructureJSON,
				{ spaces: 1 }
			);
			const createdStudyParFile = await api.path.writeJSON(
				api.path.asPath(values.StudyRootPath, STUDYPARFILE_BASENAME).path,
				studyParJSON,
				{ spaces: 1 }
			);

			if (
				await Promise.all([
					api.path.filepathExists(createdGUIImportJSONFile.path),
					api.path.filepathExists(createdSourceStructureFile.path),
					api.path.filepathExists(createdStudyParFile.path),
				])
			) {
				setCurrentStep(currentStep + 1);
			}
		} catch (error) {
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
	};

	const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = (errors) => {
		console.debug("Step 'Define Content' -- Invalid Submit Errors: ", errors);
	};

	/**
	 * useEffect for populating fields from an existing ImportPar.json file if it is valid
	 */
	useEffect(() => {
		async function handleLoadImportPar() {
			const currentValues = getValues();

			try {
				const payload = await fetchGUIImportPar(currentValues.StudyRootPath);
				if (!payload || !("ImportContexts" in payload)) return;

				setValue("ImportContexts", payload.ImportContexts, {
					shouldValidate: false,
					shouldTouch: false,
					shouldDirty: false,
				});
				return;
			} catch (error) {
				console.warn(`Step 'Define Contexts' -- useEffect -- Error while loading/validating ImportPar.json: `, error);
				return;
			}
		}

		handleLoadImportPar();
	}, []);

	return (
		<Fade in>
			<form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
				<Card elevation={3} sx={{ marginBottom: 2 }}>
					<CardHeader
						title={<Typography variant="h4">Define Scan Acquisition Context</Typography>}
						subheader={
							<Typography>
								Define how ASL scans were acquired (i.e. on which scanner vendor, timing settings, etc.). For complex
								studies such as multi-site and multi-scanner, specify multiple contexts for each unique set of
								acquisition circumstances.
							</Typography>
						}
						avatar={
							<Avatar>
								<SvgIcon component={ContextIcon} inheritViewBox />
							</Avatar>
						}
						action={
							<FabDialogWrapper
								maxWidth="xl"
								// fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
								PaperProps={{ sx: { minWidth: "499px" } }}
								sx={{ marginTop: "40px" }}
							>
								<HelpImport__StepDefineAdditionalContext />
							</FabDialogWrapper>
						}
					/>
					<Divider />
					<CardContent>
						<Button
							fullWidth
							variant="contained"
							onClick={() => {
								const defaultContext = lodashCloneDeep(ImportSingleContextDefault);
								append(defaultContext);
							}}
						>
							Add a context
						</Button>
					</CardContent>
					<Divider />
					<CardContent>
						<Stack spacing={1}>
							{fields.map((field, fieldIndex) => {
								return (
									<SingleImportContext
										key={field.id}
										contextIndex={fieldIndex}
										remove={remove}
										control={control}
										trigger={trigger}
										setFieldValue={setValue}
									/>
								);
							})}
						</Stack>
					</CardContent>
				</Card>
				<RHFMultiStepButtons currentStep={currentStep} setCurrentStep={setCurrentStep} />
			</form>
		</Fade>
	);
}

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import { isEmpty as lodashIsEmpty, sortBy as lodashSortBy } from "lodash";
import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { SchemaRunEASLSingleStudySetup } from "../../../common/schemas/ProcessStudiesSchemas/RunEASLSchema";
import { YupValidate } from "../../../common/utils/formFunctions";
import { AtomicFilepathTreeView } from "../../../components/AtomicComponents";
import { RHFFilepathInput } from "../../../components/RHFComponents";
import { FabDialogWrapper } from "../../../components/WrapperComponents";
import HelpProcessStudies__PrepareAReRun from "../../../pages/Help/HelpProcessStudies__PrepareAReRun";
import { atomStudyRootPathsByAllStudies, atomStudyStatusByAllStudies } from "../../../stores/ProcessStudiesStore";
import {
	atomReRunStudiesSelectedNodes,
	atomReRunStudiesTree,
	ReRunStudiesChannelBaseName,
} from "../../../stores/ReRunStudiesStore";
import { DeletingInProgressBackdrop } from "./DeletingInProgressBackdrop";

function SubmoduleReRunAStudy() {
	const { api } = window;

	// Path State
	const [studyPathToReRun, setStudyPathToReRun] = useState("");
	const [isValid, setIsValid] = useState(false);
	const currentStudyPaths = useAtomValue(atomStudyRootPathsByAllStudies);
	const currentStatuses = useAtomValue(atomStudyStatusByAllStudies);
	const selectedNodes = useAtomValue(atomReRunStudiesSelectedNodes);

	// Deleting State
	const [isDeleting, setIsDeleting] = useState(false);

	// Form State
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
		setIsDeleting(true);

		// First arrange the nodes such that the highest level nodes are deleted first
		const reorderedNodes = lodashSortBy(selectedNodes, (node) => node.filepath.path.split("/").length);
		for (const node of reorderedNodes) {
			try {
				// Don't try to delete a path that doesn't exist
				if (!(await api.path.filepathExists(node.filepath.path))) continue;

				// Otherwise, delete the path
				await api.path.deleteFilepath(node.filepath.path);
			} catch (error) {
				// On Windows, the path may be locked by another process, so we can't delete it. This is a known issue with
				// nodejs on windows, so we just log the error and move on. Migration to tauri might fix this...
				console.error(`Failed to delete ${node.filepath.path}. Reason given:`, error);
			}
		}
		setIsDeleting(false);
	};

	const renderFilePathTreeView = () => {
		if (isValid && studyPathToReRun) {
			return (
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
			);
		}
		return null;
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
				<RHFFilepathInput
					control={control}
					name="studyRootPath"
					label="Study Root Path"
					filepathType="dir"
					dialogOptions={{
						properties: ["openDirectory"],
					}}
					helperText='The root folder of the study. Expected to contain "derivatives/ExploreASL", "rawdata" and "sourcedata" subfolders'
				/>
			</form>
			{renderFilePathTreeView()}
			<DeletingInProgressBackdrop isDeleting={isDeleting} />
		</Box>
	);
}

export default React.memo(SubmoduleReRunAStudy);

import { exec } from "child_process";
import { difference as lodashDiff, pickBy as lodashPickBy, sum as lodashSum, uniq as lodashUniq } from "lodash";
import Path from "pathlib-js";
import { CreateRuntimeError } from "../common/errors/runExploreASLErrors";
import { promisify } from "util";
import { DataParValuesType } from "../common/types/ExploreASLDataParTypes";
import { EASLWorkload } from "../common/types/ExploreASLTypes";
import { GUIMessageWithPayload } from "../common/types/GUIMessageTypes";
import { EASLType } from "../common/types/ImportSchemaTypes";
import { RunEASLStudySetupType } from "../common/types/ProcessStudiesTypes";
import { Regex } from "../common/utils/Regex";
import { REGEXSTATUSFULE } from "../common/GLOBALS";
export const asyncExec = promisify(exec);

/**
 * Gets the givens of the ExploreASL version.
 * **This is the backend version of the function. Do not use in frontend code.**
 * @param EASLPath The path to the ExploreASL directory.
 * @returns Ascertains the path to the ExploreASL version file as we all the MajorMinor combined number.
 */
export async function getExploreASLVersion(EASLPath: string): Promise<{
	EASLVersionPath: Path | null;
	EASLVersionNumber: number | null;
}> {
	const EASLVersionRegex = new Regex("VERSION_(?<Major>\\d+)\\.(?<Minor>\\d+)\\.(?<Patch>\\d+)", "m");
	const EASLVersionPath = (await new Path(EASLPath).glob("VERSION_*", { onlyFiles: true }))[0];
	if (!EASLVersionPath) return { EASLVersionPath: null, EASLVersionNumber: null };

	const EASLVersionMatch = EASLVersionRegex.search(EASLVersionPath.basename);
	if (!EASLVersionMatch) return { EASLVersionPath, EASLVersionNumber: null };

	const { Major, Minor } = EASLVersionMatch.groupsObject;
	const EASLVersionNumber = parseInt(`${Major}${Minor}`, 10);
	return { EASLVersionPath, EASLVersionNumber };
}

/**
 * Ascertains the matlab executable filepath and version of the program and returns them.
 * Note that if multiple matlab versions are detected, it will proceed with the first glob result...
 * @returns An Object with properties:
 * - `matlabPath`: The path to the matlab executable
 * - `matlabVersion`: The version of the matlab executable
 * - `matlabIsOnPath`: Whether the matlab executable is on the system PATH variable
 * - `message`: A message to display to the user, usually in case of an
 */
export async function getMATLABPathAndVersion(): Promise<{
	matlabPath: string | null;
	matlabVersion: number | null;
	matlabIsOnPath: boolean;
	message: string;
}> {
	const whichCommand = process.platform === "win32" ? "where" : "which";
	const matlabVerRegex = new Regex("R(?<VERSIONNUMBER>\\d{4})[ab]");
	let matlabVersion: number | null = null;
	let matlabPath: string | null = null;
	let matlabIsOnPath = false;

	try {
		const { stdout } = await asyncExec(`${whichCommand} matlab`, { windowsHide: true });
		matlabPath = stdout.trim();
		matlabIsOnPath = true;
		const match = matlabVerRegex.search(matlabPath);
		if (match) {
			/**
			 * Case: MATLAB is on PATH and the version is clearly specified in the path
			 */
			matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
			console.log(`MATLAB was found on PATH @ ${matlabPath} with version ${matlabVersion}`);
			return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
		} else {
			/**
			 * Case: MATLAB is on PATH but the version is not clearly specified in the path; we can determine the version
			 * by running MATLAB itself
			 */
			console.log(
				`MATLAB was found on PATH @ ${matlabPath} but the version is not clear; attempting to determine version`
			);
			try {
				const { stdout } = await asyncExec(`matlab -nosplash -nodesktop -batch "disp(version)"`, { windowsHide: true });
				const matlabRawVersionString = stdout.trim();
				const match = matlabVerRegex.search(matlabRawVersionString);
				if (match) {
					matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
				}
				console.log(`MATLAB version ${matlabVersion} was determined`);
				return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
			} catch (error) {
				try {
					// Might have failed because the version doesn't use the -batch flag; try again with -r flag
					console.log(
						`MATLAB version could not be determined using -batch`,
						`...trying again with -r flag in case this is an older MATLAB`
					);
					const { stdout } = await asyncExec(`matlab -nosplash -nodesktop -r "disp(version)"`, { windowsHide: true });
					const matlabRawVersionString = stdout.trim();
					const match = matlabVerRegex.search(matlabRawVersionString);
					if (match) {
						matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
						console.log(`MATLAB version ${matlabVersion} was determined`);
						return {
							matlabPath,
							matlabVersion,
							matlabIsOnPath,
							message: `Successfully found matlab path and version.`,
						};
					}
					return {
						matlabPath,
						matlabVersion,
						matlabIsOnPath,
						message: `MATLAB path was found to be ${matlabPath} but the version could not be determined.`,
					};
				} catch (error) {
					// Out of options...return empty-handed
					console.log(`MATLAB version could not be determined even though it was on PATH`);
					return {
						matlabPath,
						matlabVersion,
						matlabIsOnPath,
						message: `MATLAB path was found to be ${matlabPath} but the version could not be determined.`,
					};
				}
			}
		}
	} catch (error) {
		console.log("Could not find MATLAB on PATH. Attempting backup methods...");
		matlabIsOnPath = false;
		/**
		 * Case: MATLAB is not on PATH
		 */
		// On MacOS, check Applications as the installation is typically /Applications/MATLAB_R20XXx.app/bin/matlab
		if (process.platform === "darwin") {
			const applicationsPath = new Path("/Applications");
			if (!(await applicationsPath.exists()))
				return {
					matlabPath,
					matlabVersion,
					matlabIsOnPath,
					message: `No MATLAB path found and could not search in the Applications folder as it did not exist`,
				};

			console.log(`Looking for MATLAB in ${applicationsPath.path}...`);
			try {
				for await (const matlabCandidatePath of applicationsPath.globIter("MATLAB*/bin/matlab", { onlyFiles: true })) {
					const match = matlabVerRegex.search(matlabCandidatePath.path);
					if (!match) continue;
					matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
					matlabPath = matlabCandidatePath.path;
					matlabIsOnPath = false;
					console.log(`MATLAB was found @ ${matlabPath} with version ${matlabVersion}`);
					return {
						matlabPath,
						matlabVersion,
						matlabIsOnPath,
						message: `Successfully found matlab path and version in Applications.`,
					};
				}
			} catch (error) {
				if (error.code === "EACCESS" || error.code === "EPERM") {
					return {
						matlabPath,
						matlabVersion,
						matlabIsOnPath,
						message: `Could not locate MATLAB as this application was not granted permission to search for it in Applications`,
					};
				}
			}
			return {
				matlabPath,
				matlabVersion,
				matlabIsOnPath,
				message: `No MATLAB path found in Applications`,
			}; // End of MacOS case
		} else if (process.platform === "win32") {
			// On Windows, we can check Program Files as the installation is typically C:\Program Files\MATLAB\R20XXx\bin\matlab.exe
			const programFilesPath = new Path("C:/Program Files");
			if (!(await programFilesPath.exists()))
				return {
					matlabPath,
					matlabVersion,
					matlabIsOnPath,
					message: `Could not find MATLAB as search location Program Files doesn't exist on this Windows operating system`,
				};
			console.log(`Looking for MATLAB in ${programFilesPath.path}...`);

			try {
				for await (const matlabCandidatePath of programFilesPath.globIter("MATLAB/**/bin/matlab.exe", {
					onlyFiles: true,
				})) {
					const match = matlabVerRegex.search(matlabCandidatePath.path);
					if (!match) continue;
					matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
					matlabPath = matlabCandidatePath.path;
					matlabIsOnPath = false;
					console.log(`MATLAB was found @ ${matlabPath} with version ${matlabVersion}`);
					return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
				}
			} catch (error) {
				// Passthrough silently since Program Files (x86) is a backup and the proper EACCESS error will be captured there
			}

			// Otherwise, check Program Files (x86) as the installation is typically C:\Program Files (x86)\MATLAB\R20XXx\bin\matlab.exe
			const programFilesX86Path = new Path("C:/Program Files (x86)");
			console.log(`Looking for MATLAB in ${programFilesX86Path.path}...`);
			if (!(await programFilesX86Path.exists()))
				return {
					matlabPath,
					matlabVersion,
					matlabIsOnPath,
					message: `Could not find MATLAB as search location Program Files (x86) doesn't exist on this Windows operating system`,
				};
			try {
				for await (const matlabCandidatePath of programFilesX86Path.globIter("MATLAB/**/bin/matlab.exe", {
					onlyFiles: true,
				})) {
					const match = matlabVerRegex.search(matlabCandidatePath.path);
					if (!match) continue;
					matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
					matlabPath = matlabCandidatePath.path;
					matlabIsOnPath = false;
					console.log(`MATLAB was found @ ${matlabPath} with version ${matlabVersion}`);
					return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
				}
			} catch (error) {
				if (error.code === "EACCESS" || error.code === "EPERM") {
					return {
						matlabPath,
						matlabVersion,
						matlabIsOnPath,
						message: `Could not locate MATLAB as this application was not granted permission to search for it`,
					};
				}
			}
			return {
				matlabPath,
				matlabVersion,
				matlabIsOnPath,
				message: `No MATLAB path found in Program Files (x86) or Program Files`,
			}; // End of Windows case
		} else {
			// On Linux, we can first try /usr/local as the installation is typically /usr/local/MATLAB/R20XXx/bin/matlab
			const usrLocalPath = new Path("/usr/local");
			if (!(await usrLocalPath.exists()))
				return {
					matlabPath,
					matlabVersion,
					matlabIsOnPath,
					message: `Could not find MATLAB as search location /usr/local doesn't exist on this Linux operating system`,
				};
			console.log(`Looking for MATLAB in ${usrLocalPath.path}...`);
			try {
				for await (const matlabCandidatePath of usrLocalPath.globIter("MATLAB*/**/bin/matlab", { onlyFiles: true })) {
					const match = matlabVerRegex.search(matlabCandidatePath.path);
					if (!match) continue;
					matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
					matlabPath = matlabCandidatePath.path;
					matlabIsOnPath = false;
					return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
				}
			} catch (error) {
				// Passthrough silently since /home/<username> is a backup and the proper EACCESS error will be captured there
			}

			// Sometimes MATLAB can't be installed in /usr/local, so we can try /home/<username>/
			const homePath = Path.home();
			if (!(await homePath.exists()))
				return {
					matlabPath,
					matlabVersion,
					matlabIsOnPath,
					message: `Could not find MATLAB as search location /home/<username> doesn't exist on this Linux operating system`,
				};
			console.log(`Looking for MATLAB in ${homePath.path}...`);
			try {
				for await (const matlabCandidatePath of homePath.globIter("**/bin/matlab", { onlyFiles: true })) {
					const match = matlabVerRegex.search(matlabCandidatePath.path);
					if (!match) continue;
					matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
					matlabPath = matlabCandidatePath.path;
					matlabIsOnPath = false;
					return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
				}
			} catch (error) {
				if (error.code === "EACCESS" || error.code === "EPERM") {
					return {
						matlabPath,
						matlabVersion,
						matlabIsOnPath,
						message: `Could not locate MATLAB as this application was not granted permission to search for it in /home/<username>`,
					};
				}
			}
			return {
				matlabPath,
				matlabVersion,
				matlabIsOnPath,
				message: `No MATLAB path found in /home/<username> or /usr/local`,
			};
		} // End of else case (Linux)
	} // End of try/catch with matlab not being on PATH
}

/**
 * Creates a NodeJS environment for the ExploreASL module to be run in.
 * @param EASLType The type of ExploreASL exectuable to run. Either "GitHub" or "Compiled"
 * @param EASLPath The path to the ExploreASL executable's main folder.
 * @param MATLABRuntimePath The path to the MATLAB Runtime folder (i.e. v96).
 * @returns The NodeJS Environment object to be put into `spawns` env variable.
 */
export async function createRuntimeEnvironment(
	EASLType: EASLType,
	EASLPath: string,
	MATLABRuntimePath: string
): Promise<NodeJS.ProcessEnv | CreateRuntimeError> {
	if (EASLType === "Github") return { ...process.env, MATLABPATH: EASLPath };

	const allEnvMappings = {
		win32: {
			varname: "PATH",
			delimiter: ";",
			globItem: "win64",
		},
		linux: {
			varname: "LD_LIBRARY_PATH",
			delimiter: ":",
			globItem: "glnxa64",
		},
		darwin: {
			varname: "DYLD_LIBRARY_PATH",
			delimiter: ":",
			globItem: "maci64",
		},
	};

	const currentEnvMapping = allEnvMappings[process.platform as keyof typeof allEnvMappings];
	const currentPATH = currentEnvMapping.varname in process.env ? process.env[currentEnvMapping.varname] : "";

	try {
		const runtimePaths = await new Path(MATLABRuntimePath).glob(`**/${currentEnvMapping.globItem}`, {
			onlyDirectories: true,
		});
		if (runtimePaths.length === 0)
			return new CreateRuntimeError(
				`Could not locate the expected executables for your operating system's MATLAB Runtime: ${currentEnvMapping.globItem}`
			);
		const updatedPaths = currentPATH
			? currentPATH + currentEnvMapping.delimiter + runtimePaths.map((p) => p.path).join(currentEnvMapping.delimiter)
			: runtimePaths.map((p) => p.path).join(currentEnvMapping.delimiter);
		return { ...process.env, [currentEnvMapping.varname]: updatedPaths };
	} catch (error) {
		return new CreateRuntimeError(
			`Could not locate the expected executables for your operating system's MATLAB Runtime due to permission issues. Please ensure that your MATLAB Runtime is installed in an accessible location.`
		);
	}
}

interface GlobMapping {
	GlobASL: string;
	GlobFLAIR: string;
	GlobM0: string;
}

async function getSubjectImagetypes(path: Path, globMapping: GlobMapping) {
	return {
		hasFLAIR: !!(await path.globIter(globMapping.GlobFLAIR, { onlyFiles: true }).next()).value,
		hasM0: !!(await path.globIter(globMapping.GlobM0, { onlyFiles: true }).next()).value,
		hasASL: !!(await path.globIter(globMapping.GlobASL, { onlyFiles: true }).next()).value,
	};
}

async function calculateStructuralWorkload(dataPar: DataParValuesType, workloadSubset: EASLWorkload) {
	const subjectRegexp = new RegExp(dataPar.x.dataset.subjectRegexp);
	const exclusionRegex = new Regex(`(?<SUBJECT>.*?)(?:_\\d+)?$`);
	const excludedSubjects = new Set(
		dataPar.x.dataset.exclusion
			.map((s) => {
				// Remove trailing "_#"
				const match = exclusionRegex.search(s);
				return match ? match.groupsObject.SUBJECT : null;
			})
			.filter((v) => v)
	);
	console.log(`Excluded subjects: ${Array.from(excludedSubjects).join(", ")}`);

	const defaultFolders = new Set(["Population", "log", "lock", "Logs"]);
	const pathRawData = new Path(dataPar.x.GUI.StudyRootPath, "rawdata");
	const globMapping: GlobMapping = { GlobASL: "*/*_asl.nii*", GlobM0: "*/*_m0scan.nii", GlobFLAIR: "*FLAIR*.nii*" };
	const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");

	let DARTELCounter = 0; // Used to keep track of subjects that aren't filtered out

	const structuralWorkload = {
		anticipatedFilepaths: [] as string[],
		anticipatedWorkload: [] as number[],
	};

	for await (const subjectPath of pathRawData.readDirIter()) {
		console.log("Checking subject:", subjectPath.path);

		// Skip non-indicated subjects, excluded subjects, default folders, and non-directories
		if (
			!subjectRegexp.test(subjectPath.basename) ||
			excludedSubjects.has(subjectPath.basename) ||
			defaultFolders.has(subjectPath.basename) ||
			!(await subjectPath.isDirectory())
		) {
			console.log("Skipping subject:", subjectPath.path);
			continue;
		}

		// console.log(`${subjectPath.path} is a subject to check`);

		// Behavior differs based on whether there are visits or not
		const visitPaths = await subjectPath.glob("ses-*", { onlyDirectories: true });
		console.log(`${subjectPath.path} has ${visitPaths.length} visits`);

		// ^ If there are no visits, the expected rawdata folder structure is along the lines of:
		//   - subject
		//   |- anat
		//      |- T1.nii.gz
		//   |- perf
		//      |- ASL.nii.gz
		if (visitPaths.length === 0) {
			// Skip based on dataPar settings
			const { hasFLAIR, hasM0, hasASL } = await getSubjectImagetypes(subjectPath, globMapping);
			if (
				(!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) ||
				(!hasM0 && dataPar.x.settings.SkipIfNoM0) ||
				(!hasASL && dataPar.x.settings.SkipIfNoASL)
			) {
				continue;
			}

			// Add to DARTEL counter
			DARTELCounter++;

			// Get the path of the directory that will hold the .status files; creating it if necessary
			const lockDirPath = new Path(
				pathDerivativesEASL.path,
				"lock",
				"xASL_module_Structural",
				`${subjectPath.basename}_1`,
				"xASL_module_Structural"
			);
			if (!(await lockDirPath.exists())) {
				await lockDirPath.makeDir();
			}

			// Determine the expected .status files from the version's workload
			const filterSet = new Set(["Structural"]);
			if (hasFLAIR) filterSet.add("Structural_FLAIR");
			const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => filterSet.has(v.module));

			// Determine the workload based on the .status files not already existing
			const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
			for (let index = 0; index < workloadMappingEntires.length; index++) {
				const [statusBasename, info] = workloadMappingEntires[index];
				const statusFilepath = new Path(lockDirPath.path, statusBasename);
				if (await statusFilepath.exists()) continue;
				// console.log(
				//   `${statusFilepath.path} has not been created...adding to anticipated workload and loadingBarValue of ${info.loadingBarValue}`
				// );
				structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
				structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
			}
		} // End of: if (visitPaths.length === 0)
		// ^ Otherwise, there are visits, and we must iterate over them
		//   - subject
		//   |- ses-1
		//       |- anat
		//          |- T1.nii.gz
		//       |- perf
		//          |- ASL.nii.gz
		//   |- ses-2
		//       |- anat
		//          |- T1.nii.gz
		//       |- perf
		//          |- ASL.nii.gz
		else {
			for (let visitIndex = 0; visitIndex < visitPaths.length; visitIndex++) {
				const visitPath = visitPaths[visitIndex];

				// Skip based on dataPar settings
				const { hasFLAIR, hasM0, hasASL } = await getSubjectImagetypes(visitPath, globMapping);
				if (
					(!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) ||
					(!hasM0 && dataPar.x.settings.SkipIfNoM0) ||
					(!hasASL && dataPar.x.settings.SkipIfNoASL)
				) {
					continue;
				}

				// Add to DARTEL counter
				DARTELCounter++;

				// Get the path of the directory that will hold the structural module .status files; creating it if necessary
				const lockDirPath = new Path(
					pathDerivativesEASL.path,
					"lock",
					"xASL_module_Structural",
					`${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
					"xASL_module_Structural"
				);
				// console.log(`Making lock dir: ${lockDirPath.path}`);
				if (!(await lockDirPath.exists())) {
					await lockDirPath.makeDir();
				}

				// If necessary, do the same for the Longitudinal Registration module
				if (dataPar.x.modules.bRunLongReg && visitPaths.length > 1) {
					const lockDirPath = new Path(
						pathDerivativesEASL.path,
						"lock",
						"xASL_module_LongReg",
						`${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
						"xASL_module_LongReg"
					);
					if (!(await lockDirPath.exists())) {
						await lockDirPath.makeDir();
					}
				}

				// Determine the expected .status files from the version's workload
				const filterSet = new Set(["Structural"]);
				if (hasFLAIR) filterSet.add("Structural_FLAIR");
				if (dataPar.x.modules.bRunLongReg && visitIndex === 0) filterSet.add("LongReg"); // Only the first visit gets the LongReg status files
				const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => filterSet.has(v.module));

				// Determine the workload based on the .status files not already existing
				for (const [statusBasename, info] of Object.entries(filteredWorkloadMapping)) {
					const moduleName = info.module === "LongReg" ? "xASL_module_LongReg" : "xASL_module_Structural";
					const statusFilepath = new Path(
						pathDerivativesEASL.path,
						"lock",
						moduleName,
						`${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
						moduleName,
						statusBasename
					);
					if (await statusFilepath.exists()) continue;
					structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
					structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
				}
			}
		} // End of visits.length > 0
	} // End of for await (const subjectPath of pathRawData.readDirIter())

	// ^ DARTEL status files are expected if there is more than 1 subject (DARTELCounter > 1) and the appropriate dataPar
	// ^ settings are set
	console.log(
		`DARTELCounter: ${DARTELCounter}`,
		dataPar.x?.modules?.bRunDARTEL,
		dataPar.x?.modules?.structural?.bSegmentSPM12
	);

	if (DARTELCounter > 1 && (dataPar.x?.modules?.bRunDARTEL || dataPar.x?.modules?.structural?.bSegmentSPM12)) {
		const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_DARTEL", "xASL_module_DARTEL");
		if (!(await lockDirPath.exists())) {
			await lockDirPath.makeDir();
		}

		const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => v.module === "DARTEL");
		// Determine the workload based on the .status files not already existing
		const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
		for (let index = 0; index < workloadMappingEntires.length; index++) {
			const [statusBasename, info] = workloadMappingEntires[index];
			const statusFilepath = new Path(lockDirPath.path, statusBasename);
			if (await statusFilepath.exists()) continue;
			structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
			structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
		}
	}
	// console.log(`calculateStructuralWorkload -- Structural workload:`, JSON.stringify(structuralWorkload, null, 2));
	return structuralWorkload;
}

async function calculateASLWorkload(dataPar: DataParValuesType, workloadSubset: EASLWorkload) {
	const subjectRegexp = new RegExp(dataPar.x.dataset.subjectRegexp);
	const exclusionRegex = new Regex(`(?<SUBJECT>.*?)(?:_\\d+)?$`);
	const excludedSubjects = new Set(
		dataPar.x.dataset.exclusion
			.map((s) => {
				// Remove trailing "_#"
				const match = exclusionRegex.search(s);
				return match ? match.groupsObject.SUBJECT : null;
			})
			.filter((v) => v)
	);
	console.log(`Excluded subjects: ${Array.from(excludedSubjects).join(", ")}`);
	const defaultFolders = new Set(["Population", "log", "lock", "Logs"]);
	const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
	const pathRawData = new Path(dataPar.x.GUI.StudyRootPath, "rawdata");
	const globMapping: GlobMapping = { GlobASL: "*/*_asl.nii*", GlobM0: "*/*_m0scan.nii", GlobFLAIR: "*FLAIR*.nii*" };
	const regexMultiSession = new Regex("run-(?<SessionName>[\\w_]+)_asl\\.json");

	// Determine the expected .status files from the version's workload
	const filterSet = new Set(["ASL"]);
	const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => filterSet.has(v.module));
	const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
	// console.log(`calculateASLWorkload -- Filtered workload mapping: ${JSON.stringify(filteredWorkloadMapping, null, 2)}`);

	const aslWorkload = {
		anticipatedFilepaths: [] as string[],
		anticipatedWorkload: [] as number[],
	};

	for await (const subjectPath of pathRawData.readDirIter()) {
		// Skip non-indicated subjects, excluded subjects, default folders, and non-directories
		if (
			!subjectRegexp.test(subjectPath.basename) ||
			excludedSubjects.has(subjectPath.basename) ||
			defaultFolders.has(subjectPath.basename) ||
			!(await subjectPath.isDirectory())
		) {
			continue;
		}

		// console.log(`calculateASLWorkload -- Processing subject ${subjectPath.basename}`);

		// Skip based on dataPar settings
		const { hasFLAIR } = await getSubjectImagetypes(subjectPath, globMapping);
		// Skip based on dataPar settings
		if (!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) {
			continue;
		}

		// Behavior differs based on whether there are visits or not
		const visitPaths = await subjectPath.glob("ses-*", { onlyDirectories: true });

		/**
		 * ^ MAIN SCENARIO A: Single visit
		 * General rawdata folder structure:
		 *  - sub-<subject>
		 *     |- anat
		 *     |- perf
		 *          |- sub-<subject>_run-<session>_asl.nii.gz
		 *          OR
		 *          |- sub-<subject>_asl.nii.gz
		 */
		if (visitPaths.length === 0) {
			// console.log(
			//   `calculateASLWorkload -- Subject ${subjectPath.basename} has no explicit visits; assuming single visit`
			// );
			/**
			 * ^ Scenario A1: Multiple sessions with only one visit
			 * EXPECTED BASENAMES: sub-<subject>_run-<session>_asl.json
			 */
			const sessionPaths = await subjectPath.glob("perf/*_run-*_asl.json", { onlyFiles: true });
			/**
			 * ^ Scenario A2: Single session with only one visit
			 * EXPECTED BASENAMES: sub-<subject>_asl.json
			 */
			const isMultiSession = sessionPaths.length > 0;

			// console.log(`calculateASLWorkload -- Subject ${subjectPath.basename} isMultiSession: ${isMultiSession}`);

			if (!isMultiSession) {
				// console.log(
				//   `calculateASLWorkload -- Subject ${subjectPath.basename} has no _run-*_asl.json files. Checking for _asl.json`
				// );

				const singleSessionBasename = `${subjectPath.basename}_asl.json`;
				const singleSessionPath = subjectPath.resolve(`perf/${singleSessionBasename}`);

				// console.log(`calculateASLWorkload -- Adding sessionPath: ${singleSessionPath.path}`);

				if (!(await singleSessionPath.exists())) {
					// console.log(`Skipping subject ${subjectPath.basename} because no ASL data found`);
					continue;
				}
				sessionPaths.push(singleSessionPath); // convert to length-1 array in order to keep consistency
			}

			// console.log(
			//   `calculateASLWorkload -- Subject ${subjectPath.basename} sessionPaths`,
			//   JSON.stringify(sessionPaths, null, 2)
			// );

			// Now iterate over the sessions within each subject
			for await (const sessionFilepath of sessionPaths) {
				let sessionName: string;
				if (isMultiSession) {
					const sessionMatch = regexMultiSession.search(sessionFilepath.basename);
					if (!sessionMatch) {
						console.log(`calculateASLWorkload -- Could not match session name in ${sessionFilepath.basename}`);
						continue;
					}
					sessionName = `ASL_${sessionMatch.groupsObject.SessionName}`;
				} else {
					sessionName = "ASL_1"; // For single session, use a default session name of "ASL_1" from ExploreASL
				}

				// Get the path of the directory that will hold the .status files; creating it if necessary
				const lockDirPath = new Path(
					pathDerivativesEASL.path,
					"lock",
					"xASL_module_ASL",
					`${subjectPath.basename}_1`, // For a single default visit, append "_1"
					`xASL_module_ASL_${sessionName}`
				);
				if (!(await lockDirPath.exists())) {
					await lockDirPath.makeDir();
				}

				// console.log(`calculateASLWorkload -- Checking existing .status files in ${lockDirPath.path}`);

				// Determine the workload based on the .status files not already existing
				for (let index = 0; index < workloadMappingEntires.length; index++) {
					const [statusBasename, info] = workloadMappingEntires[index];
					const statusFilepath = new Path(lockDirPath.path, statusBasename);
					if (await statusFilepath.exists()) continue;
					aslWorkload.anticipatedFilepaths.push(statusFilepath.path);
					aslWorkload.anticipatedWorkload.push(info.loadingBarValue);
				}
			}
			/**
			 * ^ MAIN SCENARIO B: Multiple visits
			 * General rawdata folder structure:
			 *  - sub-<subject>
			 *      |- ses-<session>
			 *          |- anat
			 *          |- perf
			 *               |- sub-<subject>_ses-<visit>_run-<session>_asl.nii.gz
			 *               OR
			 *               |- sub-<subject>_ses-<visit>_asl.nii.gz
			 */
		} else {
			// console.log(`Subject ${subjectPath.basename} has ${visitPaths.length} visits`);
			for (let visitIndex = 0; visitIndex < visitPaths.length; visitIndex++) {
				const visitPath = visitPaths[visitIndex];
				// console.log(`Assessing visit ${visitPath.basename}`);
				/**
				 * ^ Scenario B1: Multiple sessions and multiple visits
				 * EXPECTED BASENAMES: sub-<subject>_ses-<visit>_run-<session>_asl.json
				 */
				const aslJSONGlobPattern = `perf/${subjectPath.basename}_${visitPath.basename}_run-*_asl.json`;
				let sessionPaths = await visitPath.glob(aslJSONGlobPattern, {
					onlyFiles: true,
				});
				/**
				 * ^ Scenario B2: Single session and multiple visits
				 * EXPECTED BASENAMES: sub-<subject>_ses-<visit>_asl.json
				 */
				const isMultiSession = sessionPaths.length > 0;
				if (!isMultiSession) {
					const singleSessionBasename = `${subjectPath.basename}_${visitPath.basename}_asl.json`;
					const singleSessionPath = visitPath.resolve(`perf/${singleSessionBasename}`);
					if (!(await singleSessionPath.exists())) {
						// console.log(
						//   `Could not find expected session file ${singleSessionBasename} for visit ${visitPath.basename}`
						// );
						continue;
					}
					sessionPaths = [singleSessionPath]; // convert to length-1 array in order to keep consistency
				}

				// console.log(`Sessions found for visit ${visitPath.basename}: ${sessionPaths.map(p => p.path)}`);
				// Now iterate over the sessions within each subject
				for await (const sessionFilepath of sessionPaths) {
					let sessionName: string;
					if (isMultiSession) {
						const sessionMatch = regexMultiSession.search(sessionFilepath.basename);
						if (!sessionMatch) {
							console.log(`calculateASLWorkload -- Could not match session name in ${sessionFilepath.basename}`);
							continue;
						}
						sessionName = `ASL_${sessionMatch.groupsObject.SessionName}`;
					} else {
						sessionName = "ASL_1"; // For single session, use a default session name of "ASL_1" from ExploreASL
					}

					// Get the path of the directory that will hold the .status files; creating it if necessary
					const lockDirPath = new Path(
						pathDerivativesEASL.path,
						"lock",
						"xASL_module_ASL",
						`${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
						`xASL_module_ASL_${sessionName}`
					);
					if (!(await lockDirPath.exists())) {
						await lockDirPath.makeDir();
					}

					// Determine the workload based on the .status files not already existing
					for (let index = 0; index < workloadMappingEntires.length; index++) {
						const [statusBasename, info] = workloadMappingEntires[index];
						const statusFilepath = new Path(lockDirPath.path, statusBasename);
						if (await statusFilepath.exists()) continue;
						// console.log(`calculateASLWorkload -- Adding ${statusFilepath.path} to workload`);
						aslWorkload.anticipatedFilepaths.push(statusFilepath.path);
						aslWorkload.anticipatedWorkload.push(info.loadingBarValue);
					}
				}
			}
		}
	}
	return aslWorkload;
}

async function calculatePopulationWorkload(dataPar: DataParValuesType, workloadSubset: EASLWorkload) {
	const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
	const populationWorkload = {
		anticipatedFilepaths: [] as string[],
		anticipatedWorkload: [] as number[],
	};

	// Get the path of the directory that will hold the .status files; creating it if necessary
	const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_Population", "xASL_module_Population");
	if (!(await lockDirPath.exists())) {
		await lockDirPath.makeDir();
	}

	// Determine the expected .status files from the version's workload
	const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => v.module === "Population");

	// Determine the workload based on the .status files not already existing
	const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
	for (let index = 0; index < workloadMappingEntires.length; index++) {
		const [statusBasename, info] = workloadMappingEntires[index];
		const statusFilepath = new Path(lockDirPath.path, statusBasename);
		if (await statusFilepath.exists()) continue;
		populationWorkload.anticipatedFilepaths.push(statusFilepath.path);
		populationWorkload.anticipatedWorkload.push(info.loadingBarValue);
	}
	return populationWorkload;
}

export async function calculateWorkload(
	dataPar: DataParValuesType,
	studySetup: Omit<RunEASLStudySetupType, "currentStatus">,
	workloadMapping: EASLWorkload
): Promise<
	GUIMessageWithPayload<{
		anticipatedFilepaths: string[];
		anticipatedWorkload: number;
	}>
> {
	let payload = {
		anticipatedFilepaths: [] as string[],
		anticipatedWorkload: 0,
	};

	// Calculate accordingly
	/************
	 * Structural
	 ***********/
	if (studySetup.whichModulesToRun === "Structural") {
		try {
			const { anticipatedWorkload: structuralWorkload, anticipatedFilepaths: structuralPaths } =
				await calculateStructuralWorkload(dataPar, workloadMapping);
			payload = {
				anticipatedFilepaths: structuralPaths,
				anticipatedWorkload: lodashSum(structuralWorkload),
			};
		} catch (error) {
			return {
				GUIMessage: {
					title: "Failure to calculate the Structural Module Workload",
					messages: [
						"Something went wrong when trying to calculate the Structural Module Workload",
						`Nature of the error: ${error}`,
					],
					severity: "error",
				},
				payload: payload,
			};
		}
		/*****
		 * ASL
		 ****/
	} else if (studySetup.whichModulesToRun === "ASL") {
		try {
			const { anticipatedWorkload: aslWorkload, anticipatedFilepaths: aslPaths } = await calculateASLWorkload(
				dataPar,
				workloadMapping
			);
			payload = {
				anticipatedFilepaths: aslPaths,
				anticipatedWorkload: lodashSum(aslWorkload),
			};
		} catch (error) {
			return {
				GUIMessage: {
					title: "Failure to calculate the ASL Module Workload",
					messages: [
						"Something went wrong when trying to calculate the ASL Module Workload",
						`Nature of the error: ${error}`,
					],
					severity: "error",
				},
				payload: payload,
			};
		}
		/******
		 * Both
		 * ***/
	} else if (studySetup.whichModulesToRun === "Both") {
		// eslint-disable-next-line
		const [strucResult, aslResult] = await Promise.all([
			calculateStructuralWorkload(dataPar, workloadMapping),
			calculateASLWorkload(dataPar, workloadMapping),
		]);
		payload = {
			anticipatedFilepaths: [...strucResult.anticipatedFilepaths, ...aslResult.anticipatedFilepaths],
			anticipatedWorkload: lodashSum([...strucResult.anticipatedWorkload, ...aslResult.anticipatedWorkload]),
		};
		/************
		 * Population
		 ***********/
	} else if (studySetup.whichModulesToRun === "Population") {
		try {
			const { anticipatedWorkload: popWorkload, anticipatedFilepaths: popPaths } = await calculatePopulationWorkload(
				dataPar,
				workloadMapping
			);
			payload = {
				anticipatedFilepaths: popPaths,
				anticipatedWorkload: lodashSum(popWorkload),
			};
		} catch (error) {
			return {
				GUIMessage: {
					title: "Failure to calculate the Population Module Workload",
					messages: [
						"Something went wrong when trying to calculate the Population Module Workload",
						`Nature of the error: ${error}`,
					],
					severity: "error",
				},
				payload: payload,
			};
		}
		/*********************
		 * Impossible scenario
		 ********************/
	} else {
		throw new Error(`Impossible studySetup whichModuleToRun provided: ${studySetup.whichModulesToRun}`);
	}

	// console.log(`calculateWorkload -- payload.anticipatedWorkload: `, payload.anticipatedWorkload);
	// console.log(`calculateWorkload -- payload.anticipatedFilepaths: `, payload.anticipatedFilepaths);
	// console.log(`calculateWorkload -- payload.anticipatedFilepaths.length: `, payload.anticipatedFilepaths.length);

	if (payload.anticipatedFilepaths.length === 0) {
		return {
			GUIMessage: {
				title: "Study Already Ran",
				messages: [
					"All anticipated analysis steps already completed for this study.",
					`If you meant to re-run the study, please see the "Re-Run A Study" tab in this module`,
					`Alternatively, did you mean to select a different module than your current selection: ${studySetup.whichModulesToRun}`,
				],
				severity: "info",
			},
			payload: payload,
		};
	} else {
		return {
			GUIMessage: {
				title: "Calculated Anticipated Workload",
				messages: [`Anticipating the creation of ${payload.anticipatedFilepaths.length} ".status" files`],
				severity: "success",
			},
			payload: payload,
		};
	}
}

/**
 * Prepares the messages to be displayed in the GUI regarding possibly missed .status files
 * @param StudyDerivExploreASLDir The derivatives/ExploreASL directory as a Path instance.
 * @param setOfAnticipatedFilepaths A set of filepaths that are anticipated to be created.
 * @param workloadMapping The workloadMapping for this study.
 * @returns An object with properties:
 * - missedStatusFiles: The filepaths that were anticipated but were not created.
 * - missedStepsMessages: The messages to display to the user for the missed steps.
 */
export async function getExploreASLExitSummary(
	StudyDerivExploreASLDir: Path,
	setOfAnticipatedFilepaths: Set<string>,
	workloadMapping: EASLWorkload
): Promise<{ missedStatusFiles: string[]; missedStepsMessages: string[] }> {
	const allStatusFiles = await StudyDerivExploreASLDir.resolve("lock").glob("**/*.status", {
		onlyFiles: true,
		onlyDirectories: false,
	});
	const missedStatusFiles = lodashDiff(
		Array.from(setOfAnticipatedFilepaths),
		lodashUniq(allStatusFiles.map((p) => p.path))
	);
	// Early exit if all is in order
	if (missedStatusFiles.length === 0) return { missedStatusFiles, missedStepsMessages: [] };

	const missedStepsMessages: string[] = [];

	const seenItems = new Set<string>();
	for (const statusFP of missedStatusFiles) {
		const match = REGEXSTATUSFULE.search(statusFP);
		if (!match) continue;
		const { Module, Subject, Session, StatusBasename } = match.groupsObject;
		if (!(StatusBasename in workloadMapping)) continue;

		// Population module is a special case, prompting an early return
		if (Module === "Population" || Module === "DARTEL_T1") {
			missedStepsMessages.push(
				`Module: ${Module} ...failed at earliest step: ${workloadMapping[StatusBasename].description}`
			);
			return { missedStatusFiles, missedStepsMessages };
		}

		if (seenItems.has(`${Subject}${Session}`) || !(StatusBasename in workloadMapping)) continue;

		const item = Session
			? `Module: ${Module}, Subject/Visit: ${Subject}, Session: ${Session}`
			: `Module: ${Module}, Subject/Visit: ${Subject}`;
		const description = `...failed at earliest step: ${workloadMapping[StatusBasename].description}`;
		const message = `${item} ${description}`;
		missedStepsMessages.push(message);
		seenItems.add(`${Subject}${Session}`);
	}

	return { missedStatusFiles, missedStepsMessages };
}

/**
 * Removes lock directories associated with subjects that are anticipated to be run
 * @param BIDS2LegacyLockDir The directory containing the BIDS2Legacy lock files.
 * @param anticipatedFilepaths An array of string filepaths of the .status files that are anticipated to be created.
 * @returns void
 */
export async function RemoveBIDS2LegacyLockDirs(BIDS2LegacyLockDir: Path, anticipatedFilepaths: string[]) {
	return await Promise.all(
		anticipatedFilepaths.map(async (filepath) => {
			try {
				const match = REGEXSTATUSFULE.search(filepath);
				if (!match) return;
				const { Subject } = match.groupsObject;
				if (!Subject) return; // Population Module returns an empty string

				// Skip if the subject is not in the BIDS2LegacyLockDir
				const BIDS2LegacySubjectLockDir = BIDS2LegacyLockDir.resolve(Subject);
				if (!(await BIDS2LegacySubjectLockDir.exists())) return;
				await BIDS2LegacySubjectLockDir.remove();
			} catch (error) {
				console.warn(`Failed to remove ${filepath}. Reason: ${error}`);
				return;
			}
		})
	);
}

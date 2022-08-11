import { FieldValues } from "react-hook-form";
import { TestContext } from "yup";
import { SUPPORTEDMATLABRUNTIMEVERSIONS } from "../GLOBALS";
import { EASLWorkloadMapping } from "../schemas/ExploreASLWorkloads";
import { DataParValuesType } from "../types/ExploreASLDataParTypes";
import { EASLType } from "../types/ImportSchemaTypes";
const { api } = window;

/**
 * Function for determining whether a filepath for an ExploreASL directory is valid.
 * @param filepath The filepath to the ExploreASL directory.
 * @param easlType The type of EASL to be checked. Either "Github" or "Compiled".
 * @param helpers Helper context & functions provided by Yup.
 * @returns A boolean or a Yup.ValidationError.
 */
export async function IsValidEASLPath<TContext extends FieldValues = FieldValues>(
  filepath: string,
  easlType: EASLType,
  helpers: TestContext<TContext>
) {
  // Filepath must be a valid string
  if (!filepath || typeof filepath !== "string") return false;
  const filePathType = await api.path.getFilepathType(filepath);

  // Filepath must be a directory
  if (filePathType !== "dir") return false;
  const [versionFile] = await api.path.glob(filepath, "VERSION_*", { onlyFiles: true, onlyDirectories: false });

  // Version file must exist and be in the current accepted mappings
  if (!versionFile) {
    return helpers.createError({ path: helpers.path, message: "Could not locate an ExploreASL Version File" });
  }
  if (!(versionFile.basename in EASLWorkloadMapping)) {
    return helpers.createError({
      path: helpers.path,
      message: `This GUI does not support ExploreASL version: ${versionFile.basename}`,
    });
  }

  // There must be an executable file in the directory
  const expectedBasename =
    easlType === "Compiled" ? (api.platform === "win32" ? "xASL_latest.exe" : "run_xASL_latest.sh") : "ExploreASL.m";
  const hasExecutable = !!(await api.path.containsImmediateChild(filepath, expectedBasename));
  if (!hasExecutable) {
    return helpers.createError({
      path: helpers.path,
      message: `This folder was expected to contain a "${expectedBasename}" file.`,
    });
  }

  // Filepath is valid
  return true;
}

/**
 * Function for detemrining whether a filepath for a MATLAB Runtime is valid for this GUI.
 * @param filepath The filepath to the proposed MATLAB Runtime directory.
 * @param helpers Helper context & functions provided by Yup.
 * @returns A boolean or a Yup.ValidationError.
 */
export async function IsValidMATLABRuntimePath(filepath: string, helpers: TestContext) {
  // Filepath must be a valid string
  if (!filepath || typeof filepath !== "string") return false;
  const filePathType = await api.path.getFilepathType(filepath);

  // Filepath must be a directory
  if (filePathType !== "dir") return false;

  // Must contain a valid MATLAB Runtime version
  const asPath = api.path.asPath(filepath);
  if (!/^v\d{2,3}$/.test(asPath.basename)) {
    return helpers.createError({
      path: helpers.path,
      message: "Not a MATLAB Runtime folder. A MATLAB runtime folder has the format v9# (i.e. v97)",
    });
  }

  // The version must be supported by this GUI
  if (!SUPPORTEDMATLABRUNTIMEVERSIONS.includes(asPath.basename)) {
    return helpers.createError({
      path: helpers.path,
      message: "The MATLAB Runtime must be at least v96 (R2019a)",
    });
  }

  // Filepath is valid
  return true;
}

/**
 * Function for determining whether a filepath is valid for being a study root directory.
 * @param filepath The filepath to be assessed
 * @param helpers Helper context & functions provided by Yup.
 * @param expectedChildren An array of expected child basenames.
 * @returns A boolean or a Yup.ValidationError.
 */
export async function IsValidStudyRoot(
  filepath: string,
  helpers: TestContext,
  expectedChildren: string[] = ["sourcedata"]
) {
  console.log("IsValidStudyRoot", filepath);
  // Filepath must be a valid string
  if (!filepath) return false;

  const filePathType = await api.path.getFilepathType(filepath);
  if (filePathType !== "dir") return false;

  const children = await api.path.containsChildren(filepath, expectedChildren);
  if (!children.every(child => Boolean(child))) {
    return helpers.createError({
      path: helpers.path,
      message: `This folder was expected to contain the following ${
        expectedChildren.length === 1 ? "folder" : "folders"
      }: ${expectedChildren.join(", ")}`,
    });
  }

  return true;
}

/**
 * Function for determining whether a series of basenames are valid for a given study root.
 * @param subjectBasenames An array of subject basenames.
 * @param helpers Helpers context & functions provided by Yup.
 * @returns A boolean or a Yup.ValidationError.
 */
export async function AreValidSubjects(subjectBasenames: string[], helpers: TestContext<DataParValuesType>) {
  if (!subjectBasenames || !Array.isArray(subjectBasenames) || !subjectBasenames.length) {
    return helpers.createError({
      path: helpers.path,
      message: "Invalid value provided for the listing of subjects",
    });
  }

  // Must first ascertain that
  const StudyRootPath: string | undefined = helpers.options.context.x.GUI.StudyRootPath;
  console.log(`AreValidSubjects: StudyRootPath: ${StudyRootPath}`);

  if (
    !StudyRootPath || // Cannot be falsy
    typeof StudyRootPath !== "string" || // Must be a string
    (await IsValidStudyRoot(StudyRootPath, helpers, ["sourcedata", "rawdata", "derivatives"])) !== true // Must be a valid study root
  ) {
    return helpers.createError({
      path: helpers.path,
      message: "Cannot validate the subjects because the Study Root Path itself is invalid",
    });
  }

  // Must all exist in rawdata
  const existenceChecks = await api.path.getFilepathsType(
    subjectBasenames.map(subjectBasename => `${StudyRootPath}/rawdata/${subjectBasename}`)
  );
  if (!existenceChecks.every(check => check === "dir")) {
    return helpers.createError({
      path: helpers.path,
      message: "One or more of the provided subjects do not exist in the rawdata folder",
    });
  }

  return true;
}

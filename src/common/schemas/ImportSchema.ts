import { uniq as lodashUniq } from "lodash";
import * as Yup from "yup";
import { ObjectShape } from "yup/lib/object";
import {
  ASLSequenceType,
  ASLSeriesPatternType,
  BolusCutOffTechniqueType,
  EASLType,
  ImportAliasesSchemaType,
  ImportContextSchemaType,
  ImportMultipleContextsSchemaType,
  ImportRuntimeEnvsSchemaType,
  ImportSchemaType,
  SourcedataFolderType,
} from "../types/ImportSchemaTypes";
import { IsValidEASLPath, IsValidMATLABRuntimePath, IsValidStudyRoot } from "../utilityFunctions/EASLFunctions";
const { api } = window;

type ObjectShapeValues = ObjectShape extends Record<string, infer V> ? V : never;
export type YupShape<T extends Record<any, any>> = Partial<Record<keyof T, ObjectShapeValues>>;

/**
 * Schema intended for the Import Module Step: Define Runtime Environments
 */
export const SchemaImportStepDefineRuntimeEnvs: Yup.SchemaOf<ImportRuntimeEnvsSchemaType> = Yup.object().shape({
  EASLType: Yup.mixed<EASLType>()
    .oneOf(["Github", "Compiled"], "Must be either a clone of the ExploreASL Github repository or a compiled version")
    .required("EASL Type is required"),
  EASLPath: Yup.string()
    .required("EASL Path is required")
    .when("EASLType", {
      is: "Github",
      then: Yup.string().test(
        "EASLPathValidGithub",
        "Invalid ExploreASL Path",
        async (filepath, helpers) => await IsValidEASLPath(filepath, "Github", helpers)
      ),
      // Compiled EASL case
      otherwise: Yup.string().test(
        "EASLPathValidCompiled",
        "Invalid ExploreASL Path",
        async (filepath, helpers) => await IsValidEASLPath(filepath, "Compiled", helpers)
      ),
    }),
  MATLABRuntimePath: Yup.string().when("EASLType", {
    is: "Github",
    then: Yup.string().optional(),
    otherwise: Yup.string()
      .required("MATLAB Runtime Path is required")
      .test(
        "MATLABRuntimePathValid",
        "Invalid MATLAB Runtime Path",
        async (filepath, helpers) => await IsValidMATLABRuntimePath(filepath, helpers)
      ),
  }),
  StudyRootPath: Yup.string()
    .required("Required")
    .test(
      "IsValidStudyRootPath",
      "Invalid Study Root Path",
      async (filepath, helpers) => await IsValidStudyRoot(filepath, helpers, ["sourcedata"])
    ),

  SourcedataStructure: Yup.array()
    .required("Required.")
    .test(
      "IsValidStructure",
      "Invalid sourcedata filepath structure",
      async (folderStruct: SourcedataFolderType[], helpers: Yup.TestContext<ImportSchemaType>) => {
        console.log("ImportSchema --- SourcedataStructure validation triggered: ", folderStruct);
        if (!folderStruct) return false;

        // Blank fields are not allowed
        if (folderStruct.some(folder => folder === ""))
          return helpers.createError({
            path: helpers.path,
            message: "Blank fields are not allowed",
          });

        // Must contain "Subject" and "Scan" at minimum
        if (!folderStruct.includes("Subject") || !folderStruct.includes("Scan"))
          return helpers.createError({
            path: helpers.path,
            message: "At minimum Subject and Scan must be filled in",
          });

        // Depends on the validity of the study root path
        const studyRootPath: string = helpers.parent.StudyRootPath;
        const isValid = await IsValidStudyRoot(studyRootPath, helpers, ["sourcedata"]);
        if (!isValid || isValid instanceof Yup.ValidationError)
          return helpers.createError({
            path: helpers.path,
            message: "Cannot determine the validity of the folder structure when the Study Root Path is invalid",
          });

        // Assuming a valid root path, check for existence of filepaths at the given depth
        const globPattern = folderStruct.map(() => "*").join("/") + "/*"; // Extra * to match all files in the final folder level
        const fp = studyRootPath + "/sourcedata";

        console.log(
          `ImportSchema -- SourcedataStructure is validating the following:`,
          JSON.stringify(
            {
              folderStruct,
              globPattern,
              fp,
            },
            null,
            2
          )
        );

        const dicomFiles = await api.path.glob(fp, globPattern, {
          onlyDirectories: false,
          onlyFiles: true,
        });

        if (dicomFiles.length === 0)
          return helpers.createError({
            path: helpers.path,
            message: "No DICOM files found under the indicated folder structure",
          });

        return true;
      }
    ),
});

/**
 * Schema intended for the Import Module Step: Define Aliases
 */
export const SchemaImportStepDefineAliases = Yup.object().shape<YupShape<ImportAliasesSchemaType>>({
  MappingScanAliases: Yup.object().test("ValidScanAliases", "Invalid Scan Aliases", (mapping, helpers) => {
    // At least one scan alias must be defined
    const scansNotIgnored = Object.values(mapping).filter(scan => scan !== "Ignore");
    if (scansNotIgnored.length === 0)
      return helpers.createError({ path: helpers.path, message: "At least one scan alias must be defined" });
    return true;
  }),
  MappingVisitAliases: Yup.object().test(
    "ValidVisitAliases",
    "All aliases must be unique and cannot be blank",
    mapping => {
      const visitAliases = Object.values(mapping);
      // const isAllUnique = uniq(visitAliases).length === visitAliases.length;
      const isAllNotBlank = visitAliases.every(alias => alias !== "");
      return isAllNotBlank;
    }
  ),
  MappingSessionAliases: Yup.object().test(
    "ValidSessionAliases",
    "All session aliases must be unique and cannot be blank",
    mapping => {
      const sessionAliases = Object.values(mapping);
      const isAllUnique = lodashUniq(sessionAliases).length === sessionAliases.length;
      const isAllNotBlank = sessionAliases.every(alias => alias !== "");
      return isAllUnique && isAllNotBlank;
    }
  ),
});

const handleValidatePaths = async (paths: string[], helpers: Yup.TestContext<ImportSchemaType>) => {
  // For the global context, there should be no paths
  const isGlobal = helpers.parent.IsGlobal ?? true;

  console.log("SchemaImportDefineContext -- Subjects -- isGlobal: ", {
    isGlobal,
    paths,
  });

  if (isGlobal && paths.length === 0) return true;

  // Paths cannot be blank for the non-global context
  if (paths.length === 0)
    return helpers.createError({
      path: helpers.path,
      message: "At least one path is required when specifying an additional context",
    });

  // For any additional context, we should verify that the paths exist within the indicated level
  const studyRootPath: string = helpers.options.context.StudyRootPath;
  const SourcedataStructure: SourcedataFolderType[] = helpers.options.context.SourcedataStructure;
  console.log("SchemaImportDefineContext -- Subjects -- StudyRootPath: ", studyRootPath);

  // If the study root path is invalid, we cannot validate the paths
  if (!studyRootPath || !((await api.path.getFilepathType(`${studyRootPath}/sourcedata`)) === "dir"))
    return helpers.createError({
      path: helpers.path,
      message: "Cannot determine the validity of the folder structure when the Study Root Path is invalid",
    });

  // Each path must be validated: must exist and the level beyond "sourcedata" that its basename
  // occurs at must match the SourcedataStructure; forward slashe conversions required
  const sourcedataPathForwardSlash = `${studyRootPath.replace(/\\/gm, "/")}/sourcedata/`;
  for (const path of paths) {
    if (!(await api.path.filepathExists(path))) return false;

    const pathParts = path.replace(/\\/gm, "/").replace(sourcedataPathForwardSlash, "").split("/");
    const pathDepth = pathParts.length;
    const folderType = SourcedataStructure[pathDepth - 1];

    console.log("SchemaImportDefineContext -- Subjects -- pathParts: ", {
      path,
      sourcedataPathForwardSlash,
      pathParts,
      pathDepth,
      folderType,
    });

    if (!["Subject", "Visit", "Session"].includes(folderType))
      return helpers.createError({
        path: helpers.path,
        message: `Path ${path} was not found to be a Subject, Visit, or Session`,
      });
  }
  return true;
};

/**
 * Schema intended for the Import Module Step: Define Context
 */
export const SchemaImportDefineContext = Yup.object().shape<YupShape<ImportContextSchemaType>>({
  // GUI Meta Fields
  IsGlobal: Yup.boolean().default(false),
  Paths: Yup.array()
    .optional()
    .default([])
    .of(Yup.string())
    .test("ValidContextPaths", "One or more invalid filepaths provided for this context", handleValidatePaths),

  // ASL Context Fields
  ASLSeriesPattern: Yup.string()
    .required("This is a required field")
    .oneOf(["control-label", "label-control", "deltam", "cbf"], "Invalid ASL Series Pattern"),
  NVolumes: Yup.number().when("ASLSeriesPattern", {
    is: (pattern: ASLSeriesPatternType) => ["control-label", "label-control"].includes(pattern),
    then: Yup.number()
      .required("Required")
      .min(2, "Number of volumes must be at least 2 when an alterating series is used"),
    otherwise: Yup.number().required("Required").min(1, "Number of volumes must be at least 1"),
  }),
  M0PositionInASL: Yup.array()
    .optional()
    .of(Yup.number().integer("Must be an integer"))
    .test("ValidM0Position", "Invalid M0 Position", (m0Pos, helpers: Yup.TestContext<ImportSchemaType>) => {
      // There can't be M0 positions within the ASL series if the M0 was acquired separately
      const M0IsSeparate: boolean = helpers.parent.M0IsSeparate;
      if (m0Pos.length > 0 && M0IsSeparate)
        return helpers.createError({
          path: helpers.path,
          message: "M0 Position cannot be defined when M0 is separate",
        });

      // Short circuit if there are no M0 positions
      if (m0Pos.length === 0 && !M0IsSeparate) return true;

      // No M0 position is allowed to exceed the number of volumes
      const nVolumes: number = helpers.parent.NVolumes;
      if (m0Pos.some(pos => pos > nVolumes))
        return helpers.createError({
          path: helpers.path,
          message: "At least one specified M0 position is greater than the number of volumes",
        });
      return true;
    }),
  DummyPositionInASL: Yup.array()
    .optional()
    .of(Yup.number().integer("Must be an integer"))
    .test(
      "ValidDummyPosition",
      "Invalid Dummy Scan Position",
      (dummyPositions, helpers: Yup.TestContext<ImportSchemaType>) => {
        if (dummyPositions.length === 0) return true;
        const nVolumes: number = helpers.parent.NVolumes;
        // No dummy position is allowed to exceed the number of volumes
        if (dummyPositions.some(pos => pos > nVolumes))
          return helpers.createError({
            path: helpers.path,
            message: "At least one specified dummy position is greater than the number of volumes",
          });
        return true;
      }
    ),

  // ASL Sequence Info Fields
  M0IsSeparate: Yup.boolean().optional(),
  ASLManufacturer: Yup.string().optional().oneOf(["GE", "Philips", "Siemens", ""], "Invalid ASL Manufacturer"),
  ASLSequence: Yup.string().optional().oneOf(["PASL", "CASL", "PCASL"], "Invalid ASL Sequence"),
  PostLabelingDelay: Yup.number().optional(),
  LabelingDuration: Yup.number().when("ASLSequence", {
    is: (sequence: ASLSequenceType) => sequence !== "PASL",
    then: Yup.number()
      .required("This is a required field when working with CASL or PCASL")
      .moreThan(0, "Labeling Duration must be greater than 0 when working with CASL or PCASL"),
    otherwise: schema =>
      schema
        .optional()
        .max(
          0,
          "Labeling Duration must be 0 when working with PASL. You're probably thinking about Bolus Cut Off Delay Time which applies to PASL."
        ),
  }),
  BolusCutOffFlag: Yup.boolean().when("ASLSequence", {
    is: (sequence: ASLSequenceType) => sequence === "PASL",
    then: Yup.boolean().required("This is a required field when working with PASL"),
    otherwise: schema =>
      schema.optional().notOneOf([true], "Bolus Cut Off Flag must be false or omitted when working with CASL or PCASL"),
  }),
  BolusCutOffTechnique: Yup.string().when("BolusCutOffFlag", {
    is: (bolusCutOffFlag: boolean) => !!bolusCutOffFlag,
    then: schema =>
      schema
        .required("This is a required field when Bolus Cut Off Flag is true")
        .oneOf(["QUIPSS", "QUIPSSII", "Q2TIPS"]),
    otherwise: schema =>
      schema
        .optional()
        .notOneOf(["QUIPSS", "QUIPSSII", "Q2TIPS"], "If Bolus Cut Off Flag is false, this field must be omitted"),
  }),
  BolusCutOffDelayTime: Yup.number().when("BolusCutOffTechnique", {
    is: (bolusCutOffTechnique: BolusCutOffTechniqueType) => !!bolusCutOffTechnique,
    then: schema =>
      schema
        .required("This is a required field and cannot be zero when Bolus Cut Off Technique is defined")
        .moreThan(0, "Bolus Cut Off Delay Time must be greater than 0"),
    otherwise: schema =>
      schema.optional().max(0, "This field must be set to 0 when Bolus Cut Off Technique is omitted"),
  }),
  // Background Suppression Fields
  BackgroundSuppressionNumberPulses: Yup.number().integer("Must be an integer"),
  BackgroundSuppressionPulseTime: Yup.array().when("BackgroundSuppressionNumberPulses", {
    is: (nPulses: number) => nPulses > 0,
    then: Yup.array()
      .of(Yup.number())
      .test(
        "ValidPulseTimes",
        "If provided, the number of timings specified must match number of pulses in the other field",
        (pulseTimes, helpers: Yup.TestContext<ImportSchemaType>) => {
          if (pulseTimes.length === 0) return true;
          const nPulses: number = helpers.parent.BackgroundSuppressionNumberPulses;
          return pulseTimes.length === nPulses;
        }
      ),
    otherwise: Yup.array()
      .of(Yup.number())
      .max(0, "This field must be empty if there are no background suppression pulses indicated"),
  }),
});

export const SchemaImportStepDefineMultiContext = Yup.object().shape<YupShape<ImportMultipleContextsSchemaType>>({
  ImportContexts: Yup.array().of(SchemaImportDefineContext),
});

export const SchemaImportPar = SchemaImportStepDefineMultiContext.concat(SchemaImportStepDefineRuntimeEnvs).concat(
  SchemaImportStepDefineAliases
);

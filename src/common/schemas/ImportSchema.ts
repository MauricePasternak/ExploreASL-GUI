import { uniq as lodashUniq } from "lodash";
import * as Yup from "yup";
import { ObjectShape } from "yup/lib/object";
import { IsValidEASLPath, IsValidMATLABRuntimePath, IsValidStudyRoot } from "../utilityFunctions/EASLFunctions";
import {
  ASLSeriesPatternType,
  EASLType,
  ImportSchemaType,
  ImportAliasesSchemaType,
  ImportContextSchemaType,
  ImportRuntimeEnvsSchemaType,
  SourcedataFolderType,
  ImportMultipleContextsSchemaType,
} from "../types/ImportSchemaTypes";
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

/**
 * Schema intended for the Import Module Step: Define Context
 */
export const SchemaImportDefineContext = Yup.object().shape<YupShape<ImportContextSchemaType>>({
  IsGlobal: Yup.boolean().default(false),
  Subjects: Yup.array()
    .optional()
    .default([])
    .of(Yup.string())
    .test(
      "ValidSubjects",
      "Invalid Subjects",
      async (subjectPaths: string[], helpers: Yup.TestContext<ImportSchemaType>) => {
        // For the global context, there should be no subjectPaths
        const isGlobal = helpers.parent.IsGlobal ?? true;

        // console.log("SchemaImportDefineContext -- Subjects -- isGlobal: ", {
        //   isGlobal,
        //   subjectPaths,
        // });

        if (isGlobal && subjectPaths.length === 0) return true;

        if (subjectPaths.length === 0)
          return helpers.createError({
            path: helpers.path,
            message: "At least one subject is required when specifying an additional context",
          });

        // For any additional context, we should verify that the subjectPaths exist within the indicated level
        const studyRootPath: string = helpers.options.context.StudyRootPath;
        const SourcedataStructure: SourcedataFolderType[] = helpers.options.context.SourcedataStructure;

        const nLevels = SourcedataStructure.indexOf("Subject");
        const globStars = SourcedataStructure.slice(0, nLevels + 1)
          .map(() => "*")
          .join("/");

        console.log(`Searching for subjects at fullPath Pattern ${studyRootPath}/sourcedata/${globStars}`);

        const foundSubjectPaths = new Set(
          (await api.path.glob(`${studyRootPath}/sourcedata`, globStars, { onlyDirectories: true })).map(p => p.path)
        );

        for (const subjectPath of subjectPaths) {
          const asPath = api.path.asPath(subjectPath); // Necessary to normalize to forward slashes in Windows
          if (!foundSubjectPaths.has(asPath.path))
            return helpers.createError({
              path: helpers.path,
              message: `Subject ${subjectPath} does not exist in the folder structure you had previously specified`,
            });
        }

        return true;
      }
    ),

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
  M0IsSeparate: Yup.boolean().optional(),
  ASLManufacturer: Yup.string().optional().oneOf(["GE", "Philips", "Siemens", ""], "Invalid ASL Manufacturer"),
  ASLSequence: Yup.string().optional().oneOf(["PASL", "CASL", "PCASL"], "Invalid ASL Sequence"),
  PostLabelingDelay: Yup.number().optional(),
  LabelingDuration: Yup.number().optional(),
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

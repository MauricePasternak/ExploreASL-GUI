import * as Yup from "yup";
import { LoadEASLDataFrameSchema } from "../types/DataVizSchemaTypes";
import { IsValidStudyRoot } from "../utilityFunctions/EASLFunctions";
import { YupShape } from "./ImportSchema";
const { api } = window;
export const DataVizLoadDFSchema = Yup.object().shape<YupShape<LoadEASLDataFrameSchema>>({
  StudyRootPath: Yup.string()
    .required("This is a required field")
    .test(
      "IsValidStudyRoot",
      "Invalid Study Root filepath. Ensure it is an existent directory.",
      async (filepath, helpers) => {
        console.log("Validating Study Root Path");
        return await IsValidStudyRoot(filepath, helpers, ["sourcedata", "rawdata", "derivatives"]);
      }
    ),
  Atlases: Yup.array()
    .of(Yup.string())
    .required("This is a required field")
    .test("IsValidAtlas", "Invalid Atlases", async (atlases, helpers) => {
      if (atlases.length === 0)
        return helpers.createError({ path: helpers.path, message: "At least one atlas must be selected" });

      const studyRootPath = helpers.parent.StudyRootPath;
      if (!studyRootPath) {
        return helpers.createError({
          path: helpers.path,
          message: "Cannot ascertain the validity of atlases to load when no study root filepath is provided",
        });
      }

      const statisticsPath = api.path.asPath(studyRootPath, "derivatives", "ExploreASL", "Population", "Stats");
      if (!(await api.path.filepathExists(statisticsPath.path))) {
        return helpers.createError({
          path: helpers.path,
          message: "No statistic directory found. Have you run the ExploreASL Population Module for this study?",
        });
      }

      const statistic = helpers.parent.Statistic;
      const PVC = helpers.parent.PVC;
      const existences = await Promise.all(
        atlases.map(atlasName => {
          return api.path.glob(statisticsPath.path, [`${statistic}_qCBF_*${atlasName}*${PVC}.tsv`]);
        })
      );
      for (let index = 0; index < existences.length; index++) {
        const existenceList = existences[index];
        const atlas = atlases[index];

        if (existenceList.length === 0) {
          const PrettyAtlas = {
            TotalGM: "WholeBrain Grey Matter",
            DeepWM: "Wholebrain White Matter",
            MNI_Structural: "MNI Cortical Atlas",
            Hammers: "Hammers Atlas",
            HOcort_CONN: "Harvard-Oxford Cortical",
            HOsub_CONN: "Harvard-Oxford Subcortical",
            Mindboggle_OASIS_DKT31_CMA: "OASIS Atlas",
          };
          return helpers.createError({
            path: helpers.path,
            message:
              `Could not locate a spreadsheet with Statistic ${statistic} and atlas ${
                PrettyAtlas[atlas as keyof typeof PrettyAtlas]
              }. ` + `Have you run the Population Module with the correct atlases indicated in Define Parameters?`,
          });
        }
      }

      return true;
    }),
  Statistic: Yup.string().oneOf(["mean", "median", "CoV"], "Invalid statistic selected"),
  PVC: Yup.string().oneOf(["PVC0", "PVC2"], "Invalid PVC selected"),
  MetadataPath: Yup.string().test("IsValidMetaData", "Invalid metadata filepath given", async (filepath, helpers) => {
    if (filepath === "") return true;
    const asPath = api.path.asPath(filepath);

    console.log("Validating Metadata Path: ", asPath);

    const filepathType = await api.path.getFilepathType(filepath);
    if (filepathType !== "file") {
      return helpers.createError({
        path: helpers.path,
        message: `${filepath} is not a file.`,
      });
    }
    if (![".csv", ".tsv"].includes(asPath.ext)) {
      return helpers.createError({
        path: helpers.path,
        message: `${filepath} is not a CSV or TSV file.`,
      });
    }
    return true;
  }),
});

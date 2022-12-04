import { LoadEASLDataFrameSchema } from "../../types/DataVizSchemaTypes";
import * as Yup from "yup";
import { YupTestReturnType } from "../../types/validationSchemaTypes";
import { yupCreateError } from "../../utilityFunctions/formFunctions";
const { api } = window;

export const DataVizLoadDFModule__AtlasesTest = async (
	atlases: LoadEASLDataFrameSchema["Atlases"],
	helpers: Yup.TestContext<LoadEASLDataFrameSchema>
): Promise<YupTestReturnType> => {
	if (atlases.length === 0) return yupCreateError(helpers, "At least one atlas must be selected");

	const studyRootPath = helpers.parent.StudyRootPath;
	if (!studyRootPath)
		return yupCreateError(
			helpers,
			"Cannot ascertain the validity of atlases to load when no study root filepath is provided"
		);

	const statisticsPath = api.path.asPath(studyRootPath, "derivatives", "ExploreASL", "Population", "Stats");
	if (!(await api.path.filepathExists(statisticsPath.path)))
		return yupCreateError(
			helpers,
			"No statistic directory found. Have you run the ExploreASL Population Module for this study?"
		);

	const statistic = helpers.parent.Statistic;
	const PVC = helpers.parent.PVC;
	const existences = await Promise.all(
		atlases.map((atlasName) => {
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
			return yupCreateError(
				helpers,
				`Could not locate a spreadsheet with Statistic ${statistic} and atlas ${
					PrettyAtlas[atlas as keyof typeof PrettyAtlas]
				}. ` + `Have you run the Population Module with the correct atlases indicated in Define Parameters?`
			);
		}
	}

	return true;
};

export const DataVizLoadDFModule__MetadataPathTest = async (
	filepath: LoadEASLDataFrameSchema["MetadataPath"],
	helpers: Yup.TestContext<LoadEASLDataFrameSchema>
): Promise<YupTestReturnType> => {
	if (filepath === "") return true;
	const asPath = api.path.asPath(filepath);
	const filepathType = await api.path.getFilepathType(filepath);
	if (filepathType !== "file") return yupCreateError(helpers, `${filepath} is not a file.`);
	if (![".csv", ".tsv"].includes(asPath.ext)) return yupCreateError(helpers, `${filepath} is not a CSV or TSV file.`);
	return true;
};

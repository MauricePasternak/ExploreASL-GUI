import * as Yup from "yup";
import { LoadEASLDataFrameSchema } from "../../types/DataVizSchemaTypes";
import { Schema_StudyRootPathPostImport } from "../CommonSchemas/EASLGUIPathsSchema";
import {
	DataVizLoadDFModule__AtlasesTest,
	DataVizLoadDFModule__MetadataPathTest,
} from "./DataVizLoadDFSchemaCustomTests";

const DataVizAtlasSchema = Yup.string().oneOf(
	["TotalGM", "DeepWM", "MNI_Structural", "Hammers", "HOcort_CONN", "HOsub_CONN", "Mindboggle_OASIS_DKT31_CMA"],
	"Invalid atlas selected"
);
const DataVizStatisticSchema = Yup.string().oneOf(["mean", "median", "CoV"], "Invalid statistic selected");
const DataVizPVCSchema = Yup.string().oneOf(["PVC0", "PVC2"], "Invalid PVC selected");

export const DataVizLoadDFSchema: Yup.ObjectSchema<LoadEASLDataFrameSchema> = Yup.object().shape({
	StudyRootPath: Schema_StudyRootPathPostImport,
	Atlases: Yup.array()
		.of(DataVizAtlasSchema)
		.required("This is a required field")
		.test("IsValidAtlas", "Invalid Atlases", DataVizLoadDFModule__AtlasesTest),
	Statistic: DataVizStatisticSchema,
	PVC: DataVizPVCSchema,
	MetadataPath: Yup.string().test(
		"IsValidMetaData",
		"Invalid metadata filepath given",
		DataVizLoadDFModule__MetadataPathTest
	),
});

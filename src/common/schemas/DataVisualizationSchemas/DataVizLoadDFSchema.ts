import * as Yup from "yup";
import { LoadEASLDataFrameSchema } from "../../types/DataVizSchemaTypes";
import { YupShape } from "../../types/validationSchemaTypes";
import { Schema_StudyRootPathPostImport } from "../CommonSchemas/EASLGUIPathsSchema";
import {
	DataVizLoadDFModule__AtlasesTest,
	DataVizLoadDFModule__MetadataPathTest,
} from "./DataVizLoadDFSchemaCustomTests";

export const DataVizLoadDFSchema = Yup.object().shape<YupShape<LoadEASLDataFrameSchema>>({
	StudyRootPath: Schema_StudyRootPathPostImport,
	Atlases: Yup.array()
		.of(Yup.string())
		.required("This is a required field")
		.test("IsValidAtlas", "Invalid Atlases", DataVizLoadDFModule__AtlasesTest),
	Statistic: Yup.string().oneOf(["mean", "median", "CoV"], "Invalid statistic selected"),
	PVC: Yup.string().oneOf(["PVC0", "PVC2"], "Invalid PVC selected"),
	MetadataPath: Yup.string().test(
		"IsValidMetaData",
		"Invalid metadata filepath given",
		DataVizLoadDFModule__MetadataPathTest
	),
});

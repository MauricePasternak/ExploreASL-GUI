import * as Yup from "yup";
import { Schema_StudyRootPathPreProcess } from "../CommonSchemas/EASLGUIPathsSchema";

export const SchemaRunEASLSingleStudySetup: Yup.ObjectSchema<{ studyRootPath: string }> = Yup.object().shape({
	studyRootPath: Schema_StudyRootPathPreProcess,
});

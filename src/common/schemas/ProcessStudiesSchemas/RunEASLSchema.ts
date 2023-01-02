import * as Yup from "yup";
import { RunEASLStudySetupType } from "../../types/ProcessStudiesTypes";
import { YupShape } from "../../types/validationSchemaTypes";
import { Schema_StudyRootPathPreProcess } from "../CommonSchemas/EASLGUIPathsSchema";

export const SchemaRunEASLSingleStudySetup = Yup.object().shape<YupShape<Pick<RunEASLStudySetupType, "studyRootPath">>>(
	{
		studyRootPath: Schema_StudyRootPathPreProcess,
	}
);

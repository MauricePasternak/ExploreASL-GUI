import * as Yup from "yup";
import { Schema_StudyRootPathPreProcess } from "../CommonSchemas/EASLGUIPathsSchema";
export const SchemaRunEASLSingleStudySetup = Yup.object().shape({
    studyRootPath: Schema_StudyRootPathPreProcess,
});
//# sourceMappingURL=RunEASLSchema.js.map
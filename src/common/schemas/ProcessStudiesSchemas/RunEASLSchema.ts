import * as Yup from "yup";
import { RunEASLStudySetupType } from "../../types/ProcessStudiesTypes";
import { YupShape } from "../../types/validationSchemaTypes";
import { IsValidStudyRoot } from "../../utils/EASLFunctions";

export const SchemaRunEASLSingleStudySetup = Yup.object().shape<YupShape<Pick<RunEASLStudySetupType, "studyRootPath">>>(
  {
    studyRootPath: Yup.string()
      .required("This is a required field")
      .typeError("Invalid value")
      .test(
        "IsValidStudyRoot",
        "Invalid Study Root filepath. Ensure it is an existent directory.",
        async (filepath, helpers) => {
          const { api } = window;
          const result = await IsValidStudyRoot(filepath, helpers, [
            "sourcedata",
            "rawdata",
            "derivatives/ExploreASL/lock",
          ]);
          if (result !== true) return result;
          // Must check if the studyRootPath also has the dataPar.json file
          const dataParFileStatus = await api.path.getFilepathType(`${filepath}/dataPar.json`);
          if (dataParFileStatus !== "file")
            return helpers.createError({
              path: helpers.path,
              message: "Study Root is missing the dataPar.json file. Have you run the 'Define Parameters' step?",
            });
          return true;
        }
      ),
  }
);

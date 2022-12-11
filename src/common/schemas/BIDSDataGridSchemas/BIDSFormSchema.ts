import * as Yup from "yup";
import { IsValidStudyRoot } from "../../utils/EASLFunctions";

export const BIDSFormSchema = Yup.object().shape({
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
});

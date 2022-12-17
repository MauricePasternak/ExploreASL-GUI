import { DataParValuesType } from "../../types/ExploreASLDataParTypes";
import * as Yup from "yup";
import { YupTestReturnType } from "../../types/validationSchemaTypes";
import { yupCreateError } from "../../utils/formFunctions";
import { AreValidSubjects } from "../../utils/EASLFunctions";

export const DataParModule__SUBJECTSTest = async (
	subjectBasenames: string[],
	helpers: Yup.TestContext<DataParValuesType>
): Promise<YupTestReturnType> => {
	console.log("🚀 ~ DataParModule__SUBJECTSTest ~ subjectBasenames", subjectBasenames);

	if (subjectBasenames.length < 1) {
		return yupCreateError(helpers, "At least one subject is required");
	}

	console.log(`DataParSchema -- SUBJECTS field -- subjectBasenames`, subjectBasenames);
	if (!subjectBasenames || !Array.isArray(subjectBasenames) || !subjectBasenames.length) {
		return yupCreateError(helpers, "Invalid value provided for the listing of subjects");
	}
	return await AreValidSubjects(subjectBasenames, helpers);
};

export const DataParModule__ApplyQuantificationTest = (values: unknown[]): YupTestReturnType => {
	return Array.isArray(values) && values.every((v) => v === 0 || v === 1);
};

import { DataParValuesType } from "../../types/ExploreASLDataParTypes";
import * as Yup from "yup";
import { YupTestReturnType } from "../../types/validationSchemaTypes";
import { yupCreateError } from "../../utilityFunctions/formFunctions";
import { AreValidSubjects } from "../../utilityFunctions/EASLFunctions";

export const DataParModule__SUBJECTSTest = async (
	subjectBasenames: string[],
	helpers: Yup.TestContext<DataParValuesType>
): Promise<YupTestReturnType> => {
	console.log(`DataParSchema -- SUBJECTS field -- subjectBasenames`, subjectBasenames);
	if (!subjectBasenames || !Array.isArray(subjectBasenames) || !subjectBasenames.length) {
		return yupCreateError(helpers, "Invalid value provided for the listing of subjects");
	}
	return await AreValidSubjects(subjectBasenames, helpers);
};

export const DataParModule__readoutDimTest = (
	readoutDim: string,
	helpers: Yup.TestContext<DataParValuesType>
): YupTestReturnType => {
	if (helpers.parent.Sequence === "2D_EPI" && readoutDim === "3D") {
		return yupCreateError(helpers, "Sequence type doesn't match readout dimension");
	} else if (readoutDim === "2D" && helpers.parent.Sequence !== "2D_EPI") {
		return yupCreateError(helpers, "Sequence type doesn't match readout dimension");
	}
	return true;
};

export const DataParModule__BackgroundSuppressionPulseTimeTest = (
	bSupTimings: number[],
	helpers: Yup.TestContext<DataParValuesType>
): YupTestReturnType => {
	// console.log(`BackgroundSuppressionPulseTime Validation got bSupTimings: ${bSupTimings}`);
	try {
		const numPulses: number = helpers.parent.BackgroundSuppressionNumberPulses;
		if (numPulses === 0 && bSupTimings.length > 0) {
			return yupCreateError(
				helpers,
				"There can't be any values here if the number of background suppression pulses is zero."
			);
		}

		if (numPulses > 0 && bSupTimings.length > 0 && bSupTimings.length !== numPulses) {
			return yupCreateError(
				helpers,
				`If this field isn't empty, then the number of comma-separated values must equal ` +
					`the values in the "Background Suppression Number of Pulses" field.`
			);
		}

		const providedContext = helpers.options.context;
		if (providedContext?.x?.Q?.M0 === "UseControlAsM0") {
			return bSupTimings.length === helpers.parent.BackgroundSuppressionNumberPulses;
		} else {
			return true;
		}
	} catch (error) {
		console.warn("An Error occured in field BackgroundSuppressionPulseTime: ", error);
		return false;
	}
};

export const DataParModule__ApplyQuantificationTest = (
	values: unknown[],
	helpers: Yup.TestContext<DataParValuesType>
): YupTestReturnType => {
	return Array.isArray(values) && values.every((v) => v === 0 || v === 1);
};

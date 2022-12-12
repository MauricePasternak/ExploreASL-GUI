import * as Yup from "yup";

export const DataParSliceReadoutTimeCalcSchema = Yup.object().shape({
	RepetitionTime: Yup.number()
		.required("This field is required")
		.typeError("This field must be a number")
		.positive("This field must be a positive number"),
	ArterialSpinLabelingType: Yup.string()
		.required("This field is required")
		.oneOf(["CASL", "PCASL", "PASL"], "This field must be one of the following: CASL, PCASL, PASL")
		.typeError("This field must be one of the following: CASL, PCASL, PASL"),
	PostLabelingDelay: Yup.number()
		.required("This field is required")
		.typeError("This field must be a number")
		.positive("This field must be a positive number"),
	LabelingDuration: Yup.number()
		.required("This field is required")
		.typeError("This field must be a number")
		.positive("This field must be a positive number"),
	NSlices: Yup.number()
		.required("This field is required")
		.typeError("This field must be a number")
		.integer("This field must be a positive integer")
		.positive("This field must be a positive number"),
});

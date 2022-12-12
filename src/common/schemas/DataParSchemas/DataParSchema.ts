import * as Yup from "yup";
import {
	ASLProcessingParamsSchema,
	ASLQuantificationParamsSchema,
	ASLSequenceParamsSchema,
	DataParValuesType,
	DatasetParamsSchema,
	ExternalParamsSchema,
	GUIParamsSchema,
	M0ProcessingParamsSchema,
	PopulationParamsSchema,
	SettingsParamsSchema,
	StructuralProcessingParamsSchema,
} from "../../types/ExploreASLDataParTypes";
import { YupShape } from "../../types/validationSchemaTypes";
import {
	AreValidSubjects,
	IsValidEASLPath,
	IsValidMATLABRuntimePath,
	IsValidStudyRoot,
} from "../../utils/EASLFunctions";
import { DataParModule__ApplyQuantificationTest, DataParModule__SUBJECTSTest } from "./DataParSchemaCustomTests";

const SchemaDataParDatasetParams: Yup.SchemaOf<DatasetParamsSchema> = Yup.object().shape({
	name: Yup.string().typeError("Invalid value").default(""),
	subjectRegexp: Yup.string().default(""),
	exclusion: Yup.array()
		.of(Yup.string())
		.typeError("This value must be a collection of folder names")
		.test("AreValidSubjects", async (subjectsToExclude, helpers: Yup.TestContext<DataParValuesType>) => {
			if (!subjectsToExclude || subjectsToExclude.length === 0) return true;
			return await AreValidSubjects(subjectsToExclude, helpers);
		})
		.default([]),
});

const SchemaDataParExternalParams: Yup.SchemaOf<ExternalParamsSchema> = Yup.object()
	.shape({
		bAutomaticallyDetectFSL: Yup.boolean().default(false),
		FSLPath: Yup.string().default(""),
	})
	.optional();

const SchemaDataParGUIParams = Yup.object().shape<YupShape<GUIParamsSchema>>({
	EASLType: Yup.string()
		.required("This is a required field")
		.typeError("This value must be either a value of Github or Compiled")
		.oneOf(["Github", "Compiled"], "Indicated ExploreASL program must either be described as Github or Compiled"),
	EASLPath: Yup.string()
		.required("This is a required field")
		.typeError("Invalid value")
		.when("EASLType", {
			is: "Github",
			then: Yup.string().test(
				"EASLPathValidGithub",
				"Invalid ExploreASL Path",
				async (filepath, helpers) => await IsValidEASLPath(filepath, "Github", helpers)
			),
			// Compiled EASL case
			otherwise: Yup.string().test(
				"EASLPathValidCompiled",
				"Invalid ExploreASL Path",
				async (filepath, helpers) => await IsValidEASLPath(filepath, "Compiled", helpers)
			),
		}),
	MATLABRuntimePath: Yup.string()
		.typeError("Invalid value")
		.when("EASLType", {
			is: "Github",
			then: Yup.string().optional(),
			otherwise: Yup.string()
				.required("This is a required field when the ExploreASL program is indicated as not being from Github")
				.test(
					"MATLABRuntimePathValid",
					"Invalid MATLAB Runtime Path",
					async (filepath, helpers) => await IsValidMATLABRuntimePath(filepath, helpers)
				),
		}),
	StudyRootPath: Yup.string()
		.required("This is a required field")
		.typeError("Invalid value")
		.test(
			"IsValidStudyRoot",
			"Invalid Study Root filepath. Ensure it is an existent directory.",
			async (filepath, helpers) => await IsValidStudyRoot(filepath, helpers, ["sourcedata", "rawdata", "derivatives"])
		),
	SUBJECTS: Yup.array()
		.required("This is a required field")
		.typeError("This value must be a collection of folder names")
		.of(Yup.string())
		.test("AreValidSubjects", DataParModule__SUBJECTSTest),
});

const SchemaDataParM0ProcessingParams = Yup.object().shape<YupShape<M0ProcessingParamsSchema>>({
	M0_conventionalProcessing: Yup.number().optional().typeError("This value must be either 0 or 1").integer().default(0),
	M0_GMScaleFactor: Yup.number()
		.typeError("Must be a positive integer")
		.positive("Must be a positive integer")
		.integer("Must be a positive integer")
		.default(1),
});

const SchemaDataParASLProcessingParamsSchema = Yup.object().shape<YupShape<ASLProcessingParamsSchema>>({
	motionCorrection: Yup.number().oneOf([0, 1], "Impossible value given for this field.").default(1),
	SpikeRemovalThreshold: Yup.number()
		.min(0, "This value must be a number and cannot be lower than 0")
		.max(1, "This value must be a number and cannot be higher than 1")
		.default(0.01),
	bRegistrationContrast: Yup.number()
		.typeError("This value must be either 0, 1, or 2")
		.oneOf([0, 1, 2], "Impossible value given for this field")
		.default(2),
	bAffineRegistration: Yup.number()
		.typeError("This value must be either 0, 1, or 2")
		.oneOf([0, 1, 2], "Impossible value given for this field")
		.default(0),
	bDCTRegistration: Yup.number()
		.typeError("This value must be either 0, 1, or 2")
		.oneOf([0, 1, 2], "Impossible value given for this field")
		.default(0),
	bRegisterM02ASL: Yup.number()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field")
		.default(0),
	bUseMNIasDummyStructural: Yup.number()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field")
		.default(0),
	bPVCNativeSpace: Yup.number()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field")
		.default(0),
	PVCNativeSpaceKernel: Yup.array()
		.length(3, "This must be an array of three integers")
		.of(
			Yup.number()
				.typeError("This value must be an integer between 1 and 10")
				.integer("Kernel values must be an integer")
				.min(1, "Kernel values cannot be less than 1")
				.max(10, "Kernel values cannot be more than 10")
		),
	bPVCGaussianMM: Yup.number().oneOf([0, 1], "Impossible value given for this field").default(0),
	MakeNIfTI4DICOM: Yup.boolean().oneOf([true, false], "Impossible value given for this field"),
});

const SchemaDataParStructuralProcessingParams = Yup.object().shape<YupShape<StructuralProcessingParamsSchema>>({
	bSegmentSPM12: Yup.number()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(0),
	bHammersCAT12: Yup.number()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(0),
	bFixResolution: Yup.boolean()
		.typeError("This value must be either true or false")
		.oneOf([true, false], "Impossible value given for this field")
		.default(false),
});

const SchemaDataParASLSequenceParams = Yup.object().shape<YupShape<ASLSequenceParamsSchema>>({
	SliceReadoutTime: Yup.number()
		.required("This is a required field")
		.typeError("This value must be a number")
		.moreThan(0, "This value cannot be zero or a negative number")
		.max(100, "This values cannot be greater than 100"),
});

const SchemaDataParASLQuantificationParams = Yup.object().shape<YupShape<ASLQuantificationParamsSchema>>({
	bUseBasilQuantification: Yup.boolean()
		.oneOf([true, false], "Impossible value given for this field")
		.typeError("This value must be either true or false")
		.default(false),
	Lambda: Yup.number()
		.optional()
		.typeError("This value must be a number")
		.moreThan(0, "This value cannot be zero or a negative number")
		.max(1, "This values cannot be greater than 1")
		.default(0.9),
	T2art: Yup.number()
		.optional()
		.typeError("This value must be a number")
		.moreThan(0, "This value cannot be zero or a negative number")
		.max(5000, "This values cannot be greater than 5000")
		.default(50),
	BloodT1: Yup.number()
		.optional()
		.typeError("This value must be a number")
		.moreThan(0, "This value cannot be zero or a negative number")
		.max(5000, "This values cannot be greater than 5000")
		.default(1650),
	TissueT1: Yup.number()
		.optional()
		.typeError("This value must be a number")
		.moreThan(0, "This value cannot be zero or a negative number")
		.max(5000, "This values cannot be greater than 5000")
		.default(1240),
	nCompartments: Yup.number().optional().oneOf([1, 2], "Impossible value given for this field.").default(1),
	ApplyQuantification: Yup.array()
		.required("This is a required field")
		.typeError("Invalid value")
		.length(6, "The length of this array of zeros or ones must be 6")
		.test(
			"ApplyQuantificationIsValid",
			"These should be a collection of five numbers, each of which can be 0 or 1",
			DataParModule__ApplyQuantificationTest
		),
	SaveCBF4D: Yup.boolean().optional().oneOf([true, false], "Impossible value given for this field").default(false),
});

const SchemaDataParSettingsParams = Yup.object().shape<YupShape<SettingsParamsSchema>>({
	Quality: Yup.number()
		.optional()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(1),
	DELETETEMP: Yup.number()
		.optional()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(1),
	SkipIfNoFlair: Yup.number()
		.optional()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(0),
	SkipIfNoASL: Yup.number()
		.optional()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(1),
	SkipIfNoM0: Yup.number()
		.optional()
		.typeError("This value must be either 0 or 1")
		.oneOf([0, 1], "Impossible value given for this field.")
		.default(0),
});

const SchemDataParPopulationParams = Yup.object().shape<YupShape<PopulationParamsSchema>>({
	bMasking: Yup.array()
		.length(4, "The length of this array of zeros or ones must be 4")
		.of(Yup.number().oneOf([0, 1], "This field must be an array of zeros or ones."))
		.typeError("Expected an array of zeros or ones")
		.default([1, 1, 1, 1]),
	Atlases: Yup.array()
		.optional()
		.of(
			Yup.string().oneOf(
				[
					"TotalGM",
					"DeepWM",
					"MNI_Structural",
					"HOcort_CONN",
					"HOsub_CONN",
					"Hammers",
					"HammersCAT12",
					"Thalamus",
					"Mindboggle_OASIS_DKT31_CMA",
				],
				"At least one invalid or no-longer-supported atlas name specified for this field"
			)
		)
		.default(["TotalGM", "DeepWM"]),
});

const SchemaDataParASLModule = SchemaDataParASLProcessingParamsSchema.concat(SchemaDataParM0ProcessingParams);
const SchemaDataParQuantification = SchemaDataParASLQuantificationParams.concat(SchemaDataParASLSequenceParams);

const SchemaDataParModules = Yup.object().shape<YupShape<DataParValuesType["x"]["modules"]>>({
	asl: SchemaDataParASLModule,
	structural: SchemaDataParStructuralProcessingParams,
	WMHsegmAlg: Yup.string()
		.oneOf(["LPA", "LGA"], "Invalid value given for this field.")
		.typeError(`This field must be one of "LPA" or LGA"`)
		.default("LPA"),
	bRunLongReg: Yup.number().optional().oneOf([0, 1], "Impossible value given for this field.").default(0),
	bRunDARTEL: Yup.number().optional().oneOf([0, 1], "Impossible value given for this field.").default(0),
});

export const SchemaDataPar = Yup.object().shape<YupShape<DataParValuesType>>({
	x: Yup.object().shape({
		dataset: SchemaDataParDatasetParams,
		external: SchemaDataParExternalParams,
		GUI: SchemaDataParGUIParams,
		modules: SchemaDataParModules,
		Q: SchemaDataParQuantification,
		settings: SchemaDataParSettingsParams,
		S: SchemDataParPopulationParams,
	}),
});

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as Yup from "yup";
import { isUndefined as lodashIsUndefined } from "lodash";
import { IsValidEASLPath, IsValidMATLABRuntimePath } from "../../utils/EASLFunctions";
import { Schema_ArterialSpinLabelingType, Schema_LabelingDuration, Schema_M0Estimate, Schema_M0Type, Schema_MagneticFieldStrength, Schema_Manufacturer, Schema_PostLabelingDelay, Schema_PulseSequenceType, } from "../BIDSSchema";
import { Schema_StudyRootPathPreImport } from "../CommonSchemas/EASLGUIPathsSchema";
import { ImportModule__BackgroundSuppressionPulseTimeTest, ImportModule__BolusCutOffDelayTimeTest, ImportModule__DummyPositionInASLTest, ImportModule__M0PositionInASLTest, ImportModule__MappingScanAliasesTest, ImportModule__MappingVisitAliasesTest, ImportModule__SingleContextPathsTest, ImportModule__SourcedataStructureTest, } from "./ImportSchemaCustomTests";
/** Schema intended for the Import Module Step: Define Runtime Environments */
export const SchemaImportStepDefineRuntimeEnvs = Yup.object().shape({
    EASLType: Yup.mixed()
        .oneOf(["Github", "Compiled"], "Must be either a clone of the ExploreASL Github repository or a compiled version")
        .required("EASL Type is required"),
    EASLPath: Yup.string()
        .required("EASL Path is required")
        .when("EASLType", {
        is: "Github",
        then: Yup.string().test("EASLPathValidGithub", "Invalid ExploreASL Path", (filepath, helpers) => __awaiter(void 0, void 0, void 0, function* () { return yield IsValidEASLPath(filepath, "Github", helpers); })),
        // Compiled EASL case
        otherwise: Yup.string().test("EASLPathValidCompiled", "Invalid ExploreASL Path", (filepath, helpers) => __awaiter(void 0, void 0, void 0, function* () { return yield IsValidEASLPath(filepath, "Compiled", helpers); })),
    }),
    MATLABRuntimePath: Yup.string().when("EASLType", {
        is: "Github",
        then: Yup.string().optional(),
        otherwise: Yup.string()
            .required("MATLAB Runtime Path is required")
            .test("MATLABRuntimePathValid", "Invalid MATLAB Runtime Path", (filepath, helpers) => __awaiter(void 0, void 0, void 0, function* () { return yield IsValidMATLABRuntimePath(filepath, helpers); })),
    }),
    StudyRootPath: Schema_StudyRootPathPreImport,
    SourcedataStructure: Yup.array()
        .required("Required.")
        .test("IsValidStructure", "Invalid sourcedata filepath structure", ImportModule__SourcedataStructureTest),
});
/** Schema intended for the Import Module Step: Define Aliases */
export const SchemaImportStepDefineAliases = Yup.object().shape({
    MappingScanAliases: Yup.object()
        .typeError("Expected a mapping of filepaths to designated Scan types.")
        .test("ValidScanAliases", "Invalid Scan Aliases", ImportModule__MappingScanAliasesTest),
    MappingVisitAliases: Yup.object()
        .typeError("Expected a mapping of filenames to alias names.")
        .test("ValidVisitAliases", "All aliases must be unique and cannot be blank", ImportModule__MappingVisitAliasesTest),
    MappingSessionAliases: Yup.object()
        .typeError("Expected a mapping of filenames to alias names.")
        .test("ValidSessionAliases", "All session aliases must be unique and cannot be blank", ImportModule__MappingVisitAliasesTest),
});
/** Schema intended for the Import Module Step: Define Context */
export const SchemaImportDefineContext = Yup.object().shape({
    // GUI Meta Fields
    Paths: Yup.array()
        .optional()
        .default([])
        .of(Yup.string())
        .test("ValidContextPaths", "One or more invalid filepaths provided for this context", ImportModule__SingleContextPathsTest),
    // ASL Context Fields
    ASLSeriesPattern: Yup.string()
        .required("This is a required field")
        .oneOf(["control-label", "label-control", "deltam", "cbf"], "Invalid ASL Series Pattern"),
    NVolumes: Yup.number().when("ASLSeriesPattern", {
        is: (pattern) => ["control-label", "label-control"].includes(pattern),
        then: Yup.number()
            .required("Required")
            .min(2, "Number of volumes must be at least 2 when an alterating series is used"),
        otherwise: Yup.number().required("Required").min(1, "Number of volumes must be at least 1"),
    }),
    M0PositionInASL: Yup.array()
        .optional()
        .of(Yup.number().integer("Must be an integer"))
        .test("ValidM0Position", "Invalid M0 Position", ImportModule__M0PositionInASLTest),
    DummyPositionInASL: Yup.array()
        .optional()
        .of(Yup.number().integer("Must be an integer"))
        .test("ValidDummyPosition", "Invalid Dummy Scan Position", ImportModule__DummyPositionInASLTest),
    // M0 Info Fields
    M0Type: Schema_M0Type,
    M0Estimate: Schema_M0Estimate,
    // ASL Sequence Info Fields
    // Main Fields
    Manufacturer: Schema_Manufacturer,
    PulseSequenceType: Schema_PulseSequenceType,
    MagneticFieldStrength: Schema_MagneticFieldStrength,
    ArterialSpinLabelingType: Schema_ArterialSpinLabelingType,
    PostLabelingDelay: Schema_PostLabelingDelay,
    // 2D Acquisition Fields
    SliceReadoutTime: Yup.number().when("PulseSequenceType", {
        is: (pulseSequenceType) => pulseSequenceType === "2D_EPI",
        then: (schema) => schema.required("This is a required field when working with 2D EPI"),
        otherwise: (schema) => schema.test("SliceReadoutTimeMustBeUndefined", "This field must not be present when the MRI pulse sequence is not a 2D acquisition", (readoutTime) => lodashIsUndefined(readoutTime)),
    }),
    // PCASL/CASL Fields
    LabelingDuration: Schema_LabelingDuration,
    // PASL Fields
    BolusCutOffFlag: Yup.boolean().when("ArterialSpinLabelingType", {
        is: (sequence) => sequence === "PASL",
        then: Yup.boolean().required("This is a required field when working with PASL"),
        otherwise: (schema) => schema.optional().notOneOf([true], "Bolus Cut Off Flag must be false or omitted when working with CASL or PCASL"),
    }),
    BolusCutOffTechnique: Yup.string().when("BolusCutOffFlag", {
        is: (bolusCutOffFlag) => !!bolusCutOffFlag,
        then: (schema) => schema
            .required("This is a required field when Bolus Cut Off Flag is true")
            .oneOf(["QUIPSS", "QUIPSSII", "Q2TIPS"]),
        otherwise: (schema) => schema
            .optional()
            .notOneOf(["QUIPSS", "QUIPSSII", "Q2TIPS"], "If Bolus Cut Off Flag is false, this field must be omitted"),
    }),
    BolusCutOffDelayTime: Yup.mixed().test("Invalid Bolus Cutoff Delay Time", ImportModule__BolusCutOffDelayTimeTest),
    // Background Suppression Fields
    BackgroundSuppressionNumberPulses: Yup.number().integer("Must be an integer"),
    BackgroundSuppressionPulseTime: Yup.array()
        .of(Yup.number())
        .typeError("This field must be either an array of numbers or left blank")
        .test("BackgroundSuppressionPulseTime", `The number of comma-separated values here must equal the number of indicated pulses in "Number of Background Suppression Pulses"`, ImportModule__BackgroundSuppressionPulseTimeTest),
});
export const SchemaImportStepDefineMultiContext = Yup.object().shape({
    ImportContexts: Yup.array().of(SchemaImportDefineContext),
});
export const SchemaImportPar = SchemaImportStepDefineMultiContext.concat(SchemaImportStepDefineRuntimeEnvs).concat(SchemaImportStepDefineAliases);
//# sourceMappingURL=ImportSchema.js.map
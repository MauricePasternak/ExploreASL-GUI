import { atom } from "jotai";
import { ImportContextSchemaType, ImportModuleProcStatus, ImportSchemaType } from "../common/types/ImportSchemaTypes";
import { cloneDeep as lodashCloneDeep } from "lodash";

export const atomImportModuleCurrentProcPID = atom<number>(-1);
export const atomImportModuleCurrentProcStatus = atom<ImportModuleProcStatus>("Standby");
export const ImportModuleChannelName = "ImportModule";

/**
 * The default single import context to clone from when creating new contexts.
 * It is based on a GE PCASL sequence with no background suppression.
 */
export const ImportSingleContextDefault: ImportContextSchemaType = {
	// GUI Meta
	// IsGlobal: true, // Terrible hack to make the validation work
	Paths: [],
	SubjectRegExp: "",
	VisitRegExp: "",
	SessionRegExp: "",

	// ASL Context
	ASLSeriesPattern: "deltam",
	NVolumes: 2,
	M0PositionInASL: [],
	DummyPositionInASL: [],

	// M0 Info
	M0Type: "Separate",

	// ASL Sequence Info
	// Main Fields
	Manufacturer: "GE",
	PulseSequenceType: "3D_spiral",
	MagneticFieldStrength: 3,
	ArterialSpinLabelingType: "PCASL",
	PostLabelingDelay: 1.525,
	LabelingDuration: 1.45,

	// Background Suppression Info
	BackgroundSuppressionNumberPulses: 0,
	BackgroundSuppressionPulseTime: [],
};

export const ImportSingleContextDefaultValueMapping: ImportContextSchemaType = {
	// GUI Meta
	// IsGlobal: true, // Terrible hack to make the validation work
	Paths: [],
	SubjectRegExp: "",
	VisitRegExp: "",
	SessionRegExp: "",

	// ASL Context
	ASLSeriesPattern: "deltam",
	NVolumes: 2,
	M0PositionInASL: [],
	DummyPositionInASL: [],

	// M0 Info
	M0Type: "Separate",
	M0Estimate: 1,

	// ASL Sequence Info
	// Main Fields
	Manufacturer: "GE",
	PulseSequenceType: "3D_spiral",
	MagneticFieldStrength: 3,
	ArterialSpinLabelingType: "PCASL",
	PostLabelingDelay: 1.525,

	// 2D Specific Fields
	SliceReadoutTime: 0.03,

	// PCASL/CASL Specific
	LabelingDuration: 1.45,

	// PASL Specific
	BolusCutOffFlag: false,
	BolusCutOffTechnique: "",
	BolusCutOffDelayTime: 0,

	// Background Suppression Info
	BackgroundSuppressionNumberPulses: 0,
	BackgroundSuppressionPulseTime: [],
};

export const ImportModuleFormDefaultValues: ImportSchemaType = {
	EASLType: "Github",
	EASLPath: "",
	MATLABRuntimePath: "",
	StudyRootPath: "",
	SourcedataStructure: ["Subject", "Scan"],
	MappingVisitAliases: {},
	MappingSessionAliases: {},
	MappingScanAliases: {},
	ImportContexts: [lodashCloneDeep(ImportSingleContextDefault)],
};

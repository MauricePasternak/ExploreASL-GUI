import { atom } from "jotai";
import { ImportContextSchemaType, ImportModuleProcStatus, ImportSchemaType } from "../common/types/ImportSchemaTypes";
import { cloneDeep as lodashCloneDeep } from "lodash";

export const atomImportModuleCurrentProcPID = atom<number>(-1);
export const atomImportModuleCurrentProcStatus = atom<ImportModuleProcStatus>("Standby");
export const ImportModuleChannelName = "ImportModule";

export const DefaultImportSingleContext: ImportContextSchemaType = {
	// GUI Meta
	IsGlobal: true, // Terrible hack to make the validation work
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
	Manufacturer: "GE",
	ArterialSpinLabelingType: "PCASL",
	PostLabelingDelay: 1.525,
	LabelingDuration: 1.425,
	BolusCutOffFlag: false,
	BolusCutOffTechnique: "",
	BolusCutOffDelayTime: 0,

	// Other
	BackgroundSuppressionNumberPulses: 5,
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
	ImportContexts: [lodashCloneDeep(DefaultImportSingleContext)],
};

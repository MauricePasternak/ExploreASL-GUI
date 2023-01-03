/** Type defining the current status of the import backend process. */
export type ImportModuleProcStatus = "Standby" | "Running" | "Paused";

/** Type defining the accepted string value for each folder level of a sourcedata file structure. */
export type SourcedataFolderType = "Subject" | "Visit" | "Session" | "Scan" | "Ignore" | "";

/** Type defining the accepted string value for describing an image type. */
export type ImportScanType = "ASL4D" | "M0" | "T1w" | "T2w" | "FLAIR" | "Ignore";

/** Type defining the types of ExploreASL executables */
export type EASLType = "Github" | "Compiled";

/** Type defining the main pattern of asl volumes in a series */
export type ASLSeriesPatternType = "control-label" | "label-control" | "deltam" | "cbf";

/** Type defining the accepted string value for describing an ASL sequence. */
export type ASLLabelingType = "CASL" | "PCASL" | "PASL";

/** Type defining the accepted string value for describing an ASL sequence manufacturer. */
export type ASLManufacturerType = "GE" | "Philips" | "Siemens";

/** For PASL sequences, this determines whether a bolus cut-off strategy was used. */
export type BolusCutOffFlagType = boolean;

/** For PASL sequences, this determines which bolus cut-off strategy was used. */
export type BolusCutOffTechniqueType = "QUIPSS" | "QUIPSSII" | "Q2TIPS";

/** For PASL sequences, this determines the cut-off times used. */
export type BolusCutOffDelayTimeType = number | number[];

/** Type defining the nature of the M0 scan */
export type M0TypeType = "Separate" | "Included" | "Absent" | "Estimate";

/** Type defining the nature of the MRI imaging sequence (NOT the ASL labeling sequence) */
export type PulseSequenceType = "3D_GRASE" | "2D_EPI" | "3D_spiral";

/** Type defining the schma of the step where the folder paths and structure are defined. */
export type ImportRuntimeEnvsSchemaType = {
	EASLType: EASLType;
	EASLPath: string;
	MATLABRuntimePath: string;
	StudyRootPath: string;
	SourcedataStructure: SourcedataFolderType[];
};

/** Type defining the schema of the step where */
export type ImportAliasesSchemaType = {
	MappingVisitAliases: Record<string, string>;
	MappingSessionAliases: Record<string, string>;
	MappingScanAliases: Record<string, ImportScanType>;
};

/** Type defining the schema of the step where ASL Context and other variables are defined. */
export type ImportContextSchemaType = {
	// GUI Meta
	Paths: string[];
	SubjectRegExp: string;
	VisitRegExp: string;
	SessionRegExp: string;

	// ASL Context
	ASLSeriesPattern: ASLSeriesPatternType;
	NVolumes: number;
	M0PositionInASL: number[];
	DummyPositionInASL?: number[];

	// M0 Info
	M0Type: M0TypeType;
	M0Estimate?: number;

	// ASL Sequence Info
	// Main Fields
	Manufacturer: ASLManufacturerType;
	PulseSequenceType: PulseSequenceType;
	MagneticFieldStrength: number;
	ArterialSpinLabelingType: ASLLabelingType;
	PostLabelingDelay: number | number[];

	// 2D-Specific Fields
	SliceReadoutTime?: number;

	// PCASL/CASL-Specific Fields
	LabelingDuration?: number | number[];

	// PASL-Specific Fields
	BolusCutOffFlag?: BolusCutOffFlagType;
	BolusCutOffTechnique?: BolusCutOffTechniqueType | "";
	BolusCutOffDelayTime?: BolusCutOffDelayTimeType;

	// Background Suppression Info
	BackgroundSuppressionNumberPulses?: number;
	BackgroundSuppressionPulseTime?: number[];
};

export type ImportMultipleContextsSchemaType = {
	ImportContexts: ImportContextSchemaType[];
};

/** Type defining the entirety of the Import Module */
export type ImportSchemaType = ImportRuntimeEnvsSchemaType & ImportAliasesSchemaType & ImportMultipleContextsSchemaType;

/** Type defining the JSON output to studyPar.json */
export type SingleStudyParJSONOutputSchemaType = {
	SubjectRegExp?: string;
	VisitRegExp?: string;
	SessionRegExp?: string;

	// M0 Info
	M0Type: M0TypeType;
	M0Estimate?: number;
	M0?: boolean;

	// ASL Info
	ASLContext: string;
	Manufacturer: ASLManufacturerType;
	PulseSequenceType: PulseSequenceType;
	MRAcquisitionType: "2D" | "3D";
	MagneticFieldStrength: number;

	ArterialSpinLabelingType: ASLLabelingType;
	SliceReadoutTime?: number;
	PostLabelingDelay: number | number[];
	LabelingDuration?: number | number[];
	BolusCutOffFlag?: boolean;
	BolusCutOffTechnique?: BolusCutOffTechniqueType;
	BolusCutOffDelayTime?: BolusCutOffDelayTimeType;

	// Background Suppression Info
	BackgroundSuppression?: boolean;
	BackgroundSuppressionNumberPulses?: number;
	BackgroundSuppressionPulseTime?: number[];
};

export type StudyParJSONOutputSchemaType = {
	StudyPars: SingleStudyParJSONOutputSchemaType[];
};

export type SourceStuctureJSONOutputSchemaType = {
	folderHierarchy: string[];
	/**
	 * Tuple of [RegexPosForSubject, RegexPosForVisit, RegexPosForSession, RegexPosForScan]. Uses 1-indexed positions.
	 */
	tokenOrdering: [number, number, number, number];
	tokenSessionAliases: string[];
	tokenVisitAliases: string[];
	tokenScanAliases: string[];
	bMatchDirectories: boolean;
};

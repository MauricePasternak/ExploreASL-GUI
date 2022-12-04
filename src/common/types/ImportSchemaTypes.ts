/**
 * Type defining the current status of the import backend process.
 */
export type ImportModuleProcStatus = "Standby" | "Running" | "Paused";

/**
 * Type defining the accepted string value for each folder level of a sourcedata file structure.
 */
export type SourcedataFolderType = "Subject" | "Visit" | "Session" | "Scan" | "Ignore" | "";

/**
 * Type defining the accepted string value for describing an image type.
 */
export type ImportScanType = "ASL4D" | "M0" | "T1w" | "T2w" | "FLAIR" | "Ignore";

/**
 * Type defining the types of ExploreASL executables
 */
export type EASLType = "Github" | "Compiled";

/**
 * Type defining the main pattern of asl volumes in a series
 */
export type ASLSeriesPatternType = "control-label" | "label-control" | "deltam" | "cbf";

/**
 * Type defining the accepted string value for describing an ASL sequence.
 */
export type ASLSequenceType = "CASL" | "PCASL" | "PASL";

/**
 * Type defining the accepted string value for describing an ASL sequence manufacturer.
 */
export type ASLManufacturerType = "GE" | "Philips" | "Siemens";

/**
 * For PASL sequences, this determines whether a bolus cut-off strategy was used.
 */
export type BolusCutOffFlagType = boolean;

/**
 * For PASL sequences, this determines which bolus cut-off strategy was used.
 */
export type BolusCutOffTechniqueType = "QUIPSS" | "QUIPSSII" | "Q2TIPS";

/**
 * For PASL sequences, this determines the cut-off times used.
 */
export type BolusCutOffDelayTimeType = number | number[];

/**
 * Type defining the schma of the step where the folder paths and structure are defined.
 */
export type ImportRuntimeEnvsSchemaType = {
  EASLType: EASLType;
  EASLPath: string;
  MATLABRuntimePath: string;
  StudyRootPath: string;
  SourcedataStructure: SourcedataFolderType[];
};

/**
 * Type defining the schema of the step where
 */
export type ImportAliasesSchemaType = {
  MappingVisitAliases: Record<string, string>;
  MappingSessionAliases: Record<string, string>;
  MappingScanAliases: Record<string, ImportScanType>;
};

/**
 * Type defining the schema of the step where ASL Context and other variables are defined.
 */
export type ImportContextSchemaType = {
  // GUI Meta
  IsGlobal: boolean;
  // folderHierarchy: string[];
  Paths: string[];
  SubjectRegExp: string;
  VisitRegExp: string;
  SessionRegExp: string;

  // ASL Context
  ASLSeriesPattern: ASLSeriesPatternType | "";
  NVolumes: number;
  M0PositionInASL: number[];
  DummyPositionInASL?: number[];
  // ASL Sequence Info
  M0IsSeparate: boolean;
  ASLManufacturer?: ASLManufacturerType | "";
  ASLSequence: ASLSequenceType;
  PostLabelingDelay?: number;
  LabelingDuration?: number;
  BolusCutOffFlag?: BolusCutOffFlagType;
  BolusCutOffTechnique?: BolusCutOffTechniqueType | "";
  BolusCutOffDelayTime?: BolusCutOffDelayTimeType;
  // Other
  BackgroundSuppressionNumberPulses?: number;
  BackgroundSuppressionPulseTime?: number[];
};

export type ImportMultipleContextsSchemaType = {
  ImportContexts: ImportContextSchemaType[];
};

/**
 * Type defining the entirety of the Import Module
 */
export type ImportSchemaType = ImportRuntimeEnvsSchemaType & ImportAliasesSchemaType & ImportMultipleContextsSchemaType;

/**
 * Type defining the JSON output to studyPar.json
 */
export type SingleStudyParJSONOutputSchemaType = {
  SubjectRegExp?: string;
  VisitRegExp?: string;
  SessionRegExp?: string;

  ASLContext: string;
  M0?: boolean;
  Manufacturer?: ASLManufacturerType;
  ArterialSpinLabelingType: ASLSequenceType;

  PostLabelingDelay?: number;
  LabelingDuration?: number;
  BolusCutOffFlag?: boolean;
  BolusCutOffTechnique?: BolusCutOffTechniqueType;
  BolusCutOffDelayTime?: BolusCutOffDelayTimeType;
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

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
  IsGlobal: boolean;
  folderHierarchy: string[];
  Paths: string[];
  ASLSeriesPattern: ASLSeriesPatternType | "";
  NVolumes: number;
  M0PositionInASL: number[];
  DummyPositionInASL?: number[];
  M0IsSeparate: boolean;
  ASLManufacturer?: ASLManufacturerType | "";
  ASLSequence: ASLSequenceType;
  PostLabelingDelay?: number;
  LabelingDuration?: number;
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
export type StudyParJSONOutputSchemaType = {
  ASLContext: string;
  Manufacturer?: ASLManufacturerType;
  LabelingType: ASLSequenceType;
  M0?: boolean;
  PostLabelingDelay?: number;
  LabelingDuration?: number;
  BackgroundSuppression?: boolean;
  BackgroundSuppressionNumberPulses?: number;
  BackgroundSuppressionPulseTime?: number[];
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

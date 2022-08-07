import { EASLType } from "./ImportSchemaTypes";

export type DatasetParamsSchema = {
  name: string;
  subjectRegexp: string;
  exclusion: string[];
  // SESSIONS: string[];
};

export type ExternalParamsSchema = {
  bAutomaticallyDetectFSL: boolean;
  FSLPath: string;
};

export type GUIParamsSchema = {
  StudyRootPath: string;
  SUBJECTS: string[];
  EASLPath: string;
  EASLType: EASLType;
  MATLABRuntimePath: string;
};

export type M0ProcessingParamsSchema = {
  M0_conventionalProcessing: number;
  M0_GMScaleFactor: number;
  // M0PositionInASL4D: number[];
  // DummyScanPositionInASL4D: number[];
};

export type ASLProcessingParamsSchema = {
  motionCorrection: number;
  SpikeRemovalThreshold: number;
  bRegistrationContrast: number;
  bAffineRegistration: number;
  bDCTRegistration: number;
  bRegisterM02ASL: number;
  bUseMNIasDummyStructural: number;
  bPVCNativeSpace: number;
  PVCNativeSpaceKernel: [number, number, number];
  bPVCGaussianMM: number;
  MakeNIfTI4DICOM: boolean;
};

export type StructuralProcessingParamsSchema = {
  bSegmentSPM12: number;
  bHammersCAT12: number;
  bFixResolution: boolean;
};

export type ASLSequenceParamsSchema = {
  Vendor: "Siemens" | "Philips" | "GE_product";
  Sequence: "3D_GRASE" | "3D_spiral" | "2D_EPI";
  readoutDim: "3D" | "2D";
  LabelingType: "CASL" | "PASL";
  M0: "UseControlAsM0" | "separate_scan" | number;
  BackgroundSuppressionNumberPulses: number;
  BackgroundSuppressionPulseTime: number[];
  Initial_PLD: number;
  LabelingDuration: number;
  SliceReadoutTime: number;
};

export type ASLQuantificationParamsSchema = {
  bUseBasilQuantification: boolean;
  Lambda: number;
  T2art: number;
  BloodT1: number;
  TissueT1: number;
  nCompartments: number;
  ApplyQuantification: [number, number, number, number, number];
  SaveCBF4D: boolean;
};

export type SettingsParamsSchema = {
  Quality: number;
  DELETETEMP: number;
  SkipIfNoFlair: number;
  SkipIfNoASL: number;
  SkipIfNoM0: number;
};

export type PopulationParamsSchema = {
  bMasking: number[];
  Atlases: string[];
};

export type DataParValuesType = {
  x: {
    // Dataset and Study Parameters
    dataset: DatasetParamsSchema;

    // External and GUI-related Parameters
    external?: ExternalParamsSchema;
    GUI: GUIParamsSchema;

    // Module-specific Parameters
    modules: {
      asl: M0ProcessingParamsSchema & ASLProcessingParamsSchema;
      structural: StructuralProcessingParamsSchema;
      bRunLongReg: number;
      bRunDARTEL: number;
    };

    // Quantification Parameters
    Q: ASLSequenceParamsSchema & ASLQuantificationParamsSchema;

    // Quality Settings
    settings: SettingsParamsSchema;

    // Population Parameters
    S: PopulationParamsSchema;
  };
};

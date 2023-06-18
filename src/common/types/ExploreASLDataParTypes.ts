import { EASLType } from "./ImportSchemaTypes";

export type EASLAtlasNamesType =
	| "TotalGM"
	| "DeepWM"
	| "MNI_Structural"
	| "Mindboggle_OASIS_DKT31_CMA"
	| "Hammers"
	| "HammersCAT12"
	| "Thalamus"
	| "HOcort_CONN"
	| "HOsub_CONN";

export type DatasetParamsSchema = {
	name: string;
	subjectRegexp: string;
	exclusion: string[];
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
	ApplyQuantification: [number, number, number, number, number, number];
};

export type StructuralProcessingParamsSchema = {
	bSegmentSPM12: number;
	bHammersCAT12: number;
	bFixResolution: boolean;
};

export type ASLSequenceParamsSchema = {
	SliceReadoutTime: number;
};

export type ASLQuantificationParamsSchema = {
	bUseBasilQuantification: boolean;
	Lambda: number;
	T2art: number;
	BloodT1: number;
	TissueT1: number;
	nCompartments: number;
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
	Atlases: Array<EASLAtlasNamesType>;
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
			WMHsegmAlg: "LGA" | "LPA";
		};

		// Quantification Parameters
		Q: ASLSequenceParamsSchema & ASLQuantificationParamsSchema;

		// Quality Settings
		settings: SettingsParamsSchema;

		// Population Parameters
		S: PopulationParamsSchema;
	};
};

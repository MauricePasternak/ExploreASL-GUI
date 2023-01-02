import { FieldPath } from "react-hook-form";
import { DataParValuesType } from "../../types/ExploreASLDataParTypes";

export const DataParFieldNameTranslator: Partial<Record<FieldPath<DataParValuesType>, string>> = {
	// #####################
	// STUDY PAGE PARAMETERS
	// #####################
	"x.dataset.name": "Study name",
	"x.dataset.subjectRegexp": "Subject Regex Pattern",
	"x.dataset.exclusion": "Excluded Subjects",
	"x.external.bAutomaticallyDetectFSL": "FSL Detection Switch",
	"x.external.FSLPath": "FSL program filepath",
	"x.GUI.StudyRootPath": "Study's root folder",
	"x.GUI.SUBJECTS": "List of Subjects to process",
	"x.GUI.EASLPath": "ExploreASL program filepath",
	"x.GUI.EASLType": "Type of ExploreASL Executable",
	"x.GUI.MATLABRuntimePath": "MATLAB Runtime filepath",

	// ########################
	// SEQUENCE PAGE PARAMETERS
	// ########################

	// Sequence Parameters
	"x.Q.SliceReadoutTime": "Slice Readout Time",

	// Quantification Parameters
	"x.Q.Lambda": "Lambda",
	"x.Q.T2art": "Arterial T2*",
	"x.Q.BloodT1": "Blood T1",
	"x.Q.TissueT1": "Brain Tissue T1",
	"x.Q.bUseBasilQuantification": "Use BASIL Algorithm",
	"x.Q.nCompartments": "Number of Compartments",
	"x.Q.ApplyQuantification": "Apply Quantification Settings",
	"x.Q.ApplyQuantification.0": "Apply Quantification Settings - first value",
	"x.Q.ApplyQuantification.1": "Apply Quantification Settings - second value",
	"x.Q.ApplyQuantification.2": "Apply Quantification Settings - third value",
	"x.Q.ApplyQuantification.3": "Apply Quantification Settings - fourth value",
	"x.Q.ApplyQuantification.4": "Apply Quantification Settings - fifth value",
	"x.Q.SaveCBF4D": "Save CBF as Timeseries",

	// ##########################
	// PROCESSING PAGE PARAMETERS
	// ##########################

	// General Processing Parameters
	"x.settings.Quality": "Processing Quality",
	"x.settings.DELETETEMP": "Delete Temporary Files",
	"x.settings.SkipIfNoFlair": "Skip if No FLAIR",
	"x.settings.SkipIfNoASL": "Skip if No ASL",
	"x.settings.SkipIfNoM0": "Skip if No M0",

	// Structural Processing Parameters
	"x.modules.bRunLongReg": "Run Longitudinal Registration",
	"x.modules.bRunDARTEL": "Run DARTEL",
	"x.modules.WMHsegmAlg": "WHM Segmentation Algorithm",
	"x.modules.structural.bSegmentSPM12": "Use SPM12 over CAT12",
	"x.modules.structural.bHammersCAT12": "Give Hammer's Atlas ROI printout",
	"x.modules.structural.bFixResolution": "Force CAT12-compatible Resolution",

	// ASL Module - ASL Processing Parameters
	"x.modules.asl.motionCorrection": "Perform Motion Correction",
	"x.modules.asl.SpikeRemovalThreshold": "T-statistic for Motion Correction",
	"x.modules.asl.bRegistrationContrast": "Source of Contrast for Registration",
	"x.modules.asl.bAffineRegistration": "Perform Affine Transform",
	"x.modules.asl.bDCTRegistration": "Perform DCT Transform",
	"x.modules.asl.bRegisterM02ASL": "Register M0 to Control ASL",
	"x.modules.asl.bUseMNIasDummyStructural": "Use MNI Average as Structural Backup",
	"x.modules.asl.bPVCNativeSpace": "Perform Partial Volume Correction",
	"x.modules.asl.PVCNativeSpaceKernel": "PVC Kernel Dimensions",
	"x.modules.asl.PVCNativeSpaceKernel.0": "PVC Kernel Dimensions -- First Value",
	"x.modules.asl.PVCNativeSpaceKernel.1": "PVC Kernel Dimensions -- Second Value",
	"x.modules.asl.PVCNativeSpaceKernel.2": "PVC Kernel Dimensions -- Third Value",
	"x.modules.asl.bPVCGaussianMM": "Use a Gaussian Kernel",
	"x.modules.asl.MakeNIfTI4DICOM": "Make NIFTI for DICOM",

	// ASL Module - M0 Processing Parameters
	"x.modules.asl.M0_conventionalProcessing": "Use Conventional M0 Processing",
	"x.modules.asl.M0_GMScaleFactor": "M0 Scale Factor",

	// Population Module - Masking Parameters
	"x.S.Atlases": "Selected Atlases from which ROIs are taken",
	"x.S.bMasking": "Masking Strategies",
	"x.S.bMasking.0": "Masking Strategies -- First Value",
	"x.S.bMasking.1": "Masking Strategies -- Second Value",
	"x.S.bMasking.2": "Masking Strategies -- Third Value",
	"x.S.bMasking.3": "Masking Strategies -- Fourth Value",
};

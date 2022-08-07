import { EASLVersionToWorkloadMappingType, EASLWorkload } from "../types/ExploreASLTypes";

const Mapping_1_9_0: EASLWorkload = {
  "010_DCM2NII.status": {
    module: "Import",
    description: "Running DCM2NII conversion program",
    loadingBarValue: 5,
  },
  "020_NII2BIDS.status": {
    module: "Import",
    description: "Converting NIFTI files to BIDS format",
    loadingBarValue: 10,
  },
  "040_BIDS2LEGACY.status": {
    module: "Import",
    description: "Creating a legacy format for running in the derivatives folder",
    loadingBarValue: 5,
  },
  "010_LinearReg_T1w2MNI.status": {
    module: "Structural",
    description: "T1w-image rigid-body registration to MNI standard space",
    loadingBarValue: 5,
  },
  "020_LinearReg_FLAIR2T1w.status": {
    module: "Structural_FLAIR",
    description: "FLAIR-image rigid-body registration to T1w-image",
    loadingBarValue: 15,
  },
  "030_FLAIR_BiasfieldCorrection.status": {
    module: "Structural_FLAIR",
    description: "FLAIR-image biasfield correction",
    loadingBarValue: 10,
  },
  "040_LST_Segment_FLAIR_WMH.status": {
    module: "Structural_FLAIR",
    description: "FLAIR-image white matter hyperintensities segmentation",
    loadingBarValue: 110,
  },
  "050_LST_T1w_LesionFilling_WMH.status": {
    module: "Structural_FLAIR",
    description: "T1w-image lesion filling",
    loadingBarValue: 5,
  },
  "060_Segment_T1w.status": {
    module: "Structural",
    description: "CAT12/SPM12 T1w-image segmentation",
    loadingBarValue: 270,
  },
  "070_CleanUpWMH_SEGM.status": {
    module: "Structural",
    description: "T1w-image white matter hyperintensities cleanup",
    loadingBarValue: 25,
  },
  "080_Resample2StandardSpace.status": {
    module: "Structural",
    description: "T1w-image reslicing to MNI standard space",
    loadingBarValue: 10,
  },
  "090_GetVolumetrics.status": {
    module: "Structural",
    description: "GM, WM, & CSF volume calculation",
    loadingBarValue: 5,
  },
  "100_VisualQC_Structural.status": {
    module: "Structural",
    description: "T1w-image & FLAIR-image visual (and quantitative) quality control",
    loadingBarValue: 5,
  },
  "020_RealignASL.status": {
    module: "ASL",
    description: "motion correction and spike removal",
    loadingBarValue: 30,
  },
  "030_RegisterASL.status": {
    module: "ASL",
    description: "ASL series rigid-body registration to the T1w image",
    loadingBarValue: 55,
  },
  "040_ResampleASL.status": {
    module: "ASL",
    description: "ASL series reslicing to MNI space and mean control image creation",
    loadingBarValue: 60,
  },
  "050_PreparePV.status": {
    module: "ASL",
    description: "preparation of partial volume maps",
    loadingBarValue: 45,
  },
  "060_ProcessM0.status": {
    module: "ASL",
    description: "M0 image processing and quantification",
    loadingBarValue: 20,
  },
  "070_CreateAnalysisMask.status": {
    module: "ASL",
    description: "CBF quantification",
    loadingBarValue: 20,
  },
  "080_Quantification.status": {
    module: "ASL",
    description: "CBF threshold mask creation",
    loadingBarValue: 20,
  },
  "090_VisualQC_ASL.status": {
    module: "ASL",
    description: "ASL series visual (and quantitative) quality control",
    loadingBarValue: 0,
  },
  "010_CreatePopulationTemplates.status": {
    module: "Population",
    description: "creating population templates",
    loadingBarValue: 1,
  },
  "020_CreateAnalysisMask.status": {
    module: "Population",
    description: "combining scan-specific analysis masks to a population-analysis mask",
    loadingBarValue: 1,
  },
  "030_CreateBiasfield.status": {
    module: "Population",
    description: "creating sequence-specific biasfields",
    loadingBarValue: 1,
  },
  "040_GetDICOMStatistics.status": {
    module: "Population",
    description: "retrieving DICOM parameter statistics",
    loadingBarValue: 1,
  },
  "050_GetVolumeStatistics.status": {
    module: "Population",
    description: "determining volume statistics",
    loadingBarValue: 1,
  },
  "060_GetMotionStatistics.status": {
    module: "Population",
    description: "determining motion statistics",
    loadingBarValue: 1,
  },
  "065_GetRegistrationStatistics.status": {
    module: "Population",
    description: "determining registration statistics",
    loadingBarValue: 2,
  },
  "070_GetROIstatistics.status": {
    module: "Population",
    description: "determining Region-of-Interest statistics",
    loadingBarValue: 20,
  },
  "080_SortBySpatialCoV.status": {
    module: "Population",
    description: "sorting scans on spatial coefficient of variation",
    loadingBarValue: 1,
  },
  "090_DeleteTempFiles.status": {
    module: "Population",
    description: "deleting and compressing files",
    loadingBarValue: 1,
  },
  "999_ready.status": {
    module: "Misc",
    description: "finishing the module",
    loadingBarValue: 0,
  },
};

const Mapping_1_10_0: EASLWorkload = {
  "010_DCM2NII.status": {
    module: "Import",
    description: "Running DCM2NII conversion program",
    loadingBarValue: 5,
  },
  "020_NII2BIDS.status": {
    module: "Import",
    description: "Converting NIFTI files to BIDS format",
    loadingBarValue: 10,
  },
  "040_BIDS2LEGACY.status": {
    module: "Import",
    description: "Creating a legacy format for running in the derivatives folder",
    loadingBarValue: 5,
  },
  "010_LinearReg_T1w2MNI.status": {
    module: "Structural",
    description: "T1w-image rigid-body registration to MNI standard space",
    loadingBarValue: 5,
  },
  "020_LinearReg_FLAIR2T1w.status": {
    module: "Structural_FLAIR",
    description: "FLAIR-image rigid-body registration to T1w-image",
    loadingBarValue: 15,
  },
  "030_FLAIR_BiasfieldCorrection.status": {
    module: "Structural_FLAIR",
    description: "FLAIR-image biasfield correction",
    loadingBarValue: 10,
  },
  "040_LST_Segment_FLAIR_WMH.status": {
    module: "Structural_FLAIR",
    description: "FLAIR-image white matter hyperintensities segmentation",
    loadingBarValue: 110,
  },
  "050_LST_T1w_LesionFilling_WMH.status": {
    module: "Structural_FLAIR",
    description: "T1w-image lesion filling",
    loadingBarValue: 5,
  },
  "060_Segment_T1w.status": {
    module: "Structural",
    description: "CAT12/SPM12 T1w-image segmentation",
    loadingBarValue: 270,
  },
  "070_CleanUpWMH_SEGM.status": {
    module: "Structural",
    description: "T1w-image white matter hyperintensities cleanup",
    loadingBarValue: 25,
  },
  "080_Resample2StandardSpace.status": {
    module: "Structural",
    description: "T1w-image reslicing to MNI standard space",
    loadingBarValue: 10,
  },
  "090_GetVolumetrics.status": {
    module: "Structural",
    description: "GM, WM, & CSF volume calculation",
    loadingBarValue: 5,
  },
  "100_VisualQC_Structural.status": {
    module: "Structural",
    description: "T1w-image & FLAIR-image visual (and quantitative) quality control",
    loadingBarValue: 5,
  },
  "020_RealignASL.status": {
    module: "ASL",
    description: "motion correction and spike removal",
    loadingBarValue: 30,
  },
  "030_RegisterASL.status": {
    module: "ASL",
    description: "ASL series rigid-body registration to the T1w image",
    loadingBarValue: 55,
  },
  "040_ResampleASL.status": {
    module: "ASL",
    description: "ASL series reslicing to MNI space and mean control image creation",
    loadingBarValue: 60,
  },
  "050_PreparePV.status": {
    module: "ASL",
    description: "preparation of partial volume maps",
    loadingBarValue: 45,
  },
  "060_ProcessM0.status": {
    module: "ASL",
    description: "M0 image processing and quantification",
    loadingBarValue: 20,
  },
  "070_CreateAnalysisMask.status": {
    module: "ASL",
    description: "CBF quantification",
    loadingBarValue: 20,
  },
  "080_Quantification.status": {
    module: "ASL",
    description: "CBF threshold mask creation",
    loadingBarValue: 20,
  },
  "090_VisualQC_ASL.status": {
    module: "ASL",
    description: "ASL series visual (and quantitative) quality control",
    loadingBarValue: 0,
  },
  "010_CreatePopulationTemplates.status": {
    module: "Population",
    description: "creating population templates",
    loadingBarValue: 1,
  },
  "020_CreateAnalysisMask.status": {
    module: "Population",
    description: "combining scan-specific analysis masks to a population-analysis mask",
    loadingBarValue: 1,
  },
  "030_CreateBiasfield.status": {
    module: "Population",
    description: "creating sequence-specific biasfields",
    loadingBarValue: 1,
  },
  "040_GetDICOMStatistics.status": {
    module: "Population",
    description: "retrieving DICOM parameter statistics",
    loadingBarValue: 1,
  },
  "050_GetVolumeStatistics.status": {
    module: "Population",
    description: "determining volume statistics",
    loadingBarValue: 1,
  },
  "060_GetMotionStatistics.status": {
    module: "Population",
    description: "determining motion statistics",
    loadingBarValue: 1,
  },
  "065_GetRegistrationStatistics.status": {
    module: "Population",
    description: "determining registration statistics",
    loadingBarValue: 2,
  },
  "070_GetROIstatistics.status": {
    module: "Population",
    description: "determining Region-of-Interest statistics",
    loadingBarValue: 20,
  },
  "080_SortBySpatialCoV.status": {
    module: "Population",
    description: "sorting scans on spatial coefficient of variation",
    loadingBarValue: 1,
  },
  "090_DeleteTempFiles.status": {
    module: "Population",
    description: "deleting and compressing files",
    loadingBarValue: 1,
  },
  "999_ready.status": {
    module: "Misc",
    description: "finishing the module",
    loadingBarValue: 0,
  },
};

/**
 * A mapping of ExploreASL version to the corresponding expected workload for that version of ExploreASL.
 * - Keys are the basenames of ExploreASL version files
 * - Values are the workloads that should be expected.
 */
export const EASLWorkloadMapping: EASLVersionToWorkloadMappingType = {
  "VERSION_1.9.0": Mapping_1_9_0,
  "VERSION_1.10.0_BETA": Mapping_1_10_0,
};

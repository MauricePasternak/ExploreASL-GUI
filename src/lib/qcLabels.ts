/**
 * Human-readable labels for ExploreASL Quality Control metrics.
 *
 * Decoupled from the Rust backend to keep UI presentation strings in the
 * frontend layer.
 */
export const QC_METRIC_LABELS: Record<string, string> = {
  // Structural measures
  T1w_GM_ICV_Ratio: "Ratio of Gray Matter vs Intra-cortical Volume",
  T1w_WM_ICV_Ratio: "Ratio of White Matter vs Intra-cortical Volume",
  T1w_CSF_ICV_Ratio: "Ratio of Cerebrospinal Fluid vs Intra-cortical Volume",
  T1w_GM_vol_mL: "Gray Matter Volume (mL)",
  T1w_WM_vol_mL: "White Matter Volume (mL)",
  T1w_CSF_vol_mL: "Cerebrospinal Fluid Volume (mL)",
  T1w_ICV_vol_mL: "Total Intra-cortical Volume (mL)",
  T1w_WMref_vol_mL: "White Matter Reference Volume (mL)",
  T1w_SD_WMref: "Standard Deviation of White Matter Reference",
  T1w_SNR_GM_Ratio: "Signal-to-Noise Ratio (SNR) in Gray Matter",
  T1w_CNR_GM_WM_Ratio: "Contrast-to-Noise Ratio (CNR) between Gray and White Matter",
  T1w_FBER_WMref_Ratio: "Foreground-to-Background Energy Ratio (FBER) in WM Reference",
  T1w_EFC_bits: "Entropy Focus Criterion (EFC)",
  T1w_Mean_AI_Perc: "Mean Asymmetry Index (%)",
  T1w_SD_AI_Perc: "Standard Deviation of Asymmetry Index (%)",
  T1w_LR_flip_YesNo: "Left-Right Flip (Yes/No)",
  T1w_IQR_Perc: "Inter-quartile Range of T1w (%)",

  // ASL measures
  TC_ASL2T1w_Perc: "Temporal Correlation of ASL to T1w (%)",
  ASL_tSNR_GM_Ratio: "Temporal SNR in Gray Matter",
  ASL_tSNR_WM_Ratio: "Temporal SNR in White Matter",
  ASL_tSNR_CSF_Ratio: "Temporal SNR in Cerebrospinal Fluid",
  ASL_tSNR_WMref_Ratio: "Temporal SNR in White Matter Reference",
  ASL_tSNR_GMWM_Ratio: "Temporal SNR in Gray and White Matter",
  ASL_tSNR_GMWM_WMref_Ratio: "Temporal SNR in GM/WM vs WM Reference",
  ASL_tSNR_Physio2Thermal_Ratio: "Physiological to Thermal Noise Ratio",
  ASL_tSNR_Slope_Corr: "tSNR Slope Correction",
  ASL_Coverage_Perc: "ASL Brain Coverage (%)",
  TC_CBF2template: "Temporal Correlation of CBF to Template",
  TC_M02template: "Temporal Correlation of M0 to Template",
  LR_flip_YesNo: "Left-Right Flip (Yes/No)",
  MotionMean_mm: "Mean Subject Motion (mm)",
  MotionExcl_Perc: "Percentage of Excluded Volumes due to Motion (%)",
  MotionMax_mm: "Maximum Subject Motion (mm)",
  MotionSD_mm: "Standard Deviation of Subject Motion (mm)",
  CBF_GM_Median_mL100gmin: "Median Gray Matter CBF (mL/100g/min)",
  CBF_GM_PVC2_mL100gmin: "PVC Gray Matter CBF (mL/100g/min)",
  CBF_WM_PVC2_mL100gmin: "PVC White Matter CBF (mL/100g/min)",
  CBF_GM_WM_Ratio: "Ratio of Gray Matter vs White Matter CBF",
  SpatialCoV_GM_Perc: "Spatial Coefficient of Variation in Gray Matter (%)",
  SoftwareVersions: "Software Version",
  PulseSequenceType: "Pulse Sequence Type",
  MRAcquisitionType: "MR Acquisition Type",
  EchoTime_ms: "Echo Time (ms)",
  LabelingDuration_ms: "Labeling Duration (ms)",
  BackgroundSuppressionNumberPulses: "Background Suppression Pulses Count",
  SliceReadoutTime_ms: "Slice Readout Time (ms)",
  LabelingType: "Labeling Type",
  Initial_PLD_ms: "Initial Post-label Delay (ms)",
  NumberOfAverages: "Number of Averages",
  Vendor: "Scanner Vendor",
  M0: "M0 Calibration Method",
  uniqueEchoTime: "Unique Echo Time (ms)",
  nUniqueEchoTime: "Number of Unique Echo Times",
  uniqueInitial_PLD: "Unique Post-label Delay (ms)",
  nUniqueInitial_PLD: "Number of Unique PLDs",
  uniqueLabelingDuration: "Unique Labeling Duration (ms)",
  nUniqueLabelingDuration: "Number of Unique Labeling Durations",
  Matrix: "Imaging Matrix Size",
  VoxelSize_mm: "Voxel Size (mm)",
  RigidBody2Anat_mm: "Rigid-body Coregistration to Anatomy (mm)",
  nRMSE_Perc: "Normalized Root Mean Square Error (%)",
  RMSE_Perc: "Root Mean Square Error (%)",
  Mean_SSIM_Perc: "Mean Structural Similarity Index (SSIM) (%)",
  PeakSNR_Ratio: "Peak Signal-to-Noise Ratio (PSNR)",
  AI_Perc: "Asymmetry Index (%)",

  // General / Common keys
  Version_CAT12: "CAT12 Version",
  Version_LST: "LST Version",
  Version_FSL: "FSL Version",
  Version_ExploreASL: "ExploreASL Version",
  Version_ExploreASL_Git_commit: "ExploreASL Git Commit",
  Version_Matlab: "MATLAB Version",
  Version_SPM12: "SPM12 Version",
  ID: "Subject Session ID",
};

/**
 * Fallback formatter that converts snake_case or identifier strings to title case.
 */
function formatFallbackQcKey(key: string): string {
  let label = "";
  let capitalize = true;
  for (const c of key) {
    if (c === "_") {
      label += " ";
      capitalize = true;
    } else if (capitalize) {
      label += c.toUpperCase();
      capitalize = false;
    } else {
      label += c;
    }
  }
  return label;
}

/**
 * Resolves a human-readable QC metric label given its key.
 */
export function getQcMeasureLabel(key: string): string {
  if (key in QC_METRIC_LABELS) {
    return QC_METRIC_LABELS[key];
  }
  return formatFallbackQcKey(key);
}

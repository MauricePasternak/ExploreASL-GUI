import type { BidsAslMetadata } from "../../schemas/importSchemas";

export const BIDS_FIELD_DESCRIPTIONS: Record<keyof BidsAslMetadata, string> = {
  // Required for all ASL
  ArterialSpinLabelingType:
    "The macro-architecture of the ASL preparation. Must be PASL (Pulsed), CASL (Continuous), or PCASL (Pseudo-Continuous). Drives conditional fields.",
  PostLabelingDelay:
    "The time (in seconds) from the end of the labeling pulse/train (CASL/PCASL) or the middle of the labeling pulse (PASL) until the excitation of the imaging slice/slab. Enter a single number, or an array for multi-PLD/Look-Locker sequences. Enter 0 for volumes without a PLD (e.g., M0 scans).",
  MRAcquisitionType:
    "The dimensionality of the readout sequence. Select 2D (typically multi-slice line-by-line) or 3D (e.g., volume-based acquisition like 3D GRASE).",
  MagneticFieldStrength:
    "The nominal field strength of the MRI scanner magnet in Tesla (e.g., 3, 1.5). Crucial for calculating longitudinal relaxation times (T1) of blood during quantification.",
  EchoTime:
    "The time (in seconds) between the initial excitation RF pulse and the peak of the echo signal.",

  // (P)CASL Required & Recommended
  LabelingDuration:
    "The total duration (in seconds) of the continuous or pseudo-continuous labeling pulse train. Can be a single number or an array matching the volume acquisition order (use 0 for non-labeled control or M0 volumes).",
  PCASLType:
    "Specific to PCASL. Defines whether the RF pulse train uses balanced gradients (net gradient over the labeling cycle is zero) or unbalanced gradients.",
  CASLType:
    "Specific to continuous ASL. Specifies if labeling was performed using a single-coil (the body/head coil used for imaging) or a dedicated double-coil setup (a separate neck coil for labeling).",
  LabelingPulseAverageGradient:
    "The average magnetic field gradient (in mT/m) applied across the labeling plane during the label period.",
  LabelingPulseMaximumGradient:
    "The peak amplitude of the magnetic field gradient (in mT/m) reached during a single RF pulse within the labeling train.",
  LabelingPulseAverageB1:
    "The average amplitude of the radiofrequency magnetic field (B1, in microtesla) applied during the labeling pulse train.",
  LabelingPulseDuration:
    "The duration (in seconds) of an individual RF pulse within the PCASL pulse train.",
  LabelingPulseInterval:
    "The time interval (in seconds) from the start of one RF pulse to the start of the next RF pulse in the PCASL train.",

  // PASL Required & Conditional
  BolusCutOffFlag:
    "Specify true if a pulse/technique was applied to temporally terminate (cut off) the labeled bolus delivery, ensuring a well-defined bolus duration.",
  BolusCutOffDelayTime:
    "The time (in seconds) from the application of the initial PASL labeling pulse until the application of the bolus cut-off pulse. Can be an array if it varies by volume.",
  BolusCutOffTechnique:
    'The name of the specific RF/gradient method used to cut off the bolus (e.g., "QUIPSS", "QUIPSS II", "Q2TIPS").',

  // Recommended
  BackgroundSuppression:
    "Specify true if background suppression RF pulses were used to attenuate the signal of static tissue, improving the signal-to-noise ratio (SNR) of the perfusion signal.",
  BackgroundSuppressionNumberPulses:
    "The total number of inversion pulses applied prior to image readout to suppress background tissue signal.",
  BackgroundSuppressionPulseTime:
    "An array of times (in seconds) specifying when each background suppression pulse was applied relative to the start of the labeling preparation.",
  VascularCrushing:
    'Specify true if bipolar "crusher" gradients were used to suppress signal from fast-moving blood within large macrovascular arteries.',
  RepetitionTimePreparation:
    "The time interval (in seconds) between successive labeling pulses or preparations.",
  FlipAngle:
    "The angle (in degrees) of the excitation RF pulse. Can be an array if it varies across volumes (e.g., in Look-Locker readout schemes).",
  SliceTiming:
    "(Required for 2D readouts) An array containing the precise time (in seconds) at which each individual slice was acquired relative to the first slice's excitation pulse.",

  // Vendor / Hardware Specifics
  PulseSequenceType:
    "The primary spatial encoding readout method used (e.g., EPI for Echo Planar Imaging, spiral for spiral trajectories, or GRASE for Gradient and Spin Echo).",
  Manufacturer:
    'The specific brand or company that manufactured the MRI scanner (e.g., "Siemens Healthineers", "Philips Healthcare").',

  // M0 Calibration
  M0Type:
    "Describes how the M0 scan was acquired. Automatically set to 'Included' when ASL Context contains 'm0scan'. Otherwise choose: Separate (different file), Absent (no calibration data), or Estimate (calculated mathematically).",
  M0_GMScaleFactor: "Add additional scale factor to multiply the M0 image by.",

  // ExploreASL Specifics
  ASLContext:
    "Comma-separated sequence describing each volume in the 4D timeseries. Valid values: control, label, m0scan, deltam. Example: 'm0scan, label, control, label, control'. When 'm0scan' is present, M0 Type is automatically set to 'Included'.",
  DatasetType:
    "Internal pipeline key used to identify the format structure of the input raw dataset.",
  LabelingType:
    "Simplified macro-classification used for internal ExploreASL quantification routing (typically collapses down to PASL or CASL).",
  DummyScanPositionInASL4D:
    'Array of 1-based index numbers indicating where unsteadied "dummy" volumes are located within the 4D timeseries.',
  RepetitionTimePreparationM0:
    "The repetition time (in seconds) specifically used during the acquisition of the M0 calibration scans (often longer than the ASL TR). Can be an array.",
};

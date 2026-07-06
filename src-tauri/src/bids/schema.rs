use serde::{Deserialize, Serialize};
use serde_json::Value;

/// BidsAslMetadata mirrors the TS BidsAslMetadataBaseSchema.
/// All fields optional, PascalCase per BIDS convention.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase", default)]
pub struct BidsAslMetadata {
    #[serde(
        rename = "ArterialSpinLabelingType",
        skip_serializing_if = "Option::is_none"
    )]
    pub arterial_spin_labeling_type: Option<String>,
    #[serde(rename = "PostLabelingDelay", skip_serializing_if = "Option::is_none")]
    pub post_labeling_delay: Option<Value>,
    #[serde(rename = "MRAcquisitionType", skip_serializing_if = "Option::is_none")]
    pub mr_acquisition_type: Option<String>,
    #[serde(
        rename = "MagneticFieldStrength",
        skip_serializing_if = "Option::is_none"
    )]
    pub magnetic_field_strength: Option<f64>,
    #[serde(rename = "EchoTime", skip_serializing_if = "Option::is_none")]
    pub echo_time: Option<f64>,
    #[serde(rename = "LabelingDuration", skip_serializing_if = "Option::is_none")]
    pub labeling_duration: Option<Value>,
    #[serde(rename = "PCASLType", skip_serializing_if = "Option::is_none")]
    pub pcasl_type: Option<String>,
    #[serde(rename = "CASLType", skip_serializing_if = "Option::is_none")]
    pub casl_type: Option<String>,
    #[serde(
        rename = "LabelingPulseAverageGradient",
        skip_serializing_if = "Option::is_none"
    )]
    pub labeling_pulse_average_gradient: Option<f64>,
    #[serde(
        rename = "LabelingPulseMaximumGradient",
        skip_serializing_if = "Option::is_none"
    )]
    pub labeling_pulse_maximum_gradient: Option<f64>,
    #[serde(
        rename = "LabelingPulseAverageB1",
        skip_serializing_if = "Option::is_none"
    )]
    pub labeling_pulse_average_b1: Option<f64>,
    #[serde(
        rename = "LabelingPulseDuration",
        skip_serializing_if = "Option::is_none"
    )]
    pub labeling_pulse_duration: Option<f64>,
    #[serde(
        rename = "LabelingPulseInterval",
        skip_serializing_if = "Option::is_none"
    )]
    pub labeling_pulse_interval: Option<f64>,
    #[serde(rename = "BolusCutOffFlag", skip_serializing_if = "Option::is_none")]
    pub bolus_cut_off_flag: Option<bool>,
    #[serde(
        rename = "BolusCutOffDelayTime",
        skip_serializing_if = "Option::is_none"
    )]
    pub bolus_cut_off_delay_time: Option<Value>,
    #[serde(
        rename = "BolusCutOffTechnique",
        skip_serializing_if = "Option::is_none"
    )]
    pub bolus_cut_off_technique: Option<String>,
    #[serde(
        rename = "BackgroundSuppression",
        skip_serializing_if = "Option::is_none"
    )]
    pub background_suppression: Option<bool>,
    #[serde(
        rename = "BackgroundSuppressionNumberPulses",
        skip_serializing_if = "Option::is_none"
    )]
    pub background_suppression_number_pulses: Option<f64>,
    #[serde(
        rename = "BackgroundSuppressionPulseTime",
        skip_serializing_if = "Option::is_none"
    )]
    pub background_suppression_pulse_time: Option<Value>,
    #[serde(rename = "VascularCrushing", skip_serializing_if = "Option::is_none")]
    pub vascular_crushing: Option<bool>,
    #[serde(
        rename = "RepetitionTimePreparation",
        skip_serializing_if = "Option::is_none"
    )]
    pub repetition_time_preparation: Option<f64>,
    #[serde(rename = "FlipAngle", skip_serializing_if = "Option::is_none")]
    pub flip_angle: Option<Value>,
    #[serde(rename = "SliceTiming", skip_serializing_if = "Option::is_none")]
    pub slice_timing: Option<Value>,
    #[serde(rename = "PulseSequenceType", skip_serializing_if = "Option::is_none")]
    pub pulse_sequence_type: Option<String>,
    #[serde(rename = "Manufacturer", skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(rename = "M0Type", skip_serializing_if = "Option::is_none")]
    pub m0_type: Option<String>,
    #[serde(rename = "M0_GMScaleFactor", skip_serializing_if = "Option::is_none")]
    pub m0_gm_scale_factor: Option<f64>,
    #[serde(rename = "ASLContext", skip_serializing_if = "Option::is_none")]
    pub asl_context: Option<String>,
    #[serde(rename = "DatasetType", skip_serializing_if = "Option::is_none")]
    pub dataset_type: Option<String>,
    #[serde(rename = "LabelingType", skip_serializing_if = "Option::is_none")]
    pub labeling_type: Option<String>,
    #[serde(
        rename = "DummyScanPositionInASL4D",
        skip_serializing_if = "Option::is_none"
    )]
    pub dummy_scan_position_in_asl4d: Option<Value>,
    #[serde(
        rename = "RepetitionTimePreparationM0",
        skip_serializing_if = "Option::is_none"
    )]
    pub repetition_time_preparation_m0: Option<Value>,
}

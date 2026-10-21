//! Current persisted configuration and its generated client contract.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct SchemaVersion;

impl TryFrom<u8> for SchemaVersion {
    type Error = &'static str;

    fn try_from(version: u8) -> Result<Self, Self::Error> {
        if version == 2 {
            Ok(Self)
        } else {
            Err("Project schema version is not supported; expected 2")
        }
    }
}

impl From<SchemaVersion> for u8 {
    fn from(_: SchemaVersion) -> Self {
        2
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectDocument {
    #[ts(type = "2")]
    pub schema_version: SchemaVersion,
    pub project_meta: ProjectMeta,
    pub mapping_state: MappingState,
    pub data_par: DataPar,
    pub ui_state: UiState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_opened: String,
    pub current_phase: ProjectPhase,
    pub data_source: DataSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ProjectPhase {
    Import,
    Parameters,
    Processing,
    Visualization,
    Manifest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum DataSource {
    Dicom,
    Bids,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PathPattern {
    pub signature: String,
    pub sample_path: String,
    pub blocks: Vec<String>,
    #[serde(deserialize_with = "deserialize_unique_names")]
    pub unique_names: BTreeMap<u32, Vec<String>>,
    #[ts(type = "number")]
    pub count: u64,
    #[ts(type = "number")]
    pub depth: u64,
}

fn deserialize_unique_names<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<u32, Vec<String>>, D::Error> {
    // Tagged edits buffer keys as strings; restore JSON's numeric map-key parsing.
    serde_json::from_value(Value::deserialize(deserializer)?).map_err(serde::de::Error::custom)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenAssignment {
    #[ts(type = "number")]
    pub block_index: u64,
    #[ts(type = "number | null")]
    pub sub_block_index: Option<u64>,
    pub tag: TokenTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum TokenTag {
    Subject,
    Session,
    Run,
    Modality,
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum Modality {
    T1w,
    T2w,
    ASL4D,
    M0,
    FLAIR,
    #[serde(rename = "WMH_SEGM")]
    WmhSegm,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ModalityAlias {
    pub captured: String,
    pub mapped: Option<Modality>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SessionAlias {
    pub captured: String,
    pub alias: String,
    #[ts(type = "number")]
    pub index: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SubjectRename {
    pub original: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubjectRow {
    pub id: String,
    pub subject: String,
    pub session: String,
    pub group_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataGroup {
    pub id: String,
    pub label: String,
    pub bids_params: BidsMetadata,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum NumberOrArray {
    Number(f64),
    Array(Vec<f64>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum M0Value {
    Mode(M0Mode),
    Number(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum M0Mode {
    #[serde(rename = "separate_scan")]
    SeparateScan,
    UseControlAsM0,
    Absent,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct MappingState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_data_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_patterns: Option<Vec<PathPattern>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b_match_directories: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingestion_complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokenizer_configs: Option<BTreeMap<String, Vec<TokenAssignment>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modality_aliases: Option<Vec<ModalityAlias>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_aliases: Option<Vec<SessionAlias>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_aliases: Option<Vec<SessionAlias>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_renames: Option<Vec<SubjectRename>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_groups: Option<Vec<MetadataGroup>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_rows: Option<Vec<SubjectRow>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportSnapshot {
    pub source_data_path: String,
    pub path_patterns: Vec<PathPattern>,
    pub tokenizer_configs: BTreeMap<String, Vec<TokenAssignment>>,
    pub b_match_directories: bool,
    pub modality_aliases: Vec<ModalityAlias>,
    pub session_aliases: Vec<SessionAlias>,
    pub run_aliases: Vec<SessionAlias>,
    pub subject_renames: Vec<SubjectRename>,
    pub metadata_groups: Vec<MetadataGroup>,
    pub subject_rows: Vec<SubjectRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub selected_profile_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(try_from = "u8", into = "u8")]
#[ts(type = "0 | 1")]
pub struct NumericFlag(u8);

impl TryFrom<u8> for NumericFlag {
    type Error = &'static str;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if value <= 1 {
            Ok(Self(value))
        } else {
            Err("Expected numeric 0 or 1")
        }
    }
}

impl From<NumericFlag> for u8 {
    fn from(value: NumericFlag) -> Self {
        value.0
    }
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(optional_fields)]
pub struct DataPar {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub M0: Option<M0Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BackgroundSuppressionNumberPulses: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BackgroundSuppressionPulseTime: Option<NumberOrArray>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub M0_GMScaleFactor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bRegisterM02ASL: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub M0_conventionalProcessing: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub RepetitionTimePreparationM0: Option<NumberOrArray>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nCompartments: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub Lambda: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T2art: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T1blood: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T1GM: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T1WM: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T2GM: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T2WM: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub T2tissueMultiTE: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bUseExternalQuantification: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ExternalQuantificationType: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ExternalQuantificationSmoothGaussianMM: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bMaskingExternal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bSpatialBASIL: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bInferT1BASIL: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bInferATTBASIL: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ExchBASIL: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub DispBASIL: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ATTSDBASIL: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bCleanUpExternal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub Quality: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub DELETETEMP: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SkipIfNoFlair: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SkipIfNoASL: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SkipIfNoM0: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enableMetadataGroupingCorrection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motionCorrection: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bTopUp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bPVCNativeSpace: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bPVCGaussianMM: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub PVCNativeSpaceKernel: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SaveCBF4D: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SpikeRemovalThreshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SpikeRemovalAbsoluteThreshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bRegistrationContrast: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bAffineRegistration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bDCTRegistration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bUseMNIasDummyStructural: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bHct2BloodT1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ApplyQuantification: Option<[f64; 6]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub Atlases: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub TissueMasking: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub TissueThreshold: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bMasking: Option<[NumericFlag; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub MinimalROIVolume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bWMH: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub DataTypes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bRunLongReg: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bRunDARTEL: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub WMHsegmAlg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bSegmentSPM12: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bHammersCAT12: Option<NumericFlag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bFixResolution: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bLesionFilling: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bAutoACPC: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bAutomaticallyDetectFSL: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bAutomaticallyDetectVABY: Option<bool>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum AslType {
    CASL,
    PCASL,
    PASL,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum AcquisitionType {
    #[serde(rename = "2D")]
    TwoD,
    #[serde(rename = "3D")]
    ThreeD,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum PcaslType {
    Balanced,
    Unbalanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum CaslType {
    #[serde(rename = "single-coil")]
    SingleCoil,
    #[serde(rename = "double-coil")]
    DoubleCoil,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum BolusCutOffTechnique {
    Q2TIPS,
    QUIPSS,
    QUIPSSII,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum M0Type {
    Separate,
    Included,
    Absent,
    Estimate,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(optional_fields)]
pub struct BidsMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ArterialSpinLabelingType: Option<AslType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub PostLabelingDelay: Option<NumberOrArray>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub MRAcquisitionType: Option<AcquisitionType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub MagneticFieldStrength: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub EchoTime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingDuration: Option<NumberOrArray>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub PCASLType: Option<PcaslType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub CASLType: Option<CaslType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingPulseAverageGradient: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingPulseMaximumGradient: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingPulseAverageB1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingPulseDuration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingPulseInterval: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BolusCutOffFlag: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BolusCutOffDelayTime: Option<NumberOrArray>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BolusCutOffTechnique: Option<BolusCutOffTechnique>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BackgroundSuppression: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BackgroundSuppressionNumberPulses: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub BackgroundSuppressionPulseTime: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub VascularCrushing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub RepetitionTimePreparation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub FlipAngle: Option<NumberOrArray>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub SliceTiming: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub PulseSequenceType: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub Manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub M0Type: Option<M0Type>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub M0_GMScaleFactor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ASLContext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub DatasetType: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub LabelingType: Option<AslType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub DummyScanPositionInASL4D: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub RepetitionTimePreparationM0: Option<Vec<f64>>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct ImportPreferences {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub active_step: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_profile_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct ImportUiState {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub active_step: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bids_review_confirmed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_subjects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_phase: Option<ExecutionPhase>,
    #[ts(optional = false)]
    pub most_recent_config: Option<ImportSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionPhase {
    Idle,
    Preparing,
    Running,
    Finalizing,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ProcessingModule {
    Structural,
    Asl,
    Population,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessingConfig {
    pub subjects: Vec<String>,
    pub modules: Vec<ProcessingModule>,
    pub selected_profile_id: String,
    #[ts(type = "number")]
    pub workers: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rerun_bids2_legacy: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct LastRun {
    pub profile_id: String,
    #[serde(rename = "exploreASLVersion", skip_serializing_if = "Option::is_none")]
    pub explore_asl_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matlab_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gui_version: Option<String>,
    #[serde(rename = "Mtime")]
    #[ts(type = "number | null", optional = false)]
    pub mtime: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct ModuleResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<LastRun>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct ProcessingUiState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<ProcessingConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_phase: Option<ExecutionPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structural: Option<ModuleResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asl: Option<ModuleResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub population: Option<ModuleResult>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdvancedVisibility {
    #[serde(default)]
    pub show_advanced_sections: bool,
    #[serde(default)]
    pub show_advanced_m0_params: bool,
    #[serde(default)]
    pub show_advanced_quantification: bool,
    #[serde(default)]
    pub show_advanced_general_settings: bool,
    #[serde(default)]
    #[serde(rename = "showAdvancedASLProcessing")]
    pub show_advanced_asl_processing: bool,
    #[serde(default)]
    pub show_advanced_atlases: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct DataParUiState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advanced_visibility: Option<AdvancedVisibility>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QcbfSource {
    pub relative_path: String,
    pub file_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalSource {
    pub absolute_path: String,
    pub file_hash: String,
    pub sheet_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct JoinKey {
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JoinConfig {
    pub external_source: ExternalSource,
    pub keys: Vec<JoinKey>,
    pub drop_right_on: bool,
    pub na_tokens: Vec<String>,
    pub delimiter: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Identifiers {
    pub subject: String,
    pub session: String,
    pub run: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AxisAssignment {
    pub x: Option<String>,
    pub y: Option<String>,
    pub color_by: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DomainFilters {
    pub x_min: Option<f64>,
    pub x_max: Option<f64>,
    pub y_min: Option<f64>,
    pub y_max: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct VisualizationConfig {
    #[ts(optional = false)]
    pub qcbf_source: Option<QcbfSource>,
    #[ts(optional = false)]
    pub join_config: Option<JoinConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_types: Option<BTreeMap<String, String>>,
    #[ts(optional = false)]
    pub identifiers: Option<Identifiers>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_orderings: Option<BTreeMap<String, Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis_assignment: Option<AxisAssignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain_filters: Option<DomainFilters>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filters_expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swarm_spacing: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_grid_x: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_grid_y: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_radiological: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_colorbar: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_crosshair: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_corner_orientation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_colormap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_slice_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nv_back_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_tick_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_tick_padding: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_tick_rotation: Option<f64>,
    #[ts(optional = false)]
    pub x_legend_override: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_legend_offset: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_tick_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_tick_padding: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_tick_rotation: Option<f64>,
    #[ts(optional = false)]
    pub y_legend_override: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_legend_offset: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reviewer {
    pub id: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum VerdictStatus {
    Pass,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum FailReason {
    Motion,
    Coverage,
    Dropout,
    Artifact,
    Registration,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct Verdict {
    pub status: VerdictStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<FailReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[ts(type = "number")]
    pub set_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestConfig {
    pub reviewers: Vec<Reviewer>,
    pub active_reviewer_id: String,
    #[serde(default)]
    pub verdicts: BTreeMap<String, BTreeMap<String, Verdict>>,
    #[serde(default)]
    pub resolved_verdicts: BTreeMap<String, Verdict>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct UiState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import: Option<ImportUiState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navbar_collapsed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing: Option<ProcessingUiState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datapar: Option<DataParUiState>,
    #[serde(rename = "dataVis", skip_serializing_if = "Option::is_none")]
    pub data_vis: Option<VisualizationConfig>,
    pub manifest: ManifestConfig,
}

/// Only user-owned settings/actions are admitted here. Execution results,
/// successful baselines, source kind and schema version are not user edits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProjectEdit {
    Import {
        mapping: MappingState,
        preferences: ImportPreferences,
    },
    Parameters {
        values: DataPar,
        visibility: AdvancedVisibility,
    },
    Processing {
        config: ProcessingConfig,
    },
    Visualization {
        config: VisualizationConfig,
    },
    Phase {
        phase: ProjectPhase,
    },
    Navbar {
        collapsed: bool,
    },
    AddReviewer,
    RemoveReviewer {
        id: String,
    },
    RenameReviewer {
        id: String,
        label: String,
    },
    ActiveReviewer {
        id: String,
    },
    Verdict {
        #[serde(rename = "subjectSession")]
        subject_session: String,
        #[serde(rename = "reviewerId")]
        reviewer_id: Option<String>,
        value: Option<Verdict>,
    },
    Resolution {
        #[serde(rename = "subjectSession")]
        subject_session: String,
        value: Option<Verdict>,
    },
    RelinkDicom {
        path: String,
        #[serde(rename = "rawPaths")]
        raw_paths: Vec<String>,
        patterns: Vec<PathPattern>,
        compatible: bool,
    },
    RelinkExternal {
        source: ExternalSource,
        compatible: bool,
    },
    ConfirmBids {
        groups: Vec<BidsReviewGroup>,
        skipped: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BidsReviewGroup {
    pub id: String,
    pub label: String,
    pub vendor: String,
    pub sequence: String,
    pub labeling_type: String,
    pub subjects: Vec<BidsReviewSubject>,
    pub bids_params: BidsMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BidsReviewSubject {
    pub subject_label: String,
    pub session_labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSnapshot {
    pub document: ProjectDocument,
    pub root_path: String,
    #[ts(type = "number")]
    pub activation_generation: u64,
    #[ts(type = "number")]
    pub accepted_revision: u64,
    #[ts(type = "number")]
    pub persisted_revision: u64,
    pub recovered_from_backup: bool,
    pub allowed_phases: Vec<ProjectPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recovery: Option<crate::import::relocation::RelocationRecoverySummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecentProjectIdentity {
    pub path: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectInspection {
    pub candidate_id: String,
    pub project_id: String,
    pub name: String,
    pub root_path: String,
    pub recovered_from_backup: bool,
    pub duplicate_path: Option<String>,
    pub moved_from: Option<String>,
    pub setup_recovered: usize,
}

//! Whole-project validation for the canonical persisted schema-v1 payload.
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub schema_version: String,
    pub name: String,
    pub project_id: String,
    pub data_source: String,
    pub content_hash: String,
}

fn json_object<'a>(
    value: &'a serde_json::Value,
    name: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>> {
    value
        .as_object()
        .ok_or_else(|| anyhow!("Project payload {name} must be an object"))
}
fn required_string(
    object: &serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<String> {
    object
        .get(name)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Project payload has invalid or missing {name}"))
}
fn no_unknown(
    object: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
    name: &str,
) -> Result<()> {
    if let Some(field) = object
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        bail!("Project payload {name} contains non-canonical field {field}");
    }
    Ok(())
}
fn required_value<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<&'a serde_json::Value> {
    object
        .get(name)
        .ok_or_else(|| anyhow!("Project payload has no {name}"))
}
fn optional_string(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<()> {
    if let Some(value) = object.get(name) {
        value
            .as_str()
            .ok_or_else(|| anyhow!("Project payload has invalid {name}"))?;
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn optional_bool(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<()> {
    if let Some(value) = object.get(name) {
        if !value.is_boolean() {
            bail!("Project payload has invalid {name}");
        }
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn optional_number(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<()> {
    if let Some(value) = object.get(name) {
        if !value.is_number() {
            bail!("Project payload has invalid {name}");
        }
    }
    Ok(())
}
fn optional_array<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<Option<&'a Vec<serde_json::Value>>> {
    object
        .get(name)
        .map(|value| {
            value
                .as_array()
                .ok_or_else(|| anyhow!("Project payload has invalid {name}"))
        })
        .transpose()
}
fn string_array(value: &serde_json::Value, name: &str) -> Result<()> {
    for entry in value
        .as_array()
        .ok_or_else(|| anyhow!("Project payload has invalid {name}"))?
    {
        if !entry.is_string() {
            bail!("Project payload has invalid {name}");
        }
    }
    Ok(())
}
fn stored_path(value: &serde_json::Value, name: &str) -> Result<()> {
    let path = value
        .as_str()
        .ok_or_else(|| anyhow!("Project payload has invalid {name}"))?;
    // Mirrors hasParentTraversal: absolute paths are allowed for external
    // DICOM sources; only relative values may not contain a parent segment.
    let absolute = path.starts_with('/')
        || (path.len() >= 3
            && path.as_bytes()[1] == b':'
            && matches!(path.as_bytes()[2], b'/' | b'\\'))
        || path.starts_with("//")
        || path.starts_with("\\\\");
    if !absolute && path.replace('\\', "/").split('/').any(|part| part == "..") {
        bail!("Project payload {name} escapes its root");
    }
    Ok(())
}
fn datetime(value: &str, name: &str) -> Result<()> {
    // Zod's datetime() default accepts RFC3339 UTC timestamps, not arbitrary
    // date strings or offsets. Parsing also rejects impossible calendar dates.
    if !value.ends_with('Z') || OffsetDateTime::parse(value, &Rfc3339).is_err() {
        bail!("Project payload has invalid {name}");
    }
    Ok(())
}
fn exact_object<'a>(
    value: &'a serde_json::Value,
    name: &str,
    fields: &[&str],
) -> Result<&'a serde_json::Map<String, serde_json::Value>> {
    let object = json_object(value, name)?;
    no_unknown(object, fields, name)?;
    Ok(object)
}
fn validate_token_assignment(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(value, name, &["blockIndex", "subBlockIndex", "tag"])?;
    let sub_block = required_value(object, "subBlockIndex")?;
    let valid_sub_block = sub_block.is_null() || sub_block.as_i64().is_some_and(|value| value >= 0);
    if required_value(object, "blockIndex")?
        .as_i64()
        .filter(|value| *value >= 0)
        .is_none()
        || !valid_sub_block
        || !matches!(
            required_value(object, "tag")?.as_str(),
            Some("Subject" | "Session" | "Run" | "Modality" | "Ignore")
        )
    {
        bail!("Project payload has invalid {name}");
    }
    Ok(())
}
fn validate_path_pattern(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(
        value,
        name,
        &[
            "signature",
            "samplePath",
            "blocks",
            "uniqueNames",
            "count",
            "depth",
        ],
    )?;
    for field in ["signature", "samplePath"] {
        required_value(object, field)?
            .as_str()
            .ok_or_else(|| anyhow!("Project payload has invalid {name}.{field}"))?;
    }
    string_array(required_value(object, "blocks")?, name)?;
    let unique = json_object(required_value(object, "uniqueNames")?, name)?;
    for values in unique.values() {
        string_array(values, name)?;
    }
    for field in ["count", "depth"] {
        if required_value(object, field)?
            .as_i64()
            .filter(|value| *value >= 1)
            .is_none()
        {
            bail!("Project payload has invalid {name}.{field}");
        }
    }
    Ok(())
}
fn validate_number_or_array(value: &serde_json::Value, name: &str, array_only: bool) -> Result<()> {
    let valid_number = value.is_number();
    let valid_array = value
        .as_array()
        .is_some_and(|entries| entries.iter().all(serde_json::Value::is_number));
    if !(valid_array || (!array_only && valid_number)) {
        bail!("Project payload has invalid {name}");
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn validate_bids_metadata(value: &serde_json::Value, name: &str) -> Result<()> {
    // BidsAslMetadataBaseSchema is passthrough. Validate each known field and
    // retain unknown BIDS fields unchanged, matching Zod's loose contract.
    let object = json_object(value, name)?;
    for field in [
        "MagneticFieldStrength",
        "EchoTime",
        "LabelingPulseAverageGradient",
        "LabelingPulseMaximumGradient",
        "LabelingPulseAverageB1",
        "LabelingPulseDuration",
        "LabelingPulseInterval",
        "BackgroundSuppressionNumberPulses",
        "RepetitionTimePreparation",
    ] {
        optional_number(object, field)?;
    }
    for field in [
        "ArterialSpinLabelingType",
        "MRAcquisitionType",
        "PCASLType",
        "CASLType",
        "BolusCutOffTechnique",
        "PulseSequenceType",
        "Manufacturer",
        "M0Type",
        "ASLContext",
        "DatasetType",
        "LabelingType",
    ] {
        optional_string(object, field)?;
    }
    for field in [
        "BolusCutOffFlag",
        "BackgroundSuppression",
        "VascularCrushing",
    ] {
        optional_bool(object, field)?;
    }
    for field in [
        "PostLabelingDelay",
        "LabelingDuration",
        "BolusCutOffDelayTime",
        "FlipAngle",
    ] {
        if let Some(value) = object.get(field) {
            validate_number_or_array(value, field, false)?;
        }
    }
    for field in [
        "BackgroundSuppressionPulseTime",
        "SliceTiming",
        "DummyScanPositionInASL4D",
        "RepetitionTimePreparationM0",
    ] {
        if let Some(value) = object.get(field) {
            validate_number_or_array(value, field, true)?;
        }
    }
    if let Some(value) = object.get("M0_GMScaleFactor") {
        if value.as_f64().filter(|number| *number > 0.0).is_none() {
            bail!("Project payload has invalid M0_GMScaleFactor");
        }
    }
    if let Some(value) = object.get("ArterialSpinLabelingType") {
        if !matches!(value.as_str(), Some("CASL" | "PCASL" | "PASL")) {
            bail!("Project payload has invalid ArterialSpinLabelingType");
        }
    }
    if let Some(value) = object.get("MRAcquisitionType") {
        if !matches!(value.as_str(), Some("2D" | "3D")) {
            bail!("Project payload has invalid MRAcquisitionType");
        }
    }
    if let Some(value) = object.get("PCASLType") {
        if !matches!(value.as_str(), Some("balanced" | "unbalanced")) {
            bail!("Project payload has invalid PCASLType");
        }
    }
    if let Some(value) = object.get("CASLType") {
        if !matches!(value.as_str(), Some("single-coil" | "double-coil")) {
            bail!("Project payload has invalid CASLType");
        }
    }
    if let Some(value) = object.get("BolusCutOffTechnique") {
        if !matches!(value.as_str(), Some("Q2TIPS" | "QUIPSS" | "QUIPSSII")) {
            bail!("Project payload has invalid BolusCutOffTechnique");
        }
    }
    if let Some(value) = object.get("M0Type") {
        if !matches!(
            value.as_str(),
            Some("Separate" | "Included" | "Absent" | "Estimate")
        ) {
            bail!("Project payload has invalid M0Type");
        }
    }
    if let Some(value) = object.get("LabelingType") {
        if !matches!(value.as_str(), Some("PASL" | "CASL" | "PCASL")) {
            bail!("Project payload has invalid LabelingType");
        }
    }
    // Refinements shared by metadata grouping and imported snapshots.
    if let Some(value) = object.get("BackgroundSuppressionNumberPulses") {
        if object
            .get("BackgroundSuppression")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
            && value.as_f64().is_some_and(|number| number <= 0.0)
        {
            bail!("Project payload has invalid BackgroundSuppressionNumberPulses");
        }
    }
    for field in [
        "PostLabelingDelay",
        "BolusCutOffDelayTime",
        "LabelingDuration",
    ] {
        if let Some(value) = object.get(field) {
            let values = value
                .as_array()
                .cloned()
                .unwrap_or_else(|| vec![value.clone()]);
            if values.iter().any(|entry| {
                entry
                    .as_f64()
                    .is_none_or(|number| number != 0.0 && !(0.01..=10.0).contains(&number))
            }) {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    Ok(())
}
fn validate_mapping(mapping: &serde_json::Value) -> Result<()> {
    let object = exact_object(
        mapping,
        "mappingState",
        &[
            "sourceDataPath",
            "rawPaths",
            "pathPatterns",
            "bMatchDirectories",
            "ingestionComplete",
            "tokenizerConfigs",
            "modalityAliases",
            "sessionAliases",
            "runAliases",
            "subjectRenames",
            "metadataGroups",
            "subjectRows",
        ],
    )?;
    if let Some(value) = object.get("sourceDataPath") {
        stored_path(value, "mappingState.sourceDataPath")?;
    }
    if let Some(paths) = optional_array(object, "rawPaths")? {
        for path in paths {
            stored_path(path, "mappingState.rawPaths")?;
        }
    }
    if let Some(patterns) = optional_array(object, "pathPatterns")? {
        for value in patterns {
            validate_path_pattern(value, "mappingState.pathPatterns")?;
        }
    }
    for field in ["bMatchDirectories", "ingestionComplete"] {
        optional_bool(object, field)?;
    }
    if let Some(configs) = object.get("tokenizerConfigs") {
        for values in json_object(configs, "mappingState.tokenizerConfigs")?.values() {
            for value in values.as_array().ok_or_else(|| {
                anyhow!("Project payload has invalid mappingState.tokenizerConfigs")
            })? {
                validate_token_assignment(value, "mappingState.tokenizerConfigs")?;
            }
        }
    }
    if let Some(values) = optional_array(object, "modalityAliases")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.modalityAliases",
                &["captured", "mapped"],
            )?;
            required_string(item, "captured")?;
            let mapped = required_value(item, "mapped")?;
            if !mapped.is_null()
                && !matches!(
                    mapped.as_str(),
                    Some("T1w" | "T2w" | "ASL4D" | "M0" | "FLAIR" | "WMH_SEGM")
                )
            {
                bail!("Project payload has invalid mappingState.modalityAliases");
            }
        }
    }
    for field in ["sessionAliases", "runAliases"] {
        if let Some(values) = optional_array(object, field)? {
            for value in values {
                let item = exact_object(value, field, &["captured", "alias", "index"])?;
                required_string(item, "captured")?;
                required_string(item, "alias")?;
                if required_value(item, "index")?
                    .as_i64()
                    .filter(|number| *number >= 1)
                    .is_none()
                {
                    bail!("Project payload has invalid {field}");
                }
            }
        }
    }
    if let Some(values) = optional_array(object, "subjectRenames")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.subjectRenames",
                &["original", "target"],
            )?;
            required_string(item, "original")?;
            required_string(item, "target")?;
        }
    }
    if let Some(values) = optional_array(object, "metadataGroups")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.metadataGroups",
                &["id", "label", "bidsParams"],
            )?;
            required_string(item, "id")?;
            required_string(item, "label")?;
            validate_bids_metadata(
                required_value(item, "bidsParams")?,
                "mappingState.metadataGroups.bidsParams",
            )?;
        }
    }
    if let Some(values) = optional_array(object, "subjectRows")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.subjectRows",
                &["id", "subject", "session", "groupId"],
            )?;
            for field in ["id", "subject", "session", "groupId"] {
                required_string(item, field)?;
            }
        }
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn validate_datapar(data_par: &serde_json::Value) -> Result<()> {
    // DataParSchema is loose: reject bad known values, preserve unknown keys.
    let object = json_object(data_par, "dataPar")?;
    for field in [
        "BackgroundSuppressionNumberPulses",
        "M0_GMScaleFactor",
        "nCompartments",
        "Lambda",
        "T2art",
        "T1blood",
        "T1GM",
        "T1WM",
        "T2GM",
        "T2WM",
        "T2tissueMultiTE",
        "ATTSDBASIL",
        "SpikeRemovalThreshold",
        "SpikeRemovalAbsoluteThreshold",
        "bRegistrationContrast",
        "bAffineRegistration",
        "bDCTRegistration",
        "bHct2BloodT1",
        "MinimalROIVolume",
    ] {
        optional_number(object, field)?;
    }
    for field in [
        "bUseExternalQuantification",
        "bMaskingExternal",
        "bSpatialBASIL",
        "bInferT1BASIL",
        "bInferATTBASIL",
        "bCleanUpExternal",
        "enableMetadataGroupingCorrection",
        "bTopUp",
        "bPVCGaussianMM",
        "SaveCBF4D",
        "bFixResolution",
        "bLesionFilling",
        "bAutoACPC",
        "bWMH",
        "bAutomaticallyDetectFSL",
        "bAutomaticallyDetectVABY",
    ] {
        optional_bool(object, field)?;
    }
    for field in [
        "ExternalQuantificationType",
        "ExchBASIL",
        "DispBASIL",
        "WMHsegmAlg",
    ] {
        optional_string(object, field)?;
    }
    for field in [
        "bRegisterM02ASL",
        "M0_conventionalProcessing",
        "Quality",
        "DELETETEMP",
        "SkipIfNoFlair",
        "SkipIfNoASL",
        "SkipIfNoM0",
        "motionCorrection",
        "bPVCNativeSpace",
        "bUseMNIasDummyStructural",
        "bRunLongReg",
        "bRunDARTEL",
        "bSegmentSPM12",
        "bHammersCAT12",
    ] {
        if let Some(value) = object.get(field) {
            if !matches!(value.as_i64(), Some(0 | 1)) {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    for field in [
        "BackgroundSuppressionPulseTime",
        "RepetitionTimePreparationM0",
    ] {
        if let Some(value) = object.get(field) {
            validate_number_or_array(value, field, false)?;
        }
    }
    if let Some(value) = object.get("M0") {
        if !(value.is_number()
            || matches!(
                value.as_str(),
                Some("separate_scan" | "UseControlAsM0" | "Absent")
            ))
        {
            bail!("Project payload has invalid M0");
        }
    }
    for field in ["ApplyQuantification", "TissueThreshold"] {
        if let Some(value) = object.get(field) {
            let values = value
                .as_array()
                .ok_or_else(|| anyhow!("Project payload has invalid {field}"))?;
            let expected = field == "ApplyQuantification" && values.len() != 6;
            if expected
                || values.iter().any(|entry| {
                    entry
                        .as_f64()
                        .is_none_or(|number| !(0.0..=1.0).contains(&number))
                })
            {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    for field in [
        "PVCNativeSpaceKernel",
        "ExternalQuantificationSmoothGaussianMM",
    ] {
        if let Some(value) = object.get(field) {
            let values = value
                .as_array()
                .ok_or_else(|| anyhow!("Project payload has invalid {field}"))?;
            if values.len() != 3
                || values.iter().any(|entry| {
                    !entry.is_number()
                        || (field == "ExternalQuantificationSmoothGaussianMM"
                            && entry.as_i64().is_none())
                })
            {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    if let Some(value) = object.get("bMasking") {
        let values = value
            .as_array()
            .ok_or_else(|| anyhow!("Project payload has invalid bMasking"))?;
        if values.len() != 4
            || values
                .iter()
                .any(|entry| !matches!(entry.as_i64(), Some(0 | 1)))
        {
            bail!("Project payload has invalid bMasking");
        }
    }
    for field in ["Atlases", "TissueMasking", "DataTypes"] {
        if let Some(value) = object.get(field) {
            string_array(value, field)?;
        }
    }
    Ok(())
}
fn validate_snapshot(encoded: &str) -> Result<()> {
    let compressed = BASE64
        .decode(encoded)
        .context("Project payload has invalid compressed snapshot encoding")?;
    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .context("Project payload has invalid compressed snapshot")?;
    let snapshot: serde_json::Value = serde_json::from_str(&json)
        .context("Project payload has invalid compressed snapshot JSON")?;
    let object = exact_object(
        &snapshot,
        "compressed snapshot",
        &[
            "sourceDataPath",
            "pathPatterns",
            "tokenizerConfigs",
            "bMatchDirectories",
            "modalityAliases",
            "sessionAliases",
            "runAliases",
            "subjectRenames",
            "metadataGroups",
            "subjectRows",
            "selectedProfileId",
        ],
    )?;
    stored_path(
        required_value(object, "sourceDataPath")?,
        "compressed snapshot.sourceDataPath",
    )?;
    validate_mapping(&serde_json::json!({
        "sourceDataPath": required_value(object, "sourceDataPath")?, "pathPatterns": required_value(object, "pathPatterns")?, "tokenizerConfigs": required_value(object, "tokenizerConfigs")?, "bMatchDirectories": required_value(object, "bMatchDirectories")?, "modalityAliases": required_value(object, "modalityAliases")?, "sessionAliases": required_value(object, "sessionAliases")?, "runAliases": required_value(object, "runAliases")?, "subjectRenames": required_value(object, "subjectRenames")?, "metadataGroups": required_value(object, "metadataGroups")?, "subjectRows": required_value(object, "subjectRows")?
    }))?;
    optional_string(object, "selectedProfileId")
}
#[allow(clippy::collapsible_if)]
fn validate_last_run(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(
        value,
        name,
        &[
            "profileId",
            "exploreASLVersion",
            "matlabVersion",
            "guiVersion",
            "Mtime",
        ],
    )?;
    required_string(object, "profileId")?;
    for field in ["exploreASLVersion", "matlabVersion", "guiVersion"] {
        optional_string(object, field)?;
    }
    if let Some(value) = object.get("Mtime") {
        if !(value.is_null() || value.as_i64().is_some()) {
            bail!("Project payload has invalid {name}.Mtime");
        }
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn validate_manifest_verdict(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(value, name, &["status", "reason", "notes", "setAt"])?;
    let status = required_string(object, "status")?;
    if !matches!(status.as_str(), "pass" | "fail") {
        bail!("Project payload has invalid {name}.status");
    }
    if status == "fail" && object.get("reason").is_none() {
        bail!("Project payload {name}.reason is required for failure");
    }
    if let Some(value) = object.get("reason") {
        if !matches!(
            value.as_str(),
            Some("motion" | "coverage" | "dropout" | "artifact" | "registration" | "other")
        ) {
            bail!("Project payload has invalid {name}.reason");
        }
    }
    if let Some(value) = object.get("notes") {
        if value.as_str().filter(|notes| notes.len() <= 500).is_none() {
            bail!("Project payload has invalid {name}.notes");
        }
    }
    if required_value(object, "setAt")?.as_i64().is_none() {
        bail!("Project payload has invalid {name}.setAt");
    }
    Ok(())
}
fn validate_data_vis(value: &serde_json::Value) -> Result<()> {
    // `dataVis` is loose, but its declared fields must retain the same types
    // as ProjectFileSchema. Unknown extensions are deliberately preserved.
    let object = json_object(value, "uiState.dataVis")?;
    if let Some(value) = object.get("qcbfSource")
        && !value.is_null()
    {
        let source = exact_object(
            value,
            "uiState.dataVis.qcbfSource",
            &["relativePath", "fileHash"],
        )?;
        stored_path(
            required_value(source, "relativePath")?,
            "uiState.dataVis.qcbfSource.relativePath",
        )?;
        required_string(source, "fileHash")?;
    }
    if let Some(value) = object.get("joinConfig")
        && !value.is_null()
    {
        let join = exact_object(
            value,
            "uiState.dataVis.joinConfig",
            &[
                "externalSource",
                "keys",
                "dropRightOn",
                "naTokens",
                "delimiter",
            ],
        )?;
        let source = exact_object(
            required_value(join, "externalSource")?,
            "uiState.dataVis.joinConfig.externalSource",
            &["absolutePath", "fileHash", "sheetName"],
        )?;
        required_string(source, "absolutePath")?;
        required_string(source, "fileHash")?;
        if !required_value(source, "sheetName")?.is_null()
            && !required_value(source, "sheetName")?.is_string()
        {
            bail!(
                "Project payload has invalid uiState.dataVis.joinConfig.externalSource.sheetName"
            );
        }
        for key in required_value(join, "keys")?
            .as_array()
            .ok_or_else(|| anyhow!("Project payload has invalid uiState.dataVis.joinConfig.keys"))?
        {
            let key = exact_object(key, "uiState.dataVis.joinConfig.keys", &["left", "right"])?;
            required_string(key, "left")?;
            required_string(key, "right")?;
        }
        if !required_value(join, "dropRightOn")?.is_boolean() {
            bail!("Project payload has invalid uiState.dataVis.joinConfig.dropRightOn");
        }
        string_array(
            required_value(join, "naTokens")?,
            "uiState.dataVis.joinConfig.naTokens",
        )?;
        required_string(join, "delimiter")?;
    }
    for field in ["columnTypes"] {
        if let Some(value) = object.get(field)
            && !json_object(value, "uiState.dataVis.columnTypes")?
                .values()
                .all(serde_json::Value::is_string)
        {
            bail!("Project payload has invalid uiState.dataVis.{field}");
        }
    }
    if let Some(value) = object.get("identifiers")
        && !value.is_null()
    {
        let identifiers = exact_object(
            value,
            "uiState.dataVis.identifiers",
            &["subject", "session", "run"],
        )?;
        for field in ["subject", "session", "run"] {
            required_string(identifiers, field)?;
        }
    }
    if let Some(value) = object.get("levelOrderings") {
        for value in json_object(value, "uiState.dataVis.levelOrderings")?.values() {
            string_array(value, "uiState.dataVis.levelOrderings")?;
        }
    }
    if let Some(value) = object.get("axisAssignment") {
        let axis = exact_object(
            value,
            "uiState.dataVis.axisAssignment",
            &["x", "y", "colorBy"],
        )?;
        for field in ["x", "y", "colorBy"] {
            if let Some(value) = axis.get(field)
                && !value.is_null()
                && !value.is_string()
            {
                bail!("Project payload has invalid uiState.dataVis.axisAssignment.{field}");
            }
        }
    }
    if let Some(value) = object.get("domainFilters") {
        let domain = exact_object(
            value,
            "uiState.dataVis.domainFilters",
            &["xMin", "xMax", "yMin", "yMax"],
        )?;
        for field in ["xMin", "xMax", "yMin", "yMax"] {
            if let Some(value) = domain.get(field)
                && !value.is_null()
                && !value.is_number()
            {
                bail!("Project payload has invalid uiState.dataVis.domainFilters.{field}");
            }
        }
    }
    optional_string(object, "stage")?;
    for field in [
        "splitRatio",
        "pointSize",
        "swarmSpacing",
        "chartOpacity",
        "xTickSize",
        "xTickPadding",
        "xTickRotation",
        "xLegendOffset",
        "yTickSize",
        "yTickPadding",
        "yTickRotation",
        "yLegendOffset",
    ] {
        optional_number(object, field)?;
    }
    for field in [
        "filtersExpanded",
        "showGridX",
        "showGridY",
        "nvRadiological",
        "nvColorbar",
        "nvCrosshair",
        "nvCornerOrientation",
    ] {
        optional_bool(object, field)?;
    }
    for field in ["nvColormap", "nvSliceType", "nvBackColor"] {
        optional_string(object, field)?;
    }
    for field in ["xLegendOverride", "yLegendOverride"] {
        if let Some(value) = object.get(field)
            && !value.is_null()
            && !value.is_string()
        {
            bail!("Project payload has invalid uiState.dataVis.{field}");
        }
    }
    Ok(())
}
fn validate_flat_verdicts(value: &serde_json::Value, name: &str) -> Result<()> {
    for verdict in json_object(value, name)?.values() {
        validate_manifest_verdict(verdict, name)?;
    }
    Ok(())
}
fn validate_ui_state(ui_state: &serde_json::Map<String, serde_json::Value>) -> Result<()> {
    optional_bool(ui_state, "navbarCollapsed")?;
    if let Some(import) = ui_state.get("import") {
        let import = exact_object(
            import,
            "uiState.import",
            &[
                "activeStep",
                "completed",
                "bidsReviewConfirmed",
                "skippedSubjects",
                "selectedProfileId",
                "currentPhase",
                "mostRecentConfig",
            ],
        )?;
        if let Some(value) = import.get("activeStep")
            && value.as_i64().filter(|number| *number >= 0).is_none()
        {
            bail!("Project payload has invalid uiState.import.activeStep");
        }
        optional_bool(import, "completed")?;
        optional_bool(import, "bidsReviewConfirmed")?;
        optional_string(import, "selectedProfileId")?;
        if let Some(value) = import.get("skippedSubjects") {
            string_array(value, "uiState.import.skippedSubjects")?;
        }
        if let Some(value) = import.get("currentPhase")
            && !matches!(
                value.as_str(),
                Some("idle" | "preparing" | "running" | "completed" | "failed" | "cancelled")
            )
        {
            bail!("Project payload has invalid uiState.import.currentPhase");
        }
        if let Some(value) = import.get("mostRecentConfig")
            && !value.is_null()
        {
            validate_snapshot(value.as_str().ok_or_else(|| {
                anyhow!("Project payload has invalid uiState.import.mostRecentConfig")
            })?)?;
        }
    }
    if let Some(processing) = ui_state.get("processing") {
        let processing = exact_object(
            processing,
            "uiState.processing",
            &["config", "currentPhase", "structural", "asl", "population"],
        )?;
        if let Some(config) = processing.get("config") {
            let config = exact_object(
                config,
                "uiState.processing.config",
                &[
                    "subjects",
                    "modules",
                    "selectedProfileId",
                    "workers",
                    "rerunBids2Legacy",
                ],
            )?;
            string_array(
                required_value(config, "subjects")?,
                "uiState.processing.config.subjects",
            )?;
            for module in required_value(config, "modules")?
                .as_array()
                .ok_or_else(|| {
                    anyhow!("Project payload has invalid uiState.processing.config.modules")
                })?
            {
                if !matches!(module.as_str(), Some("structural" | "asl" | "population")) {
                    bail!("Project payload has invalid uiState.processing.config.modules");
                }
            }
            required_string(config, "selectedProfileId")?;
            if required_value(config, "workers")?
                .as_i64()
                .filter(|number| *number >= 1)
                .is_none()
            {
                bail!("Project payload has invalid uiState.processing.config.workers");
            }
            optional_bool(config, "rerunBids2Legacy")?;
        }
        if let Some(value) = processing.get("currentPhase")
            && !matches!(
                value.as_str(),
                Some(
                    "idle"
                        | "preparing"
                        | "running"
                        | "finalizing"
                        | "cancelling"
                        | "completed"
                        | "failed"
                        | "cancelled"
                        | "interrupted"
                )
            )
        {
            bail!("Project payload has invalid uiState.processing.currentPhase");
        }
        for module in ["structural", "asl", "population"] {
            if let Some(value) = processing.get(module) {
                let item = exact_object(
                    value,
                    "uiState.processing.module",
                    &["completed", "lastRun"],
                )?;
                optional_bool(item, "completed")?;
                if let Some(last_run) = item.get("lastRun") {
                    validate_last_run(last_run, "uiState.processing.lastRun")?;
                }
            }
        }
    }
    if let Some(datapar) = ui_state.get("datapar") {
        let datapar = exact_object(datapar, "uiState.datapar", &["advancedVisibility"])?;
        if let Some(visibility) = datapar.get("advancedVisibility") {
            let visibility = exact_object(
                visibility,
                "uiState.datapar.advancedVisibility",
                &[
                    "showAdvancedSections",
                    "showAdvancedM0Params",
                    "showAdvancedQuantification",
                    "showAdvancedGeneralSettings",
                    "showAdvancedASLProcessing",
                    "showAdvancedAtlases",
                ],
            )?;
            for field in [
                "showAdvancedSections",
                "showAdvancedM0Params",
                "showAdvancedQuantification",
                "showAdvancedGeneralSettings",
                "showAdvancedASLProcessing",
                "showAdvancedAtlases",
            ] {
                optional_bool(visibility, field)?;
            }
        }
    }
    if let Some(data_vis) = ui_state.get("dataVis") {
        validate_data_vis(data_vis)?;
    }
    if let Some(manifest) = ui_state.get("manifest") {
        let manifest = exact_object(
            manifest,
            "uiState.manifest",
            &[
                "reviewers",
                "activeReviewerId",
                "verdicts",
                "resolvedVerdicts",
                "lastRunVersions",
                "lastPopulationRunMtime",
            ],
        )?;
        let reviewer_count = if let Some(reviewers) = optional_array(manifest, "reviewers")? {
            if reviewers.len() > 5 {
                bail!("Project payload has too many manifest reviewers");
            }
            for reviewer in reviewers {
                let reviewer = exact_object(
                    reviewer,
                    "uiState.manifest.reviewers",
                    &["id", "label", "createdAt"],
                )?;
                let id = required_string(reviewer, "id")?;
                uuid::Uuid::parse_str(&id)?;
                if required_string(reviewer, "label")?.len() > 100
                    || required_string(reviewer, "label")?.is_empty()
                {
                    bail!("Project payload has invalid reviewer label");
                }
                datetime(
                    &required_string(reviewer, "createdAt")?,
                    "reviewer.createdAt",
                )?;
            }
            reviewers.len()
        } else {
            0
        };
        if let Some(value) = manifest.get("activeReviewerId") {
            uuid::Uuid::parse_str(value.as_str().ok_or_else(|| {
                anyhow!("Project payload has invalid uiState.manifest.activeReviewerId")
            })?)?;
        }
        if let Some(verdicts) = manifest.get("verdicts") {
            let values = json_object(verdicts, "uiState.manifest.verdicts")?;
            let nested = values.values().all(|value| {
                value
                    .as_object()
                    .is_some_and(|object| !object.contains_key("status"))
            });
            if reviewer_count >= 2 {
                if !nested {
                    bail!("Project payload multi-reviewer verdicts must be nested");
                }
                for (reviewer, verdicts) in values {
                    uuid::Uuid::parse_str(reviewer)?;
                    validate_flat_verdicts(verdicts, "uiState.manifest.verdicts")?;
                }
            } else {
                if nested {
                    bail!("Project payload single-reviewer verdicts must be flat");
                }
                validate_flat_verdicts(verdicts, "uiState.manifest.verdicts")?;
            }
        }
        if let Some(value) = manifest.get("resolvedVerdicts") {
            validate_flat_verdicts(value, "uiState.manifest.resolvedVerdicts")?;
        }
        if let Some(value) = manifest.get("lastRunVersions") {
            let versions = exact_object(
                value,
                "uiState.manifest.lastRunVersions",
                &["exploreASL", "matlab", "gui"],
            )?;
            for field in ["exploreASL", "matlab", "gui"] {
                optional_string(versions, field)?;
            }
        }
        if let Some(value) = manifest.get("lastPopulationRunMtime")
            && !(value.is_null() || value.is_number())
        {
            bail!("Project payload has invalid uiState.manifest.lastPopulationRunMtime");
        }
    }
    Ok(())
}
/// Native boundary validation for the persisted v1 envelope. Renderer bytes
/// are accepted only if they are the exact recursively-sorted, two-space JSON
/// emitted by serializeProject and satisfy every non-loose persisted schema.
#[allow(clippy::collapsible_if)]
pub(crate) fn validate_canonical_project_v1(value: &serde_json::Value) -> Result<ProjectSummary> {
    let root = json_object(value, "envelope")?;
    no_unknown(
        root,
        &[
            "schemaVersion",
            "projectMeta",
            "uiState",
            "mappingState",
            "dataPar",
        ],
        "envelope",
    )?;
    if root
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        bail!("Project payload must use canonical schema version 1");
    }
    let meta_value = root
        .get("projectMeta")
        .ok_or_else(|| anyhow!("Project payload has no projectMeta"))?;
    let meta = json_object(meta_value, "projectMeta")?;
    no_unknown(
        meta,
        &[
            "id",
            "name",
            "createdAt",
            "lastOpened",
            "currentPhase",
            "dataSource",
        ],
        "projectMeta",
    )?;
    let id = required_string(meta, "id")?;
    let name = required_string(meta, "name")?;
    required_string(meta, "createdAt")?;
    required_string(meta, "lastOpened")?;
    let phase = required_string(meta, "currentPhase")?;
    if ![
        "import",
        "parameters",
        "processing",
        "visualization",
        "manifest",
    ]
    .contains(&phase.as_str())
    {
        bail!("Project payload has invalid projectMeta.currentPhase");
    }
    let data_source = required_string(meta, "dataSource")?;
    if !["bids", "dicom"].contains(&data_source.as_str()) {
        bail!("Project payload has invalid projectMeta.dataSource");
    }
    let ui_state = root
        .get("uiState")
        .ok_or_else(|| anyhow!("Project payload has no uiState"))?;
    // ProjectFileSchema deliberately uses `.passthrough()` for uiState; known
    // descendants remain validated while future top-level UI data survives.
    let ui_state = json_object(ui_state, "uiState")?;
    validate_ui_state(ui_state)?;
    let mapping = root
        .get("mappingState")
        .ok_or_else(|| anyhow!("Project payload has no mappingState"))?;
    validate_mapping(mapping)?;
    let data_par = root
        .get("dataPar")
        .ok_or_else(|| anyhow!("Project payload has no dataPar"))?;
    validate_datapar(data_par)?;
    Ok(ProjectSummary {
        schema_version: "1".into(),
        name,
        project_id: id,
        data_source,
        content_hash: String::new(),
    })
}
pub(crate) fn parse_summary(bytes: &[u8]) -> Result<ProjectSummary> {
    let input = std::str::from_utf8(bytes).context("Project payload is not UTF-8")?;
    let value: serde_json::Value =
        serde_json::from_slice(bytes).context("Project payload is not valid JSON")?;
    let canonical =
        serde_json::to_string_pretty(&value).context("Could not canonicalize project payload")?;
    if input != canonical {
        bail!(
            "Project payload must use exact canonical two-space JSON bytes without a trailing newline"
        );
    }
    let mut summary = validate_canonical_project_v1(&value)?;
    summary.content_hash = format!("{:x}", Sha256::digest(bytes));
    Ok(summary)
}

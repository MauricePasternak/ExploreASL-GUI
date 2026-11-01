//! Current-only typed parsing and domain checks. No project migration occurs.
use super::model::*;
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub schema_version: String,
    pub name: String,
    pub project_id: String,
    pub data_source: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, thiserror::Error, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectParseError {
    #[error("Project configuration is malformed: {message}")]
    Malformed { message: String, details: String },
    #[error("Project schema is not supported: {message}")]
    Unsupported { message: String, details: String },
}

fn malformed(message: impl Into<String>) -> ProjectParseError {
    let message = message.into();
    ProjectParseError::Malformed {
        details: message.clone(),
        message,
    }
}

pub fn parse_document(bytes: &[u8]) -> Result<ProjectDocument, ProjectParseError> {
    let envelope: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| malformed("Expected a JSON project object"))?;
    let object = envelope
        .as_object()
        .ok_or_else(|| malformed("Expected a project object"))?;
    match object.get("schemaVersion") {
        Some(serde_json::Value::Number(version)) if version.as_u64() == Some(2) => {}
        Some(serde_json::Value::Number(version)) if version.is_i64() || version.is_u64() => {
            return Err(ProjectParseError::Unsupported {
                message: format!("Schema version {version}; create a project with this build"),
                details: format!("Schema version {version}; create a project with this build"),
            });
        }
        None if object.contains_key("version") => {
            return Err(ProjectParseError::Unsupported {
                message: "Legacy application-version envelope; create a project with this build"
                    .into(),
                details: "Legacy application-version envelope; create a project with this build"
                    .into(),
            });
        }
        _ => return Err(malformed("schemaVersion must be integer 2")),
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let document: ProjectDocument = serde_path_to_error::deserialize(&mut deserializer)
        .map_err(|error| malformed(format!("Invalid field at {}", error.path())))?;
    validate_document(&document).map_err(|error| malformed(error.to_string()))?;
    Ok(document)
}

pub(crate) fn validate_document(document: &ProjectDocument) -> Result<()> {
    validate_mapping(&document.mapping_state)?;
    if document.project_meta.data_source == DataSource::Bids
        && document
            .mapping_state
            .source_data_path
            .as_deref()
            .is_some_and(|path| path != ".")
    {
        bail!("mappingState.sourceDataPath must be . for BIDS");
    }
    let parameters = &document.data_par;
    if parameters
        .ApplyQuantification
        .as_ref()
        .is_some_and(|values| values.iter().any(|value| !(0.0..=1.0).contains(value)))
    {
        bail!("dataPar.ApplyQuantification must contain values between 0 and 1");
    }
    if parameters
        .TissueThreshold
        .as_ref()
        .is_some_and(|values| values.iter().any(|value| !(0.0..=1.0).contains(value)))
    {
        bail!("dataPar.TissueThreshold must contain values between 0 and 1");
    }
    if let Some(import) = &document.ui_state.import
        && let Some(snapshot) = &import.most_recent_config
    {
        validate_import_snapshot(snapshot)?;
    }
    if let Some(processing) = &document.ui_state.processing
        && let Some(config) = &processing.config
        && config.workers == 0
    {
        bail!("uiState.processing.config.workers must be >= 1");
    }
    if let Some(visualization) = &document.ui_state.data_vis {
        if let Some(source) = &visualization.qcbf_source {
            stored_path(
                &source.relative_path,
                "uiState.dataVis.qcbfSource.relativePath",
                false,
            )?;
        }
        if let Some(join) = &visualization.join_config
            && !absolute_path(&join.external_source.absolute_path)
        {
            bail!("uiState.dataVis.joinConfig.externalSource.absolutePath must be absolute");
        }
    }
    validate_manifest(&document.ui_state.manifest)
}

pub(crate) fn validate_import_snapshot(snapshot: &ImportSnapshot) -> Result<()> {
    stored_path(
        &snapshot.source_data_path,
        "uiState.import.mostRecentConfig.sourceDataPath",
        true,
    )?;
    patterns(
        &snapshot.path_patterns,
        "uiState.import.mostRecentConfig.pathPatterns",
    )?;
    for alias in snapshot.session_aliases.iter().chain(&snapshot.run_aliases) {
        if alias.index == 0 {
            bail!("uiState.import.mostRecentConfig aliases require index >= 1");
        }
    }
    for group in &snapshot.metadata_groups {
        validate_metadata(&group.bids_params)?;
    }
    Ok(())
}

pub(crate) fn absolute_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("\\\\")
        || (path.len() >= 3
            && path.as_bytes()[1] == b':'
            && matches!(path.as_bytes()[2], b'/' | b'\\'))
}

fn stored_path(path: &str, field: &str, allow_absolute: bool) -> Result<()> {
    if absolute_path(path) {
        if !allow_absolute {
            bail!("{field} must be relative");
        }
    } else if path.replace('\\', "/").split('/').any(|part| part == "..") {
        bail!("{field} escapes its root");
    }
    Ok(())
}

fn patterns(values: &[PathPattern], field: &str) -> Result<()> {
    if values
        .iter()
        .any(|value| value.count == 0 || value.depth == 0)
    {
        bail!("{field} count and depth must be >= 1");
    }
    Ok(())
}

fn validate_mapping(mapping: &MappingState) -> Result<()> {
    if let Some(path) = &mapping.source_data_path {
        stored_path(path, "mappingState.sourceDataPath", true)?;
    }
    if let Some(paths) = &mapping.raw_paths {
        for path in paths {
            stored_path(path, "mappingState.rawPaths", false)?;
        }
    }
    if let Some(values) = &mapping.path_patterns {
        patterns(values, "mappingState.pathPatterns")?;
    }
    for alias in mapping
        .session_aliases
        .iter()
        .flatten()
        .chain(mapping.run_aliases.iter().flatten())
    {
        if alias.index == 0 {
            bail!("mappingState aliases require index >= 1");
        }
    }
    for group in mapping.metadata_groups.iter().flatten() {
        validate_metadata(&group.bids_params)?;
    }
    Ok(())
}

fn values(value: &NumberOrArray) -> &[f64] {
    match value {
        NumberOrArray::Number(value) => std::slice::from_ref(value),
        NumberOrArray::Array(values) => values,
    }
}

pub(crate) fn validate_metadata(metadata: &BidsMetadata) -> Result<()> {
    if let Some(context) = &metadata.ASLContext {
        let tokens = context
            .split(',')
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .collect::<Vec<_>>();
        if tokens.is_empty()
            || tokens
                .iter()
                .any(|token| !matches!(*token, "control" | "label" | "m0scan" | "deltam"))
        {
            bail!("bidsParams.ASLContext must contain control, label, m0scan or deltam tokens");
        }
    }
    if metadata.M0_GMScaleFactor.is_some_and(|value| value <= 0.0) {
        bail!("bidsParams.M0_GMScaleFactor must be positive");
    }
    if metadata.BackgroundSuppression == Some(true)
        && metadata
            .BackgroundSuppressionNumberPulses
            .is_some_and(|value| value <= 0.0)
    {
        bail!(
            "bidsParams.BackgroundSuppressionNumberPulses must be positive when suppression is enabled"
        );
    }
    for (field, setting) in [
        ("PostLabelingDelay", &metadata.PostLabelingDelay),
        ("LabelingDuration", &metadata.LabelingDuration),
        ("BolusCutOffDelayTime", &metadata.BolusCutOffDelayTime),
    ] {
        if let Some(setting) = setting
            && values(setting)
                .iter()
                .any(|value| *value != 0.0 && !(0.01..=10.0).contains(value))
        {
            bail!("bidsParams.{field} must be 0 or between 0.01 and 10 seconds");
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &ManifestConfig) -> Result<()> {
    if !(1..=5).contains(&manifest.reviewers.len()) {
        bail!("uiState.manifest.reviewers requires one to five entries");
    }
    let mut ids = BTreeSet::new();
    for (index, reviewer) in manifest.reviewers.iter().enumerate() {
        if uuid::Uuid::parse_str(&reviewer.id).is_err() || !ids.insert(reviewer.id.as_str()) {
            bail!("uiState.manifest.reviewers[{index}].id must be a unique UUID");
        }
        if reviewer.label.is_empty() || reviewer.label.chars().count() > 100 {
            bail!("uiState.manifest.reviewers[{index}].label requires 1 to 100 Unicode characters");
        }
        if !reviewer.created_at.ends_with('Z')
            || OffsetDateTime::parse(&reviewer.created_at, &Rfc3339).is_err()
        {
            bail!("uiState.manifest.reviewers[{index}].createdAt must be a UTC timestamp");
        }
    }
    if !ids.contains(manifest.active_reviewer_id.as_str()) {
        bail!("uiState.manifest.activeReviewerId must be registered");
    }
    for (id, verdicts) in &manifest.verdicts {
        if !ids.contains(id.as_str()) {
            bail!("uiState.manifest.verdicts.{id} reviewer is not registered");
        }
        for (key, verdict) in verdicts {
            validate_verdict(verdict, &format!("uiState.manifest.verdicts.{id}.{key}"))?;
        }
    }
    for (key, verdict) in &manifest.resolved_verdicts {
        validate_verdict(verdict, &format!("uiState.manifest.resolvedVerdicts.{key}"))?;
    }
    Ok(())
}

pub(crate) fn validate_verdict(verdict: &Verdict, field: &str) -> Result<()> {
    if verdict.status == VerdictStatus::Fail && verdict.reason.is_none() {
        bail!("{field}.reason is required when status is fail");
    }
    if verdict
        .notes
        .as_ref()
        .is_some_and(|notes| notes.chars().count() > 500)
    {
        bail!("{field}.notes exceeds 500 Unicode characters");
    }
    Ok(())
}

pub(crate) fn parse_summary(bytes: &[u8]) -> Result<ProjectSummary> {
    let document = parse_document(bytes)?;
    Ok(ProjectSummary {
        schema_version: "2".into(),
        name: document.project_meta.name,
        project_id: document.project_meta.id,
        data_source: match document.project_meta.data_source {
            DataSource::Bids => "bids",
            DataSource::Dicom => "dicom",
        }
        .into(),
        content_hash: hex::encode(Sha256::digest(bytes)),
    })
}

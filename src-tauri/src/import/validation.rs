use super::output::cleanup_staging_root;
use super::staging::{StagingEntry, portable_key};
use anyhow::{Result as AnyResult, anyhow, bail};
use std::collections::BTreeMap;
use std::path::Path;

pub fn rollback_preparation_failure(staging_root: &Path, error: String) -> String {
    let _ = cleanup_staging_root(staging_root);
    error
}

pub fn validate_staging_root(staging_root: &Path) -> AnyResult<()> {
    if staging_root.file_name().and_then(|name| name.to_str()) != Some(".easl_staging") {
        bail!(
            "staging_root must end with .easl_staging: {}",
            staging_root.display()
        );
    }

    Ok(())
}

pub fn validate_non_empty_inputs(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> AnyResult<()> {
    if staging_entries.is_empty() {
        bail!("staging_entries must contain at least one staging entry");
    }
    if subject_list.is_empty() {
        bail!("subject_list must contain at least one subject");
    }

    Ok(())
}

pub fn validate_subject_scope(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> AnyResult<()> {
    let mut staging_subjects = BTreeMap::new();
    for entry in staging_entries {
        staging_subjects
            .entry(portable_key(&entry.subject))
            .or_insert_with(|| entry.subject.clone());
    }

    let mut declared_subjects = BTreeMap::new();
    for subject in subject_list {
        declared_subjects
            .entry(portable_key(subject))
            .or_insert_with(|| subject.clone());
    }

    let undeclared = staging_subjects
        .iter()
        .filter(|(key, _)| !declared_subjects.contains_key(*key))
        .map(|(_, subject)| subject.as_str())
        .collect::<Vec<_>>();
    let missing = declared_subjects
        .iter()
        .filter(|(key, _)| !staging_subjects.contains_key(*key))
        .map(|(_, subject)| subject.as_str())
        .collect::<Vec<_>>();

    if undeclared.is_empty() && missing.is_empty() {
        return Ok(());
    }

    let mut details = Vec::new();
    if !undeclared.is_empty() {
        details.push(format!(
            "undeclared staging subjects: {}",
            undeclared.join(", ")
        ));
    }
    if !missing.is_empty() {
        details.push(format!(
            "declared subjects without staging entries: {}",
            missing.join(", ")
        ));
    }

    bail!("Import subject scope mismatch: {}", details.join("; "))
}

pub fn validate_import_request_inputs(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> AnyResult<()> {
    validate_non_empty_inputs(staging_entries, subject_list)?;
    validate_subject_scope(staging_entries, subject_list)
}

pub(super) fn normalize_staging_subject_spelling(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> AnyResult<Vec<StagingEntry>> {
    let mut owned_by_key = BTreeMap::new();
    for subject in subject_list {
        let key = portable_key(subject);
        if owned_by_key.insert(key, subject.as_str()).is_some() {
            bail!("Import subject list contains portable-equivalent duplicates");
        }
    }

    staging_entries
        .iter()
        .map(|entry| {
            let canonical = owned_by_key
                .get(&portable_key(&entry.subject))
                .ok_or_else(|| {
                    anyhow!(
                        "Staging entry subject is not in the declared import scope: {}",
                        entry.subject
                    )
                })?;
            let mut normalized = entry.clone();
            normalized.subject = (*canonical).to_string();
            Ok(normalized)
        })
        .collect()
}

pub use crate::execution_managed::{find_executable_on_path, validate_matlab_executable};

use anyhow::{Context, Result as AnyResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use crate::app::state::AppState;

pub const STAGING_DIRECTORY: &str = ".easl_staging";
pub const MODALITIES: [&str; 6] = ["T1w", "T2w", "ASL4D", "M0", "FLAIR", "WMH_SEGM"];

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StagingEntry {
    pub subject: String,
    pub session: String,
    /// Raw GUI Run folder. ExploreASL resolves it through tokenSessionAliases.
    pub run: String,
    pub run_alias: String,
    pub modality: String,
    pub original_subject: String,
    pub original_session: String,
    pub original_run: String,
    pub source_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StagingIssueCode {
    EmptyComponent,
    TraversalComponent,
    AbsoluteComponent,
    SeparatorComponent,
    ControlComponent,
    ForbiddenCharacter,
    TrailingDotOrSpace,
    NonNfcComponent,
    ReservedBasename,
    InvalidSubject,
    InvalidModality,
    PortableCollision,
    DuplicateSource,
    SourceMissing,
    SourceUnreadable,
    SourceInsideStaging,
    StagingRootSymlink,
    DestinationSymlink,
    NoActiveProject,
    DestinationOutsideStaging,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum StagingField {
    Subject,
    Session,
    Run,
    RunAlias,
    Modality,
    SourcePath,
    Destination,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagingValidationIssue {
    pub code: StagingIssueCode,
    pub field: StagingField,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub entry_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub conflicting_entry_index: Option<usize>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StagingPreflightResult {
    pub valid: bool,
    pub issues: Vec<StagingValidationIssue>,
}

#[derive(Clone, Debug)]
pub struct CompiledFileRecord {
    pub source: PathBuf,
    pub destination: PathBuf,
}

#[derive(Clone, Debug)]
pub struct CompiledStagingPlan {
    pub staging_root: PathBuf,
    pub records: Vec<CompiledFileRecord>,
}

pub fn portable_key(value: &str) -> String {
    value.nfc().case_fold().collect()
}

fn component_error(value: &str) -> Option<(StagingIssueCode, &'static str)> {
    if value.is_empty() {
        return Some((
            StagingIssueCode::EmptyComponent,
            "Identifier must not be empty.",
        ));
    }
    if matches!(value, "." | "..") {
        return Some((
            StagingIssueCode::TraversalComponent,
            "Identifier must not be a traversal component.",
        ));
    }
    if Path::new(value).is_absolute()
        || (value.len() >= 3
            && value.as_bytes()[0].is_ascii_alphabetic()
            && value.as_bytes()[1] == b':'
            && matches!(value.as_bytes()[2], b'/' | b'\\'))
    {
        return Some((
            StagingIssueCode::AbsoluteComponent,
            "Identifier must not be absolute.",
        ));
    }
    if value.contains('/') || value.contains('\\') {
        return Some((
            StagingIssueCode::SeparatorComponent,
            "Identifier must not contain a path separator.",
        ));
    }
    if value.chars().any(char::is_control) {
        return Some((
            StagingIssueCode::ControlComponent,
            "Identifier must not contain a control character.",
        ));
    }
    if value
        .chars()
        .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Some((
            StagingIssueCode::ForbiddenCharacter,
            "Identifier contains a Windows-forbidden character.",
        ));
    }
    if value.ends_with('.') || value.ends_with(' ') {
        return Some((
            StagingIssueCode::TrailingDotOrSpace,
            "Identifier must not end with a period or space.",
        ));
    }
    if value.nfc().collect::<String>() != value {
        return Some((
            StagingIssueCode::NonNfcComponent,
            "Identifier must already use NFC normalization.",
        ));
    }
    let basename = value.split('.').next().unwrap_or(value);
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "CLOCK$", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
        "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
        "LPT9", "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³",
    ];
    if reserved
        .iter()
        .any(|reserved| portable_key(basename) == portable_key(reserved))
    {
        return Some((
            StagingIssueCode::ReservedBasename,
            "Identifier uses a reserved Windows device basename.",
        ));
    }
    None
}

#[cfg(test)]
pub fn validate_component(value: &str) -> Result<(), StagingIssueCode> {
    component_error(value).map_or(Ok(()), |(code, _)| Err(code))
}

fn issue(
    code: StagingIssueCode,
    field: StagingField,
    entry_index: Option<usize>,
    message: impl Into<String>,
) -> StagingValidationIssue {
    StagingValidationIssue {
        code,
        field,
        entry_index,
        conflicting_entry_index: None,
        message: message.into(),
        suggestion: None,
    }
}

fn add_component_issue(
    issues: &mut Vec<StagingValidationIssue>,
    value: &str,
    field: StagingField,
    index: usize,
) -> bool {
    if let Some((code, message)) = component_error(value) {
        issues.push(issue(code, field, Some(index), message));
        return false;
    }
    true
}

fn is_inside(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn add_pair_issue(
    issues: &mut Vec<StagingValidationIssue>,
    code: StagingIssueCode,
    field: StagingField,
    left: usize,
    right: usize,
    message: &str,
) {
    for (entry_index, conflicting_entry_index) in [(left, right), (right, left)] {
        issues.push(StagingValidationIssue {
            code: code.clone(),
            field: field.clone(),
            entry_index: Some(entry_index),
            conflicting_entry_index: Some(conflicting_entry_index),
            message: message.to_string(),
            suggestion: None,
        });
    }
}

fn sort_and_deduplicate(issues: &mut Vec<StagingValidationIssue>) {
    issues.sort_by(|left, right| {
        (
            left.entry_index.unwrap_or(usize::MAX),
            &left.field,
            &left.code,
            left.conflicting_entry_index.unwrap_or(usize::MAX),
        )
            .cmp(&(
                right.entry_index.unwrap_or(usize::MAX),
                &right.field,
                &right.code,
                right.conflicting_entry_index.unwrap_or(usize::MAX),
            ))
    });
    issues.dedup_by(|left, right| {
        left.code == right.code
            && left.field == right.field
            && left.entry_index == right.entry_index
            && left.conflicting_entry_index == right.conflicting_entry_index
    });
}

fn validation_result(mut issues: Vec<StagingValidationIssue>) -> StagingPreflightResult {
    sort_and_deduplicate(&mut issues);
    StagingPreflightResult {
        valid: issues.is_empty(),
        issues,
    }
}

fn root_for_active_project(
    active_project_root: Option<PathBuf>,
) -> Result<(PathBuf, PathBuf), StagingPreflightResult> {
    let Some(active_project_root) = active_project_root else {
        return Err(validation_result(vec![issue(
            StagingIssueCode::NoActiveProject,
            StagingField::Destination,
            None,
            "No active project is registered.",
        )]));
    };
    let canonical_project = match fs::canonicalize(&active_project_root) {
        Ok(path) => path,
        Err(error) => {
            return Err(validation_result(vec![issue(
                StagingIssueCode::NoActiveProject,
                StagingField::Destination,
                None,
                format!("Failed to canonicalize active project root: {error}"),
            )]));
        }
    };
    let expected_root = canonical_project.join(STAGING_DIRECTORY);
    if fs::symlink_metadata(&expected_root)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(validation_result(vec![issue(
            StagingIssueCode::StagingRootSymlink,
            StagingField::Destination,
            None,
            "Staging root must not be a symlink.",
        )]));
    }
    Ok((canonical_project, expected_root))
}

fn existing_destination_component_is_symlink(
    staging_root: &Path,
    destination: &Path,
) -> Result<bool, String> {
    let relative = destination.strip_prefix(staging_root).map_err(|_| {
        format!(
            "Destination is not below staging root: {}",
            destination.display()
        )
    })?;
    let mut component_path = staging_root.to_path_buf();
    for component in relative.components() {
        component_path.push(component);
        match fs::symlink_metadata(&component_path) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to inspect destination component {}: {error}",
                    component_path.display()
                ));
            }
        }
    }
    Ok(false)
}

fn validate_destination_confinement(
    staging_root: &Path,
    destination_base: &Path,
    destination: &Path,
) -> Result<(), (StagingIssueCode, String)> {
    if !destination.starts_with(destination_base) {
        return Err((
            StagingIssueCode::DestinationOutsideStaging,
            "Destination escapes the staging source root.".to_string(),
        ));
    }
    if existing_destination_component_is_symlink(staging_root, destination)
        .map_err(|error| (StagingIssueCode::DestinationOutsideStaging, error))?
    {
        return Err((
            StagingIssueCode::DestinationSymlink,
            "Destination contains an existing symlink component.".to_string(),
        ));
    }

    if !destination_base.exists() {
        return Ok(());
    }
    let canonical_staging_root = fs::canonicalize(staging_root).map_err(|error| {
        (
            StagingIssueCode::DestinationOutsideStaging,
            format!("Failed to canonicalize staging root: {error}"),
        )
    })?;
    let canonical_destination_base = canonical_staging_root.join("sourcedata");
    let nearest_existing_destination_parent = destination
        .ancestors()
        .take_while(|path| path.starts_with(destination_base))
        .find(|path| path.exists());
    if let Some(parent) = nearest_existing_destination_parent {
        let canonical_parent = fs::canonicalize(parent).map_err(|error| {
            (
                StagingIssueCode::DestinationOutsideStaging,
                format!("Failed to resolve destination parent: {error}"),
            )
        })?;
        if !is_inside(&canonical_parent, &canonical_destination_base) {
            return Err((
                StagingIssueCode::DestinationOutsideStaging,
                "Destination parent escapes the staging source root.".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_file_destination(
    staging_root: &Path,
    destination_base: &Path,
    destination: &Path,
    source: &Path,
) -> Result<(), (StagingIssueCode, String)> {
    // Prior runs stage file symlinks. Only an exact source match is expected;
    // directory links remain forbidden, and execution cleans staging first.
    let matching_file_link = fs::symlink_metadata(destination)
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
        && fs::canonicalize(destination).is_ok_and(|target| target == source);
    let path_to_validate = if matching_file_link {
        destination.parent().unwrap_or(destination)
    } else {
        destination
    };
    validate_destination_confinement(staging_root, destination_base, path_to_validate)
}

pub fn compile_staging_plan(
    active_project_root: Option<PathBuf>,
    entries: &[StagingEntry],
) -> Result<CompiledStagingPlan, StagingPreflightResult> {
    let (_project_root, staging_root) = root_for_active_project(active_project_root)?;
    let destination_base = staging_root.join("sourcedata");
    let mut issues = Vec::new();
    let mut usable = Vec::new();

    for (index, entry) in entries.iter().enumerate() {
        let subject_ok =
            add_component_issue(&mut issues, &entry.subject, StagingField::Subject, index);
        let session_ok =
            add_component_issue(&mut issues, &entry.session, StagingField::Session, index);
        let run_ok = add_component_issue(&mut issues, &entry.run, StagingField::Run, index);
        let run_alias_ok =
            add_component_issue(&mut issues, &entry.run_alias, StagingField::RunAlias, index);
        let modality_ok =
            add_component_issue(&mut issues, &entry.modality, StagingField::Modality, index);
        if subject_ok
            && (!entry
                .subject
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric())
                || entry.subject.starts_with("sub-"))
        {
            issues.push(issue(
                StagingIssueCode::InvalidSubject,
                StagingField::Subject,
                Some(index),
                "Subject must be ASCII alphanumeric and must not include the sub- prefix.",
            ));
        }
        if modality_ok && !MODALITIES.contains(&entry.modality.as_str()) {
            issues.push(issue(
                StagingIssueCode::InvalidModality,
                StagingField::Modality,
                Some(index),
                "Modality is not supported by ExploreASL.",
            ));
        }
        if entry.original_subject.is_empty()
            || entry.original_session.is_empty()
            || entry.original_run.is_empty()
        {
            issues.push(issue(
                StagingIssueCode::TraversalComponent,
                StagingField::Destination,
                Some(index),
                "Original logical provenance must not be empty.",
            ));
        }
        if subject_ok && session_ok && run_ok && run_alias_ok && modality_ok {
            usable.push(index);
        }
    }

    let mut records = Vec::new();
    let mut source_entries: BTreeMap<PathBuf, Vec<usize>> = BTreeMap::new();
    for &index in &usable {
        let entry = &entries[index];
        let source = PathBuf::from(&entry.source_path);
        let canonical_source = match fs::canonicalize(&source) {
            Ok(path) => path,
            Err(_) => {
                issues.push(issue(
                    StagingIssueCode::SourceMissing,
                    StagingField::SourcePath,
                    Some(index),
                    "Source path does not exist or cannot be resolved.",
                ));
                continue;
            }
        };
        if is_inside(&canonical_source, &staging_root) {
            issues.push(issue(
                StagingIssueCode::SourceInsideStaging,
                StagingField::SourcePath,
                Some(index),
                "Source path resolves inside the staging root.",
            ));
            continue;
        }
        let destination_dir = destination_base
            .join(&entry.subject)
            .join(&entry.session)
            .join(&entry.run)
            .join(&entry.modality);
        if let Err((code, message)) =
            validate_destination_confinement(&staging_root, &destination_base, &destination_dir)
        {
            issues.push(issue(code, StagingField::Destination, Some(index), message));
            continue;
        }
        source_entries
            .entry(canonical_source.clone())
            .or_default()
            .push(index);
        let metadata = match fs::metadata(&canonical_source) {
            Ok(metadata) => metadata,
            Err(_) => {
                issues.push(issue(
                    StagingIssueCode::SourceUnreadable,
                    StagingField::SourcePath,
                    Some(index),
                    "Source path is unreadable.",
                ));
                continue;
            }
        };
        if metadata.is_file() {
            if fs::File::open(&canonical_source).is_err() {
                issues.push(issue(
                    StagingIssueCode::SourceUnreadable,
                    StagingField::SourcePath,
                    Some(index),
                    "Source file is unreadable.",
                ));
                continue;
            }
            if let Some(name) = canonical_source.file_name().map(|name| name.to_os_string()) {
                let destination = destination_dir.join(name);
                if let Err((code, message)) = validate_file_destination(
                    &staging_root,
                    &destination_base,
                    &destination,
                    &canonical_source,
                ) {
                    issues.push(issue(code, StagingField::Destination, Some(index), message));
                    continue;
                }
                records.push((index, canonical_source, destination));
            }
        } else if metadata.is_dir() {
            let read_dir = match fs::read_dir(&canonical_source) {
                Ok(read_dir) => read_dir,
                Err(_) => {
                    issues.push(issue(
                        StagingIssueCode::SourceUnreadable,
                        StagingField::SourcePath,
                        Some(index),
                        "Source directory is unreadable.",
                    ));
                    continue;
                }
            };
            let mut files = Vec::new();
            for child in read_dir.flatten() {
                if child.file_type().is_ok_and(|file_type| file_type.is_file()) {
                    files.push(child.path());
                }
            }
            files.sort();
            for file in files {
                if let Some(name) = file.file_name().map(|name| name.to_os_string()) {
                    let destination = destination_dir.join(name);
                    if let Err((code, message)) = validate_file_destination(
                        &staging_root,
                        &destination_base,
                        &destination,
                        &file,
                    ) {
                        issues.push(issue(code, StagingField::Destination, Some(index), message));
                        continue;
                    }
                    records.push((index, file, destination));
                }
            }
        } else {
            issues.push(issue(
                StagingIssueCode::SourceUnreadable,
                StagingField::SourcePath,
                Some(index),
                "Source path is not a regular file or directory.",
            ));
        }
    }

    for indexes in source_entries.values() {
        for pair in indexes.windows(2) {
            if pair[0] != pair[1] {
                add_pair_issue(
                    &mut issues,
                    StagingIssueCode::DuplicateSource,
                    StagingField::SourcePath,
                    pair[0],
                    pair[1],
                    "Source is referenced by multiple staging entries.",
                );
            }
        }
    }
    let mut target_groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for &index in &usable {
        let entry = &entries[index];
        target_groups
            .entry(
                [&entry.subject, &entry.session, &entry.run, &entry.modality]
                    .iter()
                    .map(|part| portable_key(part))
                    .collect::<Vec<_>>()
                    .join("\0"),
            )
            .or_default()
            .push(index);
    }
    for indexes in target_groups.values() {
        for (position, &left) in indexes.iter().enumerate() {
            for &right in &indexes[position + 1..] {
                let left_tuple = (
                    &entries[left].original_subject,
                    &entries[left].original_session,
                    &entries[left].original_run,
                );
                let right_tuple = (
                    &entries[right].original_subject,
                    &entries[right].original_session,
                    &entries[right].original_run,
                );
                let left_target = (
                    &entries[left].subject,
                    &entries[left].session,
                    &entries[left].run,
                    &entries[left].modality,
                );
                let right_target = (
                    &entries[right].subject,
                    &entries[right].session,
                    &entries[right].run,
                    &entries[right].modality,
                );
                if left_tuple != right_tuple || left_target != right_target {
                    add_pair_issue(
                        &mut issues,
                        StagingIssueCode::PortableCollision,
                        StagingField::Destination,
                        left,
                        right,
                        "Only exactly spelled destinations from one original logical tuple may share a directory.",
                    );
                }
            }
        }
    }
    for (field, originals_and_targets) in [
        (
            StagingField::Subject,
            usable
                .iter()
                .map(|&index| {
                    (
                        index,
                        &entries[index].original_subject,
                        &entries[index].subject,
                    )
                })
                .collect::<Vec<_>>(),
        ),
        (
            StagingField::Session,
            usable
                .iter()
                .map(|&index| {
                    (
                        index,
                        &entries[index].original_session,
                        &entries[index].session,
                    )
                })
                .collect::<Vec<_>>(),
        ),
        (
            StagingField::RunAlias,
            usable
                .iter()
                .map(|&index| {
                    (
                        index,
                        &entries[index].original_run,
                        &entries[index].run_alias,
                    )
                })
                .collect::<Vec<_>>(),
        ),
    ] {
        let mut groups: BTreeMap<String, Vec<(usize, &String)>> = BTreeMap::new();
        for (index, original, target) in originals_and_targets {
            groups
                .entry(portable_key(target))
                .or_default()
                .push((index, original));
        }
        for entries in groups.values() {
            for (position, &(left, left_original)) in entries.iter().enumerate() {
                for &(right, right_original) in &entries[position + 1..] {
                    if left_original != right_original {
                        add_pair_issue(
                            &mut issues,
                            StagingIssueCode::PortableCollision,
                            field.clone(),
                            left,
                            right,
                            "Distinct original identifiers share a portable target.",
                        );
                    }
                }
            }
        }
    }
    let mut destination_files: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, _, destination) in &records {
        let key = destination
            .components()
            .map(|component| portable_key(&component.as_os_str().to_string_lossy()))
            .collect::<Vec<_>>()
            .join("\0");
        destination_files.entry(key).or_default().push(*index);
    }
    for indexes in destination_files.values() {
        for (position, &left) in indexes.iter().enumerate() {
            for &right in &indexes[position + 1..] {
                add_pair_issue(
                    &mut issues,
                    StagingIssueCode::PortableCollision,
                    StagingField::Destination,
                    left,
                    right,
                    "Source files collide at one portable destination filename.",
                );
            }
        }
    }
    if !issues.is_empty() {
        return Err(validation_result(issues));
    }
    records.sort_by(|left, right| left.2.cmp(&right.2).then(left.1.cmp(&right.1)));
    Ok(CompiledStagingPlan {
        staging_root,
        records: records
            .into_iter()
            .map(|(_, source, destination)| CompiledFileRecord {
                source,
                destination,
            })
            .collect(),
    })
}

pub fn preflight_staging_plan_for_state(
    state: &AppState,
    entries: &[StagingEntry],
) -> StagingPreflightResult {
    let active = state
        .active_project_root
        .lock()
        .ok()
        .and_then(|root| root.clone());
    match compile_staging_plan(active, entries) {
        Ok(_) => StagingPreflightResult {
            valid: true,
            issues: Vec::new(),
        },
        Err(result) => result,
    }
}

pub fn execute_compiled_staging_plan(plan: &CompiledStagingPlan) -> AnyResult<()> {
    for record in &plan.records {
        let parent = record.destination.parent().with_context(|| {
            format!(
                "Destination has no parent: {}",
                record.destination.display()
            )
        })?;
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create directory {}", parent.display()))?;
        link_or_copy(&record.source, &record.destination)?;
    }
    Ok(())
}

fn link_or_copy(source: &Path, target: &Path) -> AnyResult<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target).with_context(|| {
            format!(
                "Failed to create symlink {} -> {}",
                target.display(),
                source.display()
            )
        })
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_file(source, target).is_ok()
            || fs::hard_link(source, target).is_ok()
        {
            return Ok(());
        }
        fs::copy(source, target)
            .with_context(|| {
                format!(
                    "Failed to copy {} -> {}",
                    source.display(),
                    target.display()
                )
            })
            .map(|_| ())
    }
}

#[cfg(test)]
mod staging_tests;

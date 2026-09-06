use super::fault_injection::{FaultPoint, fail};
use super::filesystem::{atomic_replace, path_exists, rename_no_replace, sync_parent_durable};
use super::paths::{
    candidate_record_path, log_matches_subject, owned_sibling, project_identity, safe_join,
    subject_dir,
};
use super::types::{ArtifactPhase, ArtifactRole, DatasetPhase, OwnedPathRole, RelocationJournal};
use anyhow::{Context, Result as AnyResult, bail};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const JOURNAL_FILE: &str = ".easl_import_relocation.json";
pub(super) const JOURNAL_VERSION: u32 = 2;
static JOURNAL_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn journal_path(root: &Path) -> PathBuf {
    root.join(JOURNAL_FILE)
}

pub(super) fn journal_temp_path(root: &Path, journal: &RelocationJournal) -> PathBuf {
    let token = journal
        .plan_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    let sequence = JOURNAL_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    root.join(format!(
        "{JOURNAL_FILE}.{token}.{}.{timestamp}.{sequence}.tmp",
        journal.generation
    ))
}

pub(super) fn cleanup_owned_journal_temp(path: &Path, expected_bytes: &[u8]) {
    let owned = fs::symlink_metadata(path)
        .ok()
        .is_some_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        && fs::read(path).is_ok_and(|bytes| bytes == expected_bytes);
    if owned {
        let _ = fs::remove_file(path);
    }
}

pub(super) fn write_journal(root: &Path, journal: &RelocationJournal) -> AnyResult<()> {
    validate_journal(root, journal)?;
    fail(FaultPoint::JournalPersist)?;
    let destination = journal_path(root);
    let temporary = journal_temp_path(root, journal);
    let data =
        serde_json::to_vec_pretty(journal).context("Failed to serialize relocation journal")?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .with_context(|| {
                format!(
                    "Failed to exclusively create relocation journal temporary file {}",
                    temporary.display()
                )
            })?;
        file.write_all(&data).with_context(|| {
            format!("Failed to write relocation journal {}", temporary.display())
        })?;
        file.sync_all().with_context(|| {
            format!(
                "Failed to synchronize relocation journal {}",
                temporary.display()
            )
        })?;
        drop(file);

        let installed = if path_exists(&destination)? {
            let existing = read_journal(root)?.context("Relocation journal disappeared")?;
            if existing.project_identity != journal.project_identity
                || existing.plan_id != journal.plan_id
                || existing.generation != journal.generation
            {
                bail!("Refusing to replace a foreign relocation journal");
            }
            atomic_replace(&temporary, &destination)
        } else {
            rename_no_replace(&temporary, &destination)
        };
        installed.with_context(|| {
            format!(
                "Failed to atomically persist relocation journal {}",
                destination.display()
            )
        })?;
        sync_parent_durable(root)
    })();
    if result.is_err() {
        cleanup_owned_journal_temp(&temporary, &data);
    }
    result
}

pub(super) fn remove_journal_owned(root: &Path, journal: &RelocationJournal) -> AnyResult<()> {
    let current = read_journal(root)?.context("Relocation journal disappeared before cleanup")?;
    if current.project_identity != journal.project_identity
        || current.plan_id != journal.plan_id
        || current.generation != journal.generation
        || current.terminal_outcome.is_none()
    {
        bail!("Refusing to remove relocation journal without durable terminal ownership");
    }
    fail(FaultPoint::JournalCleanup)?;
    let path = journal_path(root);
    fs::remove_file(&path)
        .with_context(|| format!("Failed to remove relocation journal {}", path.display()))?;
    sync_parent_durable(root)
}

pub(super) fn read_journal(root: &Path) -> AnyResult<Option<RelocationJournal>> {
    let path = journal_path(root);
    if !path_exists(&path)? {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(&path)
        .with_context(|| format!("Failed to inspect relocation journal {}", path.display()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        bail!("Relocation journal must be a regular non-symlink file");
    }
    let journal = serde_json::from_slice::<RelocationJournal>(
        &fs::read(&path)
            .with_context(|| format!("Failed to read relocation journal {}", path.display()))?,
    )
    .with_context(|| format!("Malformed relocation journal {}", path.display()))?;
    validate_journal(root, &journal)?;
    Ok(Some(journal))
}

pub(super) fn validate_journal(root: &Path, journal: &RelocationJournal) -> AnyResult<()> {
    if journal.version != JOURNAL_VERSION || journal.project_identity != project_identity(root) {
        bail!("Foreign or unsupported relocation journal");
    }
    if journal.plan_id.is_empty() || journal.plan_fingerprint.is_empty() {
        bail!("Relocation journal has invalid run ownership");
    }
    if journal.subjects.is_empty() {
        bail!("Relocation journal has no owned subjects");
    }
    let dataset_destination = safe_join(root, &journal.dataset.destination)?;
    if dataset_destination != root.join("rawdata/dataset_description.json") {
        bail!("Journal dataset destination is invalid");
    }
    let dataset_candidate = candidate_record_path(root, &journal.dataset.candidate)?;
    if dataset_candidate
        != owned_sibling(
            &dataset_destination,
            &journal.plan_id,
            "run",
            OwnedPathRole::Candidate,
        )?
    {
        bail!("Journal dataset candidate is not transaction-owned");
    }
    let mut subjects = BTreeSet::new();
    for subject in &journal.subjects {
        crate::import::validate_subject_components(std::slice::from_ref(&subject.subject))
            .map_err(anyhow::Error::msg)?;
        if !subjects.insert(crate::import::staging::portable_key(&subject.subject)) {
            bail!("Relocation journal repeats a subject");
        }
        let mut destinations = BTreeSet::new();
        for artifact in &subject.artifacts {
            let destination = safe_join(root, &artifact.destination)?;
            if !destinations.insert(artifact.destination.clone())
                || !is_subject_artifact_destination(root, &destination, &subject.subject)
            {
                bail!("Journal references an unrelated or duplicate artifact destination");
            }
            let backup = artifact
                .backup
                .as_deref()
                .context("Subject artifact has no backup path")?;
            if safe_join(root, backup)?
                != owned_sibling(
                    &destination,
                    &journal.plan_id,
                    &subject.subject,
                    OwnedPathRole::Backup,
                )?
            {
                bail!("Journal backup does not match its owned destination");
            }
            match artifact.role {
                ArtifactRole::Replacement => {
                    let candidate = artifact
                        .candidate
                        .as_deref()
                        .context("Replacement artifact has no candidate")?;
                    if candidate_record_path(root, candidate)?
                        != owned_sibling(
                            &destination,
                            &journal.plan_id,
                            &subject.subject,
                            OwnedPathRole::Candidate,
                        )?
                    {
                        bail!("Journal candidate does not match its owned destination");
                    }
                }
                ArtifactRole::Removal if artifact.candidate.is_some() => {
                    bail!("Removal artifact must not have a candidate");
                }
                ArtifactRole::Removal => {}
            }
            if artifact.candidate_abandoned
                && !matches!(
                    artifact.phase,
                    ArtifactPhase::RollbackIntent | ArtifactPhase::RolledBack
                )
            {
                bail!("Abandoned candidate has an invalid journal phase");
            }
        }
    }
    if journal.dataset.candidate_abandoned
        && !matches!(
            journal.dataset.phase,
            DatasetPhase::RollbackIntent | DatasetPhase::RolledBack
        )
    {
        bail!("Abandoned dataset candidate has an invalid journal phase");
    }
    if let Some(outcome) = &journal.terminal_outcome {
        if outcome.plan_id != journal.plan_id || outcome.generation != journal.generation {
            bail!("Terminal relocation outcome has foreign ownership");
        }
        let recorded = journal
            .subjects
            .iter()
            .map(|subject| crate::import::staging::portable_key(&subject.subject))
            .collect::<Vec<_>>();
        let terminal = outcome
            .subjects
            .iter()
            .map(|subject| crate::import::staging::portable_key(&subject.subject))
            .collect::<Vec<_>>();
        if recorded != terminal {
            bail!("Terminal relocation outcome does not cover the ordered subject scope");
        }
    }
    Ok(())
}

fn is_subject_artifact_destination(root: &Path, destination: &Path, subject: &str) -> bool {
    let sub = subject_dir(subject);
    if destination == root.join("rawdata").join(&sub)
        || destination == crate::import::import_lock_dir_for_relocation(root, subject)
    {
        return true;
    }
    let log_root = root.join("derivatives/ExploreASL/log");
    if destination.parent() == Some(log_root.as_path()) {
        return destination
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| log_matches_subject(name, &sub));
    }
    let legacy_root = root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    destination.parent() == Some(legacy_root.as_path())
        && destination
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&format!("{sub}_")))
}

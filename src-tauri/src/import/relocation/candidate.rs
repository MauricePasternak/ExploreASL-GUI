use super::fault_injection::{FaultPoint, fail};
use super::filesystem::{
    copy_tree_reserved, path_exists, same_tree, sync_parent, sync_parent_durable, sync_tree,
    tree_fingerprint,
};
use super::paths::{reject_symlink_components, sha256_bytes};
use anyhow::{Context, Result as AnyResult, bail};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const RESERVATION_MARKER: &str = ".easl-reservation";
const CANDIDATE_PAYLOAD: &str = "payload";
static RESERVATION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn reservation_token(candidate: &Path) -> String {
    let sequence = RESERVATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    sha256_bytes(
        format!(
            "{}\0{}\0{timestamp}\0{sequence}",
            std::process::id(),
            candidate.display()
        )
        .as_bytes(),
    )
}

pub(super) fn candidate_payload(candidate: &Path) -> PathBuf {
    candidate.join(CANDIDATE_PAYLOAD)
}

pub(super) fn create_owned_parent_dirs(root: &Path, path: &Path) -> AnyResult<()> {
    let relative = path
        .strip_prefix(root)
        .context("Candidate parent escapes project root")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            bail!("Candidate parent is not a normal project-relative path");
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                bail!("Symlink in candidate parent path: {}", current.display());
            }
            Ok(metadata) if !metadata.is_dir() => {
                bail!("Non-directory candidate parent path: {}", current.display());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => sync_parent_durable(current.parent().ok_or_else(|| {
                        anyhow::anyhow!("Created candidate directory has no parent")
                    })?)?,
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        let metadata = fs::symlink_metadata(&current).with_context(|| {
                            format!(
                                "Failed to inspect concurrently created candidate parent {}",
                                current.display()
                            )
                        })?;
                        if metadata.file_type().is_symlink() || !metadata.is_dir() {
                            bail!(
                                "Candidate parent was concurrently replaced: {}",
                                current.display()
                            );
                        }
                    }
                    Err(error) => {
                        return Err(error).with_context(|| {
                            format!("Failed to create candidate parent {}", current.display())
                        });
                    }
                }
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("Failed to inspect candidate parent {}", current.display())
                });
            }
        }
    }
    Ok(())
}

pub(super) fn reserve_candidate(root: &Path, candidate: &Path, token: &str) -> AnyResult<()> {
    fail(FaultPoint::CandidateCreate)?;
    let parent = candidate.parent().context("Candidate has no parent")?;
    reject_symlink_components(root, parent)?;
    create_owned_parent_dirs(root, parent)?;
    reject_symlink_components(root, parent)?;
    fs::create_dir(candidate).with_context(|| {
        format!(
            "Failed to exclusively reserve transaction candidate {}",
            candidate.display()
        )
    })?;
    let marker = candidate.join(RESERVATION_MARKER);
    let result = (|| {
        let mut marker_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)
            .with_context(|| format!("Failed to create candidate marker {}", marker.display()))?;
        marker_file
            .write_all(token.as_bytes())
            .with_context(|| format!("Failed to write candidate marker {}", marker.display()))?;
        marker_file.sync_all().with_context(|| {
            format!(
                "Failed to synchronize candidate marker {}",
                marker.display()
            )
        })?;
        sync_parent_durable(candidate)?;
        sync_parent_durable(parent)
    })();
    if result.is_err() {
        let marker_owned = fs::read(&marker).is_ok_and(|contents| contents == token.as_bytes());
        if marker_owned {
            let _ = fs::remove_file(marker);
            let _ = fs::remove_dir(candidate);
        }
    }
    result
}

pub(super) fn validate_candidate_marker(candidate: &Path, token: Option<&str>) -> AnyResult<()> {
    let token = token.context("Candidate lacks durable reservation ownership")?;
    let metadata = fs::symlink_metadata(candidate).with_context(|| {
        format!(
            "Failed to inspect candidate wrapper {}",
            candidate.display()
        )
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        bail!("Candidate wrapper is not transaction-owned");
    }
    let marker = candidate.join(RESERVATION_MARKER);
    let marker_metadata = fs::symlink_metadata(&marker).with_context(|| {
        format!(
            "Candidate reservation marker is missing at {}",
            marker.display()
        )
    })?;
    if !marker_metadata.is_file()
        || marker_metadata.file_type().is_symlink()
        || fs::read(&marker)
            .with_context(|| format!("Failed to read candidate marker {}", marker.display()))?
            != token.as_bytes()
    {
        bail!("Candidate reservation marker does not match durable ownership");
    }
    Ok(())
}

pub(super) fn populate_reserved_candidate(source: &Path, candidate: &Path) -> AnyResult<String> {
    (|| {
        let payload = candidate_payload(candidate);
        copy_tree_reserved(source, &payload, false)?;
        fail(FaultPoint::SourceMutation)?;
        if !same_tree(source, &payload)? {
            bail!("Candidate inventory verification failed");
        }
        sync_tree(&payload)?;
        fail(FaultPoint::PayloadParentSync)?;
        sync_parent(candidate)?;
        tree_fingerprint(&payload)
    })()
}

pub(super) fn validate_ready_candidate(
    candidate: &Path,
    token: Option<&str>,
    expected_payload: Option<&str>,
) -> AnyResult<()> {
    validate_candidate_marker(candidate, token)?;
    require_owned_fingerprint(
        &candidate_payload(candidate),
        expected_payload,
        "Prepared candidate payload",
    )
}

pub(super) fn remove_candidate_wrapper(
    candidate: &Path,
    token: Option<&str>,
    expected_payload: Option<&str>,
    payload_may_be_absent: bool,
) -> AnyResult<()> {
    if !path_exists(candidate)? {
        return Ok(());
    }
    validate_candidate_marker(candidate, token)?;
    let payload = candidate_payload(candidate);
    if path_exists(&payload)? {
        require_owned_fingerprint(&payload, expected_payload, "Candidate payload")?;
    } else if !payload_may_be_absent && expected_payload.is_some() {
        bail!("Candidate payload disappeared before owned cleanup");
    }
    fs::remove_dir_all(candidate)
        .with_context(|| format!("Failed to remove candidate wrapper {}", candidate.display()))?;
    fail(FaultPoint::WrapperDeleteParentSync)?;
    sync_parent(
        candidate
            .parent()
            .context("Candidate wrapper has no parent")?,
    )
}

pub(super) fn sync_payload_rename(candidate: &Path, destination: &Path) -> AnyResult<()> {
    fail(FaultPoint::PayloadRenameSourceSync)?;
    sync_parent(candidate)?;
    fail(FaultPoint::PayloadRenameDestinationSync)?;
    sync_parent(
        destination
            .parent()
            .context("Installed payload has no destination parent")?,
    )
}

pub(super) fn require_owned_fingerprint(
    path: &Path,
    expected: Option<&str>,
    description: &str,
) -> AnyResult<()> {
    let expected =
        expected.with_context(|| format!("{description} lacks a durable fingerprint"))?;
    if tree_fingerprint(path)? != expected {
        bail!("{description} does not match its durable fingerprint");
    }
    Ok(())
}

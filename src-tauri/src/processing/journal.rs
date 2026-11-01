//! Durable compensation for GUI-owned launch artifacts.
use crate::fs_safety::{ProjectDirectory, ProjectRelativePath};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(crate) const AUTHORITY: &str = "derivatives/ExploreASL_GUI/processing";
pub(crate) fn relative(path: impl AsRef<Path>) -> Result<ProjectRelativePath> {
    Ok(ProjectRelativePath::new(path)?)
}

// An interrupted initial intent may precede creation of its backup directory.
// Repair the nearest existing parent without creating or deleting authority.
pub(crate) fn sync_existing_parent(directory: &ProjectDirectory, path: &str) -> Result<()> {
    let mut path = Path::new(path);
    loop {
        match directory.sync_parent(&relative(path)?) {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                path = path.parent().context("Authority parent missing")?;
            }
            Err(error) => {
                return Err(error).context("Processing authority durability repair failed");
            }
        }
    }
}

#[cfg(test)]
thread_local! { static FAULT: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) }; }
#[cfg(test)]
pub(crate) fn inject_fault(point: &str) {
    FAULT.with(|slot| *slot.borrow_mut() = Some(point.into()));
}
pub(crate) fn checkpoint(point: &str) -> Result<()> {
    #[cfg(test)]
    if FAULT.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.as_deref() == Some(point) {
            slot.take();
            true
        } else {
            false
        }
    }) {
        bail!("Injected processing fault: {point}");
    }
    let _ = point;
    Ok(())
}

/// After replacement, errors explicitly mean uncertain durability. Never restore
/// a prior record in this branch. The caller retains ownership and recovery data.
pub(crate) fn publish(
    directory: &ProjectDirectory,
    path: &str,
    value: &impl Serialize,
    create_new: bool,
) -> Result<()> {
    checkpoint("beforeRecordWrite")?;
    let destination = relative(path)?;
    let parent = Path::new(path)
        .parent()
        .context("Authority record has no parent")?;
    directory.create_dir_all_durable(&relative(parent)?)?;
    let candidate = relative(parent.join(format!(".record-{}.candidate", uuid::Uuid::new_v4())))?;
    let bytes = serde_json::to_vec(value)?;
    let mut file = directory.create_new_file(&candidate)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    if create_new {
        directory.rename_regular_file_no_replace(&candidate, &destination)?;
    } else {
        directory.replace_regular_file(&candidate, &destination)?;
    }
    checkpoint("afterRecordReplace").context("Processing record visible; durability uncertain")?;
    checkpoint(&format!("afterRecordReplace:{path}"))
        .context("Processing record visible; durability uncertain")?;
    directory
        .sync_parent(&destination)
        .context("Processing record visible; durability uncertain")?;
    checkpoint("afterRecordWrite")?;
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Evidence {
    directory: bool,
    device: u64,
    inode: u64,
    digest: Option<String>,
    children: Vec<(String, Evidence)>,
}
impl Evidence {
    fn capture(directory: &ProjectDirectory, path: &str) -> Result<Self> {
        let p = relative(path)?;
        let (is_dir, device, inode) = directory.entry_identity(&p)?;
        let (digest, children) = if is_dir {
            let mut children = Vec::new();
            for name in directory.directory_names(&p)? {
                let name = name
                    .into_string()
                    .map_err(|_| anyhow::anyhow!("Non-UTF8 journal entry"))?;
                let child = format!("{path}/{name}");
                // Directory quarantine cannot smuggle scientific or unknown files.
                if !allowed_destination(&child) {
                    bail!("Unknown file in launch artifact scope: {child}");
                }
                children.push((name, Self::capture(directory, &child)?));
            }
            children.sort_by(|a, b| a.0.cmp(&b.0));
            (None, children)
        } else {
            (
                Some(hex::encode(Sha256::digest(directory.read_regular(&p)?))),
                Vec::new(),
            )
        };
        Ok(Self {
            directory: is_dir,
            device,
            inode,
            digest,
            children,
        })
    }
    fn matches(&self, directory: &ProjectDirectory, path: &str) -> Result<bool> {
        // Backups live in authority namespace, while children retain exact names.
        Ok(self == &Self::capture_owned(directory, path)?)
    }
    fn capture_owned(directory: &ProjectDirectory, path: &str) -> Result<Self> {
        let p = relative(path)?;
        let (is_dir, device, inode) = directory.entry_identity(&p)?;
        let mut children = Vec::new();
        let digest = if is_dir {
            for name in directory.directory_names(&p)? {
                let name = name
                    .into_string()
                    .map_err(|_| anyhow::anyhow!("Non-UTF8 owned entry"))?;
                children.push((
                    name.clone(),
                    Self::capture_owned(directory, &format!("{path}/{name}"))?,
                ));
            }
            children.sort_by(|a, b| a.0.cmp(&b.0));
            None
        } else {
            Some(hex::encode(Sha256::digest(directory.read_regular(&p)?)))
        };
        Ok(Self {
            directory: is_dir,
            device,
            inode,
            digest,
            children,
        })
    }
    fn matches_remaining(&self, actual: &Self) -> bool {
        self.directory == actual.directory
            && self.device == actual.device
            && self.inode == actual.inode
            && self.digest == actual.digest
            && actual.children.iter().all(|(name, child)| {
                self.children
                    .iter()
                    .find(|(owned, _)| owned == name)
                    .is_some_and(|(_, owned)| owned.matches_remaining(child))
            })
    }
    fn remove(&self, directory: &ProjectDirectory, path: &str) -> Result<()> {
        if !exists(directory, path)? {
            sync_existing_parent(directory, path)?;
            return Ok(());
        }
        // A prior attempt may already have deleted owned descendants. Prove
        // every remaining entry before deleting any; added/replaced bytes block.
        if !self.matches_remaining(&Self::capture_owned(directory, path)?) {
            bail!("Foreign replacement blocks launch cleanup: {path}");
        }
        for (name, evidence) in &self.children {
            evidence.remove(directory, &format!("{path}/{name}"))?;
        }
        if self.directory {
            directory.remove_empty_directory(&relative(path)?)?;
        } else {
            directory.cleanup_owned_candidate(&relative(path)?)?;
        }
        checkpoint("afterOwnedRemoval")?;
        directory.sync_parent(&relative(path)?)?;
        Ok(())
    }
}
fn exists(directory: &ProjectDirectory, path: &str) -> Result<bool> {
    match directory.entry_identity(&relative(path)?) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Narrow domain allowlist, independent of syntactic path confinement.
pub(crate) fn allowed_destination(path: &str) -> bool {
    if relative(path).is_err() || path.contains('\\') {
        return false;
    }
    if matches!(
        path,
        "derivatives/ExploreASL/dataPar.json"
            | "derivatives/ExploreASL/participants.tsv"
            | "derivatives/ExploreASL/participants.json"
            | "derivatives/ExploreASL/lock"
    ) {
        return true;
    }
    if let Some(name) = path.strip_prefix("derivatives/ExploreASL/log/") {
        return !name.contains('/')
            && name.ends_with(".log")
            && ["xASL_module_Structural_", "xASL_module_ASL_"]
                .iter()
                .any(|p| name.starts_with(p))
            || name == "xASL_module_Population.log";
    }
    let Some(rest) = path.strip_prefix("derivatives/ExploreASL/lock/") else {
        return false;
    };
    let parts: Vec<_> = rest.split('/').collect();
    if parts.len() < 2
        || !matches!(
            parts[0],
            "xASL_module_Structural"
                | "xASL_module_ASL"
                | "xASL_module_Population"
                | "xASL_module_BIDS2Legacy"
        )
    {
        return false;
    }
    let leaf = parts.last().unwrap();
    *leaf == "locked"
        || leaf.ends_with(".status")
        || (parts[0] == "xASL_module_BIDS2Legacy"
            && parts.len() == 2
            && parts[1].starts_with("sub-"))
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Preparing,
    Prepared,
    ExecutionCommitted,
    RolledBack,
    Cleaned,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Entry {
    destination: String,
    backup: String,
    prior: Option<Evidence>,
    installed: Option<Evidence>,
    candidate: Option<String>,
    reverted: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Manifest {
    version: u32,
    directory_identity: (u64, u64),
    run_id: String,
    phase: Phase,
    entries: Vec<Entry>,
}
#[derive(Debug)]
pub(crate) struct LaunchJournal {
    root: PathBuf,
    manifest_path: String,
    manifest: Manifest,
    uncertain: bool,
    persisted: Option<serde_json::Value>,
}
impl LaunchJournal {
    pub(crate) fn new(root: &Path, run_id: &str, targets: &[PathBuf]) -> Result<Self> {
        relative(run_id)?;
        if run_id.contains(['/', '\\']) {
            bail!("Invalid launch identity");
        }
        let directory = ProjectDirectory::open(root)?;
        let manifest_path = format!("{AUTHORITY}/runs/{run_id}/launch.json");
        if exists(&directory, &manifest_path)? {
            bail!("Launch journal already exists; recover exact run first");
        }
        let mut entries = Vec::new();
        for target in targets {
            let destination = target
                .strip_prefix(root)?
                .to_str()
                .context("Non-UTF8 launch destination")?
                .replace(std::path::MAIN_SEPARATOR, "/");
            if !allowed_destination(&destination) {
                bail!("Disallowed launch destination: {destination}");
            }
            let prior = Some(Evidence::capture(&directory, &destination)?);
            entries.push(Entry {
                destination,
                backup: format!("{AUTHORITY}/runs/{run_id}/backups/{}", entries.len()),
                prior,
                installed: None,
                candidate: None,
                reverted: false,
            });
        }
        Ok(Self {
            root: root.into(),
            manifest_path,
            manifest: Manifest {
                version: 2,
                directory_identity: directory.directory_identity()?,
                run_id: run_id.into(),
                phase: Phase::Preparing,
                entries,
            },
            uncertain: false,
            persisted: None,
        })
    }
    fn directory(&self) -> Result<ProjectDirectory> {
        Ok(ProjectDirectory::open(&self.root)?)
    }
    fn save(&mut self) -> Result<()> {
        if self.uncertain {
            bail!("Launch journal requires explicit reopen after storage failure");
        }
        let directory = self.directory()?;
        if let Some(expected) = &self.persisted {
            let actual: serde_json::Value =
                serde_json::from_slice(&directory.read_regular(&relative(&self.manifest_path)?)?)?;
            if &actual != expected {
                bail!("Foreign replacement of launch manifest");
            }
        }
        if let Err(error) = publish(
            &directory,
            &self.manifest_path,
            &self.manifest,
            self.persisted.is_none(),
        ) {
            self.uncertain = true;
            return Err(error);
        }
        self.persisted = Some(serde_json::to_value(&self.manifest)?);
        Ok(())
    }
    pub(crate) fn prepare(&mut self, installations: &[(String, Vec<u8>)]) -> Result<()> {
        let directory = self.directory()?;
        // Snapshot absence and candidate content before any target mutation.
        for (destination, _) in installations {
            if !allowed_destination(destination) {
                bail!("Disallowed launch destination: {destination}");
            }
            if !self
                .manifest
                .entries
                .iter()
                .any(|e| &e.destination == destination)
            {
                if exists(&directory, destination)? {
                    bail!("Foreign replacement before installation: {destination}");
                }
                self.manifest.entries.push(Entry {
                    destination: destination.clone(),
                    backup: format!(
                        "{AUTHORITY}/runs/{}/backups/{}",
                        self.manifest.run_id,
                        self.manifest.entries.len()
                    ),
                    prior: None,
                    installed: None,
                    candidate: None,
                    reverted: false,
                });
            }
        }
        self.save()?;
        directory.create_dir_all_durable(&relative(format!(
            "{AUTHORITY}/runs/{}/backups",
            self.manifest.run_id
        ))?)?;
        for index in 0..self.manifest.entries.len() {
            let entry = self.manifest.entries[index].clone();
            if let Some(prior) = entry.prior.as_ref() {
                if !prior.matches(&directory, &entry.destination)? {
                    bail!(
                        "Foreign replacement before quarantine: {}",
                        entry.destination
                    );
                }
                checkpoint("beforeRename")?;
                directory.rename_entry_no_replace(
                    &relative(&entry.destination)?,
                    &relative(&entry.backup)?,
                )?;
                checkpoint("afterRename")?;
                directory.sync_parent(&relative(&entry.destination)?)?;
                directory.sync_parent(&relative(&entry.backup)?)?;
            }
        }
        for (destination, bytes) in installations {
            self.install(destination, Some(bytes))?;
        }
        let lock = "derivatives/ExploreASL/lock";
        if !exists(&directory, lock)? {
            self.install(lock, None)?;
        }
        self.manifest.phase = Phase::Prepared;
        self.save()?;
        Ok(())
    }
    fn install(&mut self, destination: &str, bytes: Option<&[u8]>) -> Result<()> {
        let directory = self.directory()?;
        let index = match self
            .manifest
            .entries
            .iter()
            .position(|e| e.destination == destination)
        {
            Some(index) => index,
            None => {
                let index = self.manifest.entries.len();
                self.manifest.entries.push(Entry {
                    destination: destination.into(),
                    backup: format!("{AUTHORITY}/runs/{}/backups/{index}", self.manifest.run_id),
                    prior: None,
                    installed: None,
                    candidate: None,
                    reverted: false,
                });
                self.save()?;
                index
            }
        };
        let candidate = format!(
            "{AUTHORITY}/runs/{}/candidate-{index}",
            self.manifest.run_id
        );
        if let Some(bytes) = bytes {
            let mut file = directory.create_new_file(&relative(&candidate)?)?;
            file.write_all(bytes)?;
            file.sync_all()?;
        } else {
            directory.create_dir_all_durable(&relative(&candidate)?)?;
        }
        let evidence = Evidence::capture_owned(&directory, &candidate)?;
        self.manifest.entries[index].installed = Some(evidence);
        self.manifest.entries[index].candidate = Some(candidate.clone());
        self.save()?;
        checkpoint("beforeInstall")?;
        if bytes.is_some() {
            directory
                .hard_link_regular_no_replace(&relative(&candidate)?, &relative(destination)?)?;
        } else {
            directory.rename_entry_no_replace(&relative(&candidate)?, &relative(destination)?)?;
        }
        checkpoint("afterInstall")?;
        directory.sync_parent(&relative(destination)?)?;
        directory.sync_parent(&relative(candidate)?)?;
        Ok(())
    }
    pub(crate) fn commit(&mut self) -> Result<()> {
        if self.manifest.phase != Phase::Prepared {
            bail!("Launch journal is not prepared");
        }
        checkpoint("beforeExecutionCommit")?;
        self.manifest.phase = Phase::ExecutionCommitted;
        self.save()?;
        // Keep inode witnesses through preparation/rollback, but retire them
        // before workers can rewrite installed files through these hard links.
        // Failure after durable commit still forbids rollback and worker launch.
        let directory = self.directory()?;
        for entry in &self.manifest.entries {
            if let (Some(installed), Some(candidate)) = (&entry.installed, &entry.candidate) {
                installed.remove(&directory, candidate)?;
            }
        }
        checkpoint("afterExecutionCommit")?;
        Ok(())
    }
    pub(crate) fn phase(&self) -> Phase {
        self.manifest.phase
    }
    pub(crate) fn rollback(&mut self) -> Result<()> {
        if self.uncertain {
            bail!("Launch journal requires explicit reopen after storage failure");
        }
        if matches!(
            self.manifest.phase,
            Phase::ExecutionCommitted | Phase::Cleaned
        ) {
            bail!("Committed launch artifacts cannot be rolled back");
        }
        if self.manifest.phase == Phase::RolledBack {
            return Ok(());
        }
        let directory = self.directory()?;
        for index in (0..self.manifest.entries.len()).rev() {
            let entry = self.manifest.entries[index].clone();
            if entry.reverted {
                continue;
            }
            if let Some(installed) = &entry.installed {
                if exists(&directory, &entry.destination)? {
                    if entry.prior.as_ref().is_some_and(|prior| {
                        prior
                            .matches(&directory, &entry.destination)
                            .unwrap_or(false)
                    }) && !exists(&directory, &entry.backup)?
                    { /* already restored */
                    } else {
                        installed.remove(&directory, &entry.destination)?;
                    }
                }
                if let Some(candidate) = &entry.candidate {
                    installed.remove(&directory, candidate)?;
                }
            }
            if let Some(prior) = &entry.prior {
                if exists(&directory, &entry.backup)? {
                    if !prior.matches(&directory, &entry.backup)? {
                        bail!("Foreign backup blocks rollback");
                    }
                    directory.rename_entry_no_replace(
                        &relative(&entry.backup)?,
                        &relative(&entry.destination)?,
                    )?;
                    directory.sync_parent(&relative(&entry.destination)?)?;
                    directory.sync_parent(&relative(&entry.backup)?)?;
                } else if !exists(&directory, &entry.destination)?
                    || !prior.matches(&directory, &entry.destination)?
                {
                    bail!("Missing or replaced launch backup");
                }
            }
            // Retry after a visible restoration must repair both rename
            // parents before checkpointing this entry as durably reverted.
            sync_existing_parent(&directory, &entry.destination)?;
            sync_existing_parent(&directory, &entry.backup)?;
            self.manifest.entries[index].reverted = true;
            self.save()?;
        }
        self.manifest.phase = Phase::RolledBack;
        self.save()
    }
    pub(crate) fn cleanup(&mut self) -> Result<()> {
        if self.uncertain {
            bail!("Launch journal requires explicit reopen after storage failure");
        }
        if self.manifest.phase == Phase::Cleaned {
            return Ok(());
        }
        if self.manifest.phase != Phase::ExecutionCommitted {
            bail!("Launch journal has not committed");
        }
        let directory = self.directory()?;
        for entry in &self.manifest.entries {
            if let Some(prior) = &entry.prior {
                prior.remove(&directory, &entry.backup)?;
            }
            if let (Some(installed), Some(candidate)) = (&entry.installed, &entry.candidate) {
                installed.remove(&directory, candidate)?;
            }
        }
        self.manifest.phase = Phase::Cleaned;
        self.save()
    }
    /// Reopening is authorized by the active project owner and either current
    /// in-process settlement or explicit user confirmation at the domain layer.
    pub(crate) fn reopen(root: &Path, run_id: &str) -> Result<Self> {
        Self::reopen_inner(root, run_id, false)
    }

    /// Confirmation is the sole recovery path allowed to rebind a copied
    /// unresolved journal to the newly active confined project directory.
    pub(crate) fn reopen_confirmed(root: &Path, run_id: &str) -> Result<Self> {
        Self::reopen_inner(root, run_id, true)
    }

    fn reopen_inner(root: &Path, run_id: &str, confirmed: bool) -> Result<Self> {
        let directory = ProjectDirectory::open(root)?;
        relative(run_id)?;
        if run_id.contains(['/', '\\']) {
            bail!("Invalid launch identity");
        }
        let manifest_path = format!("{AUTHORITY}/runs/{run_id}/launch.json");
        let mut manifest = read_manifest(&directory.read_regular(&relative(&manifest_path)?)?)?;
        validate_manifest(&manifest, run_id)?;
        if manifest.directory_identity != directory.directory_identity()? {
            if !confirmed {
                bail!("Copied unresolved launch authority requires external-stop confirmation");
            }
            manifest.directory_identity = directory.directory_identity()?;
            publish(&directory, &manifest_path, &manifest, false)?;
        }
        directory.sync_parent(&relative(&manifest_path)?)?;
        Ok(Self {
            root: root.into(),
            manifest_path,
            persisted: Some(serde_json::to_value(&manifest)?),
            manifest,
            uncertain: false,
        })
    }
}

fn read_manifest(bytes: &[u8]) -> Result<Manifest> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).context("Corrupt processing launch journal")?;
    if value["version"].as_u64() == Some(1) {
        bail!(
            "Guardian-era processing launch journal is unsupported; use checkpoint build to settle and acknowledge it, or restore a verified clean project copy. Journal bytes were preserved"
        );
    }
    serde_json::from_value(value).context("Corrupt processing launch journal")
}

fn validate_manifest(manifest: &Manifest, run_id: &str) -> Result<()> {
    if manifest.version != 2 || manifest.run_id != run_id {
        bail!("Unsupported or foreign launch manifest");
    }
    let mut destinations = std::collections::BTreeSet::new();
    for (index, entry) in manifest.entries.iter().enumerate() {
        if !allowed_destination(&entry.destination)
            || !destinations.insert(&entry.destination)
            || entry.backup != format!("{AUTHORITY}/runs/{run_id}/backups/{index}")
            || entry
                .candidate
                .as_ref()
                .is_some_and(|p| *p != format!("{AUTHORITY}/runs/{run_id}/candidate-{index}"))
        {
            bail!("Invalid launch manifest mapping");
        }
        validate_evidence(entry.prior.as_ref(), &entry.destination)?;
        validate_evidence(entry.installed.as_ref(), &entry.destination)?;
    }
    if manifest.phase == Phase::RolledBack && manifest.entries.iter().any(|entry| !entry.reverted) {
        bail!("Incomplete rolled-back launch journal");
    }
    Ok(())
}

// Settled manifests authorize no remaining backup/candidate bytes. Unknown
// entries remain untouched and block release, including manifest-less residue.
fn require_no_residue(directory: &ProjectDirectory, run_id: Uuid, manifest: bool) -> Result<()> {
    let run_path = format!("{AUTHORITY}/runs/{run_id}");
    let names = match directory.directory_names(&relative(&run_path)?) {
        Ok(names) => names,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !manifest => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for name in names {
        if manifest && name == "launch.json" {
            continue;
        }
        if manifest
            && name == "backups"
            && directory
                .directory_names(&relative(format!("{run_path}/backups"))?)?
                .is_empty()
        {
            directory.sync_parent(&relative(format!("{run_path}/backups/settled"))?)?;
            continue;
        }
        bail!("Unknown or unresolved processing journal residue blocks release");
    }
    directory.sync_parent(&relative(format!("{run_path}/launch.json"))?)?;
    Ok(())
}

/// Verify the journal can safely outlive the fixed full current record.
pub(crate) fn compaction_state(root: &Path, run_id: Uuid) -> Result<()> {
    relative(run_id.to_string())?;
    let directory = ProjectDirectory::open(root)?;
    let path = format!("{AUTHORITY}/runs/{run_id}/launch.json");
    let bytes = match directory.read_regular(&relative(&path)?) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            require_no_residue(&directory, run_id, false)?;
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };
    let manifest = read_manifest(&bytes)?;
    validate_manifest(&manifest, &run_id.to_string())?;
    directory.sync_parent(&relative(&path)?)?;
    match manifest.phase {
        Phase::Cleaned | Phase::RolledBack => {
            require_no_residue(&directory, run_id, true)?;
            Ok(())
        }
        Phase::ExecutionCommitted => bail!("Processing journal cleanup remains unresolved"),
        _ => bail!("Processing journal cleanup remains unresolved"),
    }
}
fn validate_evidence(evidence: Option<&Evidence>, destination: &str) -> Result<()> {
    if let Some(evidence) = evidence {
        if evidence.directory != evidence.digest.is_none()
            || (!evidence.directory && !evidence.children.is_empty())
            || evidence.digest.as_ref().is_some_and(|digest| {
                digest.len() != 64
                    || !digest
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
        {
            bail!("Invalid owned evidence type");
        }
        let mut names = std::collections::BTreeSet::new();
        for (name, child) in &evidence.children {
            relative(name)?;
            if name.contains(['/', '\\']) || !names.insert(name) {
                bail!("Invalid owned child mapping");
            }
            let child_path = format!("{destination}/{name}");
            if !allowed_destination(&child_path) {
                bail!("Owned child escapes launch artifact namespace");
            }
            validate_evidence(Some(child), &child_path)?;
        }
    }
    Ok(())
}

use super::identifiers::module_index_to_name;
use super::journal::{LaunchJournal, Phase};
use anyhow::{Context, Result, bail};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug)]
pub(crate) struct LaunchTransaction {
    root: PathBuf,
    #[cfg(test)]
    targets: Vec<PathBuf>,
    journal: LaunchJournal,
    started: bool,
}

impl LaunchTransaction {
    pub(crate) fn plan(
        root: &Path,
        run_id: &str,
        b_process: &[bool],
        subject_regexp: &str,
        rerun_bids2legacy: bool,
    ) -> Result<Self> {
        let root = root
            .canonicalize()
            .with_context(|| format!("Failed to canonicalize project root {}", root.display()))?;
        let exploreasl = root.join("derivatives/ExploreASL");
        let directory = crate::fs_safety::ProjectDirectory::open(&root)?;
        let explore_path = crate::fs_safety::ProjectRelativePath::new("derivatives/ExploreASL")?;
        match directory.directory_names(&explore_path) {
            Ok(names)
                if names
                    .iter()
                    .any(|name| name.to_string_lossy().starts_with(".launch-transaction-")) =>
            {
                bail!(
                    "Unmapped legacy launch quarantine blocks execution; preserve files for recovery"
                )
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let lock_root = exploreasl.join("lock");
        let subject_re = (!subject_regexp.is_empty())
            .then(|| regex::Regex::new(subject_regexp))
            .transpose()
            .context("Invalid reserved subject regexp")?;
        let mut targets = Vec::new();
        let data_par = exploreasl.join("dataPar.json");
        if path_exists_no_follow(&data_par)? {
            require_supported(&data_par)?;
            targets.push(data_par);
        }

        if path_exists_no_follow(&lock_root)? {
            require_directory(&lock_root)?;
            // Stale lock ownership is global to the ExploreASL lock tree, not
            // limited to modules selected for this launch. A leftover lock in
            // an unselected module can otherwise block the new worker set.
            collect_stale_locked_targets(&lock_root, &mut targets)?;
            for (index, enabled) in b_process.iter().copied().enumerate() {
                if !enabled {
                    continue;
                }
                let module_root = lock_root.join(module_index_to_name(index));
                collect_lock_targets(&module_root, index, subject_re.as_ref(), &mut targets)?;
            }
            if rerun_bids2legacy {
                let bids = lock_root.join("xASL_module_BIDS2Legacy");
                if path_exists_no_follow(&bids)? {
                    require_directory(&bids)?;
                    for entry in
                        fs::read_dir(&bids).context("Failed to inspect BIDS2Legacy locks")?
                    {
                        let entry = entry?;
                        let name = entry.file_name().to_string_lossy().to_string();
                        if subject_re.as_ref().is_none_or(|re| re.is_match(&name)) {
                            require_directory(&entry.path())?;
                            targets.push(entry.path());
                        }
                    }
                }
            }
        }

        let log_dir = exploreasl.join("log");
        if path_exists_no_follow(&log_dir)? {
            require_directory(&log_dir)?;
            let subject_log_re =
                regex::Regex::new(r"sub-[^_]+_[^_.]+").expect("static subject log regexp");
            for entry in fs::read_dir(&log_dir).context("Failed to inspect processing logs")? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                let population_log = b_process.get(2).copied().unwrap_or(false)
                    && name == "xASL_module_Population.log";
                let enabled = b_process
                    .iter()
                    .copied()
                    .enumerate()
                    .any(|(index, selected)| {
                        if !selected || !name.ends_with(".log") {
                            return false;
                        }
                        if index == 2 {
                            return name == format!("{}.log", module_index_to_name(index));
                        }
                        name.starts_with(&format!("{}{}", module_index_to_name(index), "_"))
                    });
                let selected_subject = population_log
                    || subject_re.as_ref().is_none_or(|re| {
                        subject_log_re
                            .find(&name)
                            .is_some_and(|m| re.is_match(m.as_str()))
                    });
                if enabled && selected_subject {
                    require_file(&entry.path())?;
                    targets.push(entry.path());
                }
            }
        }
        targets.sort();
        targets.dedup();
        let non_overlapping = targets
            .iter()
            .filter(|target| {
                !targets
                    .iter()
                    .any(|other| other.as_path() != target.as_path() && target.starts_with(other))
            })
            .cloned()
            .collect();
        targets = non_overlapping;
        let journal = super::journal::LaunchJournal::new(&root, run_id, &targets)?;
        Ok(Self {
            root,
            #[cfg(test)]
            targets,
            journal,
            started: false,
        })
    }

    #[cfg(test)]
    pub(crate) fn targets(&self) -> &Vec<PathBuf> {
        &self.targets
    }

    #[cfg(test)]
    pub(crate) fn prepare(&mut self, data_par_json: &[u8]) -> Result<()> {
        self.prepare_artifacts(&[(
            "derivatives/ExploreASL/dataPar.json".into(),
            data_par_json.to_vec(),
        )])
    }
    pub(crate) fn prepare_artifacts(&mut self, installations: &[(String, Vec<u8>)]) -> Result<()> {
        if self.started {
            bail!("Launch transaction is already prepared");
        }
        self.started = true;
        let directory = crate::fs_safety::ProjectDirectory::open(&self.root)?;
        directory.create_dir_all_durable(&crate::fs_safety::ProjectRelativePath::new(
            "derivatives/ExploreASL",
        )?)?;
        self.journal.prepare(installations)
    }
    /// Persist the execution boundary before any scientific worker can start.
    pub(crate) fn commit(&mut self) -> Result<()> {
        self.journal.commit()
    }
    pub(crate) fn cleanup(&mut self) -> Result<()> {
        self.journal.cleanup()
    }
    pub(crate) fn rollback_pending(&self) -> bool {
        self.started && matches!(self.journal.phase(), Phase::Preparing | Phase::Prepared)
    }
    pub(crate) fn cleanup_pending(&self) -> bool {
        self.journal.phase() == Phase::ExecutionCommitted
    }
    pub(crate) fn rollback(&mut self) -> Result<()> {
        if !self.started {
            return Ok(());
        }
        self.journal.rollback()
    }
    pub(crate) fn reopen(root: &Path, run_id: &str) -> Result<Self> {
        Ok(Self {
            root: root.into(),
            #[cfg(test)]
            targets: Vec::new(),
            journal: LaunchJournal::reopen(root, run_id)?,
            started: true,
        })
    }
    pub(crate) fn reopen_confirmed(root: &Path, run_id: &str) -> Result<Self> {
        Ok(Self {
            root: root.into(),
            #[cfg(test)]
            targets: Vec::new(),
            journal: LaunchJournal::reopen_confirmed(root, run_id)?,
            started: true,
        })
    }
}

fn collect_lock_targets(
    module_root: &Path,
    module_index: usize,
    subject_re: Option<&regex::Regex>,
    targets: &mut Vec<PathBuf>,
) -> Result<()> {
    if !path_exists_no_follow(module_root)? {
        return Ok(());
    }
    require_directory(module_root)?;
    for entry in WalkDir::new(module_root).follow_links(false) {
        let entry = entry?;
        if entry.depth() == 0 {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(module_root)
            .expect("walk stays below module root");
        let subject_selected = module_index == 2
            || relative
                .components()
                .next()
                .and_then(|part| part.as_os_str().to_str())
                .is_some_and(|subject| subject_re.is_none_or(|re| re.is_match(subject)));
        if !subject_selected {
            continue;
        }
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == "locked" || name.ends_with(".status"))
            {
                bail!(
                    "Unsafe symbolic link in launch artifact scope: {}",
                    path.display()
                );
            }
            continue;
        }
        let status_named = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".status"));
        if status_named && !metadata.is_file() {
            bail!("Unsupported launch artifact entry: {}", path.display());
        }
        let selected = metadata.is_file() && status_named;
        if selected {
            targets.push(path.to_path_buf());
        }
    }
    Ok(())
}

fn collect_stale_locked_targets(lock_root: &Path, targets: &mut Vec<PathBuf>) -> Result<()> {
    for entry in WalkDir::new(lock_root).follow_links(false) {
        let entry = entry?;
        if entry.depth() == 0 || entry.file_name() != "locked" {
            continue;
        }
        let path = entry.path();
        require_directory(path).with_context(|| {
            format!(
                "Unsafe stale lock artifact in launch scope: {}",
                path.display()
            )
        })?;
        targets.push(path.to_path_buf());
    }
    Ok(())
}

fn require_supported(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        bail!("Unsupported launch artifact entry: {}", path.display());
    }
    Ok(())
}

fn require_file(path: &Path) -> Result<()> {
    require_supported(path)?;
    if !fs::symlink_metadata(path)?.is_file() {
        bail!("Expected launch artifact file: {}", path.display());
    }
    Ok(())
}

fn require_directory(path: &Path) -> Result<()> {
    require_supported(path)?;
    if !fs::symlink_metadata(path)?.is_dir() {
        bail!("Expected launch artifact directory: {}", path.display());
    }
    Ok(())
}

/// `Path::exists` follows links and reports a dangling link as absent. Every
/// launch artifact decision must use lstat semantics so a link can never be
/// treated as a safe missing destination and subsequently followed by write.
fn path_exists_no_follow(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

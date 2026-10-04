//! Read-only plans for BIDS/DICOM project creation and BIDS compatibility repair.
use super::filesystem::{
    EntryKind, Fingerprint, canonical_root, classify_marker, fixed_path, inspect, random_id,
    read_regular, validate_fixed_hierarchy,
};
use super::{
    MarkerClassification, OperationKind, RAWDATA_MARKER_BYTES, RAWDATA_MARKER_PATH,
    SetupCommitResult, SetupMode, SetupOperation, SetupPlan, SetupPlans,
};
use crate::project::validation::parse_summary;
use anyhow::{Context, Result, anyhow, bail};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub(super) const PLAN_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone)]
pub(super) struct CachedPlan {
    pub(super) displayed: SetupPlan,
    pub(super) root: PathBuf,
    pub(super) mode: SetupMode,
    pub(super) project_bytes: Option<Vec<u8>>,
    pub(super) marker_bytes: Option<Vec<u8>>,
    pub(super) ignore_bytes: Option<Vec<u8>>,
    pub(super) observations: BTreeMap<String, Fingerprint>,
    pub(super) created: SystemTime,
    pub(super) claimed: bool,
    pub(super) result: Option<SetupCommitResult>,
    pub(super) terminal_failure: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnorePlan {
    pub operation: OperationKind,
    pub bytes: Vec<u8>,
}
pub fn plan_bidsignore(existing: Option<&[u8]>, mode: SetupMode) -> Result<IgnorePlan> {
    let required: &[&str] = match mode {
        SetupMode::Bids | SetupMode::Repair => &["project.easl", ".easl_staging", "rawdata/"],
        SetupMode::Dicom => &["project.easl", ".easl_staging"],
    };
    let Some(existing) = existing else {
        let mut bytes = required.join("\n").into_bytes();
        bytes.push(b'\n');
        return Ok(IgnorePlan {
            operation: OperationKind::Create,
            bytes,
        });
    };
    let text =
        std::str::from_utf8(existing).map_err(|_| anyhow!(".bidsignore is not valid UTF-8"))?;
    let present: BTreeSet<&str> = text
        .split('\n')
        .map(|line| line.trim().trim_end_matches('\r').trim())
        .collect();
    let missing: Vec<_> = required
        .iter()
        .copied()
        .filter(|entry| !present.contains(entry))
        .collect();
    if missing.is_empty() {
        return Ok(IgnorePlan {
            operation: OperationKind::NoOp,
            bytes: existing.to_vec(),
        });
    }
    let newline = match text.as_bytes().windows(2).position(|pair| pair == b"\r\n") {
        Some(_) => b"\r\n".as_slice(),
        None => b"\n".as_slice(),
    };
    let mut bytes = existing.to_vec();
    // A bare CR is part of an unfinished separator: finish it, do not add CRLF.
    if bytes.ends_with(b"\r") {
        bytes.push(b'\n');
    } else if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        bytes.extend_from_slice(newline);
    }
    for entry in missing {
        bytes.extend_from_slice(entry.as_bytes());
        bytes.extend_from_slice(newline);
    }
    Ok(IgnorePlan {
        operation: OperationKind::Update,
        bytes,
    })
}

fn preview(bytes: &[u8]) -> Option<String> {
    String::from_utf8(bytes.to_vec()).ok()
}
fn observe_fixed(root: &Path, mode: SetupMode) -> Result<BTreeMap<String, Fingerprint>> {
    let paths: &[&str] = match mode {
        SetupMode::Dicom => &["project.easl", ".bidsignore"],
        // `project.easl` determines whether repair is authorized. It is not an
        // operation, but it must be observed and revalidated so a BIDS repair
        // plan cannot be applied after the project becomes a different kind of
        // project (or is replaced by an unsafe entry).
        SetupMode::Repair => &[
            "project.easl",
            ".bidsignore",
            "rawdata",
            RAWDATA_MARKER_PATH,
        ],
        SetupMode::Bids => &[
            "project.easl",
            ".bidsignore",
            "rawdata",
            RAWDATA_MARKER_PATH,
        ],
    };
    paths
        .iter()
        .map(|path| {
            Ok((
                (*path).to_owned(),
                inspect(&fixed_path(root, path)?, *path != "rawdata")?,
            ))
        })
        .collect()
}
fn rawdata_subject_count(root: &Path) -> Result<usize> {
    let rawdata = fixed_path(root, "rawdata")?;
    let mut count = 0;
    for item in fs::read_dir(rawdata).context("Could not read rawdata directory")? {
        let item = item?;
        let ty = item.file_type()?;
        if ty.is_dir() && !ty.is_symlink() && item.file_name().to_string_lossy().starts_with("sub-")
        {
            count += 1;
        }
    }
    Ok(count)
}
pub(super) fn preflight(
    root: &Path,
    mode: SetupMode,
    project_bytes: Option<Vec<u8>>,
) -> Result<CachedPlan> {
    let root = canonical_root(root)?;
    if mode == SetupMode::Repair && project_bytes.is_some() {
        bail!("Repair must not replace project.easl");
    }
    if mode == SetupMode::Repair {
        let project_path = fixed_path(&root, "project.easl")?;
        let project_bytes = read_regular(&project_path)?
            .ok_or_else(|| anyhow!("BIDS setup repair requires an existing project.easl"))?;
        let summary = parse_summary(&project_bytes)?;
        if summary.data_source != "bids" {
            bail!("BIDS setup repair requires a BIDS-direct project");
        }
    }
    let summary = project_bytes.as_deref().map(parse_summary).transpose()?;
    if mode != SetupMode::Repair && summary.is_none() {
        bail!("Project payload is required for setup");
    }
    if let Some(summary) = &summary {
        let wanted = if mode == SetupMode::Bids {
            "bids"
        } else {
            "dicom"
        };
        if summary.data_source != wanted {
            bail!("Project data source does not match selected setup mode");
        }
    }
    let observations = observe_fixed(&root, mode)?;
    let mut operations = Vec::new();
    let mut warnings = Vec::new();
    let mut conflicts = Vec::new();
    if mode != SetupMode::Repair {
        let project = &observations["project.easl"];
        let operation = if project.kind == EntryKind::Missing {
            OperationKind::Create
        } else {
            conflicts
                .push("project.easl already exists or is not a safe replacement target".into());
            OperationKind::NoOp
        };
        operations.push(SetupOperation {
            path: "project.easl".into(),
            operation,
            text_preview: None,
        });
    }
    let ignore_existing = match read_regular(&fixed_path(&root, ".bidsignore")?) {
        Ok(value) => value,
        Err(error) => {
            conflicts.push(error.to_string());
            None
        }
    };
    let ignore_plan = match plan_bidsignore(ignore_existing.as_deref(), mode) {
        Ok(plan) => Some(plan),
        Err(error) => {
            conflicts.push(error.to_string());
            None
        }
    };
    if let Some(plan) = &ignore_plan {
        operations.push(SetupOperation {
            path: ".bidsignore".into(),
            operation: plan.operation,
            text_preview: (plan.operation != OperationKind::NoOp)
                .then(|| preview(&plan.bytes))
                .flatten(),
        });
    }
    let mut marker_bytes = None;
    if matches!(mode, SetupMode::Bids | SetupMode::Repair) {
        match observations["rawdata"].kind {
            EntryKind::Missing => operations.push(SetupOperation {
                path: "rawdata/".into(),
                operation: OperationKind::Create,
                text_preview: None,
            }),
            EntryKind::Directory => {
                operations.push(SetupOperation {
                    path: "rawdata/".into(),
                    operation: OperationKind::NoOp,
                    text_preview: None,
                });
                let count = rawdata_subject_count(&root)?;
                if count > 0 {
                    warnings.push(format!("rawdata/ contains {count} sub-* directories; BIDS-direct processing ignores them."));
                }
            }
            _ => conflicts.push("rawdata must be a directory, not a symlink or file".into()),
        }
        if !matches!(
            observations["rawdata"].kind,
            EntryKind::Missing | EntryKind::Directory
        ) {
            operations.push(SetupOperation {
                path: RAWDATA_MARKER_PATH.into(),
                operation: OperationKind::NoOp,
                text_preview: None,
            });
        } else {
            match classify_marker(&root)? {
                MarkerClassification::Absent => {
                    marker_bytes = Some(RAWDATA_MARKER_BYTES.to_vec());
                    operations.push(SetupOperation {
                        path: RAWDATA_MARKER_PATH.into(),
                        operation: OperationKind::Create,
                        text_preview: preview(RAWDATA_MARKER_BYTES),
                    });
                }
                MarkerClassification::Exact => operations.push(SetupOperation {
                    path: RAWDATA_MARKER_PATH.into(),
                    operation: OperationKind::NoOp,
                    text_preview: None,
                }),
                MarkerClassification::Foreign => {
                    conflicts.push("rawdata/.easl-gui-managed is not this GUI's marker".into())
                }
                MarkerClassification::Unsafe => conflicts
                    .push("rawdata/.easl-gui-managed must be a regular non-symlink file".into()),
            }
        }
    }
    let displayed = SetupPlan { plan_id: random_id("setup"), root_path: root.to_string_lossy().into_owned(), mode, operations, warnings, conflicts, project_summary: summary, preserves_readme: true, temporary_artifacts: vec!["Same-parent candidates, validated backups, a root journal, and an app-data pending registry are removed after commit or recovery.".into()] };
    Ok(CachedPlan {
        displayed,
        root,
        mode,
        project_bytes,
        marker_bytes,
        ignore_bytes: ignore_plan
            .and_then(|p| (p.operation != OperationKind::NoOp).then_some(p.bytes)),
        observations,
        created: SystemTime::now(),
        claimed: false,
        result: None,
        terminal_failure: None,
    })
}
pub(super) fn check_fresh(plan: &CachedPlan) -> Result<()> {
    if plan
        .created
        .elapsed()
        .unwrap_or(PLAN_TTL + Duration::from_secs(1))
        > PLAN_TTL
    {
        bail!("Setup plan expired; review a fresh plan");
    }
    if canonical_root(&plan.root)? != plan.root {
        bail!("Project root changed after preflight");
    }
    for path in plan.observations.keys() {
        let path = fixed_path(&plan.root, path)?;
        // A missing final component is valid; each existing parent must still
        // be a real directory rather than a swapped link.
        if path.parent().is_some_and(|parent| parent.exists()) {
            validate_fixed_hierarchy(&plan.root, &path)?;
        }
    }
    if observe_fixed(&plan.root, plan.mode)? != plan.observations {
        bail!("Setup plan is stale; controlled paths changed after review");
    }
    if !plan.displayed.conflicts.is_empty() {
        bail!("Setup plan contains blocking conflicts");
    }
    Ok(())
}

pub fn preflight_for_state(
    plans: &SetupPlans,
    root: String,
    mode: SetupMode,
    project_bytes: Option<String>,
) -> Result<SetupPlan> {
    let cached = preflight(
        Path::new(&root),
        mode,
        project_bytes.map(String::into_bytes),
    )?;
    let displayed = cached.displayed.clone();
    let mut cache = plans
        .0
        .lock()
        .map_err(|_| anyhow!("Setup plan cache unavailable"))?;
    // A new plan for a root supersedes uncommitted plans for every option.
    cache.retain(|_, plan| plan.root != cached.root || plan.result.is_some() || plan.claimed);
    cache.insert(displayed.plan_id.clone(), cached);
    Ok(displayed)
}

pub fn verify(root: &Path) -> Result<()> {
    let root = canonical_root(root)?;
    if inspect(&fixed_path(&root, "rawdata")?, false)?.kind != EntryKind::Directory {
        bail!(
            "BIDS compatibility setup is missing rawdata/. Review setup repair before processing."
        );
    }
    let marker = read_regular(&fixed_path(&root, RAWDATA_MARKER_PATH)?)?.ok_or_else(|| {
        anyhow!("BIDS compatibility marker is missing. Review setup repair before processing.")
    })?;
    if marker != RAWDATA_MARKER_BYTES {
        bail!("BIDS compatibility marker is invalid. Review setup repair before processing.");
    }
    Ok(())
}

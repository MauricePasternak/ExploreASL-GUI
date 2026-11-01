use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::super::filesystem::{EntryKind, hash, random_id};
use super::super::{OperationKind, SetupPlan};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct SourceEntry {
    pub(super) kind: EntryKind,
    pub(super) len: u64,
    pub(super) digest: Option<String>,
}

pub(super) fn source_snapshot(root: &Path) -> BTreeMap<PathBuf, SourceEntry> {
    WalkDir::new(root)
        .follow_links(false)
        // The selected root itself is not a source-tree entry. Its
        // directory size is filesystem-dependent and would otherwise
        // obscure the reviewed child-path delta.
        .min_depth(1)
        .into_iter()
        .map(|entry| entry.unwrap())
        // OS ownership bootstrap directories are GUI authority, outside
        // reviewed BIDS mutations. Keep every other entry (including unknown
        // GUI files) in the byte inventory.
        .filter(|entry| {
            let relative = entry.path().strip_prefix(root).unwrap();
            !(entry.file_type().is_dir()
                && [
                    "derivatives",
                    "derivatives/ExploreASL_GUI",
                    "derivatives/ExploreASL_GUI/execution",
                ]
                .iter()
                .any(|path| relative == Path::new(path)))
        })
        .map(|entry| {
            let path = entry.path();
            let metadata = fs::symlink_metadata(path).unwrap();
            let kind = if metadata.file_type().is_symlink() {
                EntryKind::Symlink
            } else if metadata.is_dir() {
                EntryKind::Directory
            } else if metadata.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let digest = metadata.is_file().then(|| hash(&fs::read(path).unwrap()));
            (
                path.strip_prefix(root).unwrap().to_path_buf(),
                SourceEntry {
                    kind,
                    len: metadata.len(),
                    digest,
                },
            )
        })
        .collect()
}

pub(super) fn changed_source_paths(
    before: &BTreeMap<PathBuf, SourceEntry>,
    after: &BTreeMap<PathBuf, SourceEntry>,
) -> BTreeSet<String> {
    before
        .keys()
        .chain(after.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|path| before.get(*path) != after.get(*path))
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .collect()
}

pub(super) fn reviewed_changed_paths(plan: &SetupPlan) -> BTreeSet<String> {
    plan.operations
        .iter()
        .filter(|operation| operation.operation != OperationKind::NoOp)
        .map(|operation| operation.path.trim_end_matches('/').to_owned())
        .collect()
}

pub(super) fn assert_confirmed_delta(
    root: &Path,
    before: &BTreeMap<PathBuf, SourceEntry>,
    plan: &SetupPlan,
) {
    let after = source_snapshot(root);
    assert_eq!(
        changed_source_paths(before, &after),
        reviewed_changed_paths(plan),
        "only reviewed, confirmed operation paths may differ: {:?}",
        plan.operations
    );
    for operation in &plan.operations {
        if let Some(preview) = &operation.text_preview {
            assert_eq!(
                fs::read(root.join(operation.path.trim_end_matches('/'))).unwrap(),
                preview.as_bytes(),
                "{} must equal its reviewed text preview",
                operation.path
            );
        }
    }
    if let Some(summary) = &plan.project_summary {
        assert_eq!(
            hash(&fs::read(root.join("project.easl")).unwrap()),
            summary.content_hash,
            "project.easl must equal the reviewed project summary hash"
        );
    }
}

pub(super) fn write_bids_fixture(root: &Path, bidsignore: Option<&[u8]>) {
    fs::write(
        root.join("dataset_description.json"),
        br#"{"Name":"Source snapshot fixture","BIDSVersion":"1.9.0"}"#,
    )
    .unwrap();
    fs::create_dir_all(root.join("sub-01/perf")).unwrap();
    fs::write(root.join("sub-01/perf/sub-01_asl.nii.gz"), b"nii bytes").unwrap();
    fs::write(root.join("sub-01/perf/sub-01_asl.json"), b"{}").unwrap();
    fs::write(
        root.join("sub-01/perf/sub-01_aslcontext.tsv"),
        b"volume_type\ncontrol\nlabel\n",
    )
    .unwrap();
    if let Some(bytes) = bidsignore {
        fs::write(root.join(".bidsignore"), bytes).unwrap();
    }
}

pub(super) fn project(source: &str) -> Vec<u8> {
    serde_json::to_string_pretty(&serde_json::json!({
        "schemaVersion": 2,
        "projectMeta": {
            "id": "11111111-1111-4111-8111-111111111111",
            "name": "name",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "lastOpened": "2026-01-01T00:00:00.000Z",
            "currentPhase": "import",
            "dataSource": source,
        },
        "uiState": {"manifest": {
            "reviewers": [{"id": "11111111-1111-4111-8111-111111111111", "label": "Reviewer 1", "createdAt": "2026-01-01T00:00:00Z"}],
            "activeReviewerId": "11111111-1111-4111-8111-111111111111",
            "verdicts": {}, "resolvedVerdicts": {}
        }},
        "mappingState": {},
        "dataPar": {},
    }))
    .unwrap()
    .into_bytes()
}

pub(super) fn identities() -> (String, String, String) {
    (
        random_id("transaction"),
        random_id("journal"),
        random_id("registry"),
    )
}

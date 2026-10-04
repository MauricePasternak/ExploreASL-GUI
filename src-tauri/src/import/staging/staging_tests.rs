use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use tempfile::tempdir;

    #[derive(Deserialize)]
    struct ComponentVector {
        value: String,
        valid: bool,
    }
    #[derive(Deserialize)]
    struct KeyVector {
        value: String,
        key: String,
    }
    #[derive(Deserialize)]
    struct Vectors {
        components: Vec<ComponentVector>,
        #[serde(rename = "portableKeys")]
        portable_keys: Vec<KeyVector>,
    }

    #[test]
    fn shared_identifier_vectors_match_native_policy() {
        let vectors: Vectors = serde_json::from_str(include_str!(
            "../../../../test/fixtures/staging_identifier_vectors.json"
        ))
        .expect("shared vectors");
        for vector in vectors.components {
            assert_eq!(
                validate_component(&vector.value).is_ok(),
                vector.valid,
                "{}",
                vector.value
            );
        }
        for vector in vectors.portable_keys {
            assert_eq!(portable_key(&vector.value), vector.key);
        }
    }

    fn entry(source: &Path) -> StagingEntry {
        StagingEntry {
            subject: "A01".into(),
            session: "01".into(),
            run: "01".into(),
            run_alias: "ASL1".into(),
            modality: "ASL4D".into(),
            original_subject: "source-a".into(),
            original_session: "visit-a".into(),
            original_run: "run-a".into(),
            source_path: source.display().to_string(),
        }
    }

    #[test]
    fn planner_requires_active_root_and_derives_root_from_active_project() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let sibling = workspace.path().join("sibling");
        let source = workspace.path().join("source.dcm");
        fs::create_dir_all(&project).expect("project");
        fs::create_dir_all(&sibling).expect("sibling");
        fs::write(&source, "dcm").expect("source");
        assert!(!preflight_staging_plan_for_state(&AppState::default(), &[entry(&source)]).valid);
        let result = compile_staging_plan(Some(project.clone()), &[entry(&source)])
            .expect("active-root plan");
        assert_eq!(
            result.staging_root,
            project.canonicalize().unwrap().join(STAGING_DIRECTORY)
        );
        assert!(!sibling.join(STAGING_DIRECTORY).exists());
    }

    #[cfg(unix)]
    #[test]
    fn planner_uses_canonical_root_when_project_was_opened_through_parent_symlink() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let project_alias = workspace.path().join("project-alias");
        let source = workspace.path().join("source.dcm");
        fs::create_dir_all(&project).expect("project");
        fs::write(&source, "dcm").expect("source");
        std::os::unix::fs::symlink(&project, &project_alias).expect("project alias");

        let state = AppState::default();
        crate::project::lifecycle::set_active_project_impl(
            project_alias.display().to_string(),
            &state,
        )
        .expect("set active project through parent symlink");
        let active = state
            .active_project_root
            .lock()
            .expect("active root")
            .clone();
        let plan = compile_staging_plan(active, &[entry(&source)])
            .expect("parent symlink project open must compile");

        assert_eq!(
            plan.staging_root,
            project.canonicalize().unwrap().join(STAGING_DIRECTORY)
        );
    }

    #[cfg(unix)]
    #[test]
    fn planner_rejects_an_existing_staging_root_symlink() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let outside = workspace.path().join("outside");
        let source = workspace.path().join("source.dcm");
        fs::create_dir_all(&project).expect("project");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(&source, "dcm").expect("source");
        std::os::unix::fs::symlink(&outside, project.join(STAGING_DIRECTORY))
            .expect("staging symlink");

        let result = compile_staging_plan(Some(project), &[entry(&source)])
            .expect_err("staging symlink must be rejected");

        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.code == StagingIssueCode::StagingRootSymlink)
        );
    }

    #[cfg(unix)]
    #[test]
    fn planner_rejects_sourcedata_and_nested_destination_symlinks_without_mutation() {
        use std::os::unix::fs::symlink;

        for (name, link_path, link_target) in [
            ("sourcedata-to-staging", "sourcedata", ".easl_staging"),
            ("sourcedata-to-project", "sourcedata", "."),
            ("nested-internal", "sourcedata/A01", ".easl_staging"),
            ("nested-external", "sourcedata/A01/01", "outside"),
            (
                "modality-internal",
                "sourcedata/A01/01/01/ASL4D",
                ".easl_staging",
            ),
        ] {
            let workspace = tempdir().expect("workspace");
            let project = workspace.path().join("project");
            let staging = project.join(STAGING_DIRECTORY);
            let outside = workspace.path().join("outside");
            let source = workspace.path().join("source.dcm");
            fs::create_dir_all(&staging).expect("staging");
            fs::create_dir_all(&outside).expect("outside");
            fs::write(&source, "dcm").expect("source");
            let sentinel = staging.join("sentinel.txt");
            fs::write(&sentinel, "unchanged").expect("sentinel");

            let link = staging.join(link_path);
            fs::create_dir_all(link.parent().expect("link parent")).expect("link parent");
            let target = match link_target {
                ".easl_staging" => staging.clone(),
                "." => project.clone(),
                "outside" => outside,
                _ => unreachable!("known target"),
            };
            symlink(target, &link).expect(name);

            let result = compile_staging_plan(Some(project), &[entry(&source)])
                .expect_err("destination symlink must be rejected");

            assert!(result.issues.iter().any(|issue| {
                issue.code == StagingIssueCode::DestinationSymlink
                    && issue.field == StagingField::Destination
            }));
            assert_eq!(fs::read_to_string(sentinel).expect("sentinel"), "unchanged");
        }
    }

    #[test]
    fn compiled_plan_uses_canonical_active_root_for_execution_root() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let source = workspace.path().join("source.dcm");
        fs::create_dir_all(&project).expect("project");
        fs::write(&source, "dcm").expect("source");

        let plan = compile_staging_plan(Some(project.clone()), &[entry(&source)]).expect("plan");

        assert_eq!(
            plan.staging_root,
            fs::canonicalize(&project)
                .expect("canonical project")
                .join(STAGING_DIRECTORY)
        );
        execute_compiled_staging_plan(&plan).expect("compiled plan executes");
        assert!(
            plan.staging_root
                .join("sourcedata/A01/01/01/ASL4D/source.dcm")
                .exists()
        );
    }

    #[test]
    fn planner_permits_shared_tuple_unique_files_and_rejects_distinct_tuple_collision() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let source_dir = workspace.path().join("source");
        fs::create_dir_all(&project).expect("project");
        fs::create_dir_all(&source_dir).expect("source");
        fs::write(source_dir.join("one.dcm"), "1").expect("one");
        fs::write(source_dir.join("two.dcm"), "2").expect("two");
        let first = entry(&source_dir);
        let mut second = entry(&source_dir);
        second.source_path = source_dir.display().to_string();
        let plan = compile_staging_plan(Some(project.clone()), std::slice::from_ref(&first))
            .expect("single dir source");
        assert_eq!(plan.records.len(), 2);
        second.original_run = "run-b".into();
        let result = compile_staging_plan(Some(project.clone()), &[first, second])
            .expect_err("different tuple collision");
        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.field == StagingField::Destination)
        );
    }

    #[test]
    fn planner_rejects_portable_final_spelling_variants_even_with_matching_provenance() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let source_a = workspace.path().join("a.dcm");
        let source_b = workspace.path().join("b.dcm");
        fs::create_dir_all(&project).expect("project");
        fs::write(&source_a, "a").expect("source a");
        fs::write(&source_b, "b").expect("source b");

        let first = entry(&source_a);
        let mut case_variant = entry(&source_b);
        case_variant.subject = "a01".into();
        let case_result =
            compile_staging_plan(Some(project.clone()), &[first.clone(), case_variant])
                .expect_err("A01 and a01 must not aggregate");
        assert_eq!(
            case_result
                .issues
                .iter()
                .filter(|issue| {
                    issue.code == StagingIssueCode::PortableCollision
                        && issue.field == StagingField::Destination
                })
                .map(|issue| (issue.entry_index, issue.conflicting_entry_index))
                .collect::<Vec<_>>(),
            vec![(Some(0), Some(1)), (Some(1), Some(0))]
        );

        let mut unicode_variant = entry(&source_b);
        unicode_variant.session = "CafÉ".into();
        let mut unicode_first = first;
        unicode_first.session = "Café".into();
        let unicode_result =
            compile_staging_plan(Some(project.clone()), &[unicode_first, unicode_variant])
                .expect_err("Unicode-equivalent final spelling must not aggregate");
        assert_eq!(
            unicode_result
                .issues
                .iter()
                .filter(|issue| {
                    issue.code == StagingIssueCode::PortableCollision
                        && issue.field == StagingField::Destination
                })
                .map(|issue| (issue.entry_index, issue.conflicting_entry_index))
                .collect::<Vec<_>>(),
            vec![(Some(0), Some(1)), (Some(1), Some(0))]
        );
    }

    #[test]
    fn executor_only_uses_compiled_records() {
        let workspace = tempdir().expect("workspace");
        let source = workspace.path().join("source.dcm");
        let destination = workspace
            .path()
            .join("project/.easl_staging/sourcedata/A01/01/01/ASL4D/source.dcm");
        fs::write(&source, "dcm").expect("source");
        execute_compiled_staging_plan(&CompiledStagingPlan {
            staging_root: workspace.path().join("project/.easl_staging"),
            records: vec![CompiledFileRecord {
                source,
                destination: destination.clone(),
            }],
        })
        .expect("execute");
        assert!(destination.exists());
    }

    #[test]
    fn planner_aggregates_component_source_and_portable_collisions_without_mutation() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let source = workspace.path().join("source.dcm");
        let sentinel = project.join(STAGING_DIRECTORY).join("sentinel.txt");
        fs::create_dir_all(sentinel.parent().expect("parent")).expect("staging");
        fs::write(&sentinel, "unchanged").expect("sentinel");
        fs::write(&source, "dcm").expect("source");
        let mut invalid = entry(&source);
        invalid.session = "../escape".into();
        let mut missing = entry(&workspace.path().join("missing.dcm"));
        missing.original_subject = "source-b".into();
        missing.subject = "a01".into();
        let mut collision = entry(&source);
        collision.original_subject = "source-c".into();
        collision.subject = "a01".into();
        let result = compile_staging_plan(Some(project.clone()), &[invalid, missing, collision])
            .expect_err("aggregate failures");
        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.code == StagingIssueCode::SeparatorComponent)
        );
        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.code == StagingIssueCode::SourceMissing)
        );
        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.code == StagingIssueCode::PortableCollision)
        );
        assert_eq!(
            fs::read_to_string(sentinel).expect("sentinel remains"),
            "unchanged"
        );
        assert!(result.issues.windows(2).all(|pair| {
            (
                pair[0].entry_index.unwrap_or(usize::MAX),
                &pair[0].field,
                &pair[0].code,
            ) <= (
                pair[1].entry_index.unwrap_or(usize::MAX),
                &pair[1].field,
                &pair[1].code,
            )
        }));
    }

    #[test]
    fn planner_rejects_source_inside_staging_and_portable_filename_collisions() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = project.join(STAGING_DIRECTORY);
        let source_a = workspace.path().join("files-a");
        let source_b = workspace.path().join("files-b");
        fs::create_dir_all(staging.join("input")).expect("staging");
        fs::create_dir_all(&source_a).expect("source a");
        fs::create_dir_all(&source_b).expect("source b");
        fs::write(source_a.join("Scan.DCM"), "a").expect("a");
        fs::write(source_b.join("scan.dcm"), "b").expect("b");
        let inside = entry(&staging.join("input"));
        let mut left = entry(&source_a);
        left.original_subject = "source-a".into();
        let mut right = entry(&source_b);
        right.original_subject = "source-b".into();
        let result = compile_staging_plan(Some(project.clone()), &[inside, left, right])
            .expect_err("inside and filename collision");
        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.code == StagingIssueCode::SourceInsideStaging)
        );
        assert!(
            result
                .issues
                .iter()
                .any(|issue| issue.field == StagingField::Destination
                    && issue.conflicting_entry_index.is_some())
        );
        assert!(!staging.join("sourcedata").exists());
    }

    #[test]
    fn preflight_response_uses_camel_case_wire_fields() {
        let response = StagingPreflightResult {
            valid: false,
            issues: vec![StagingValidationIssue {
                code: StagingIssueCode::PortableCollision,
                field: StagingField::SourcePath,
                entry_index: Some(2),
                conflicting_entry_index: Some(4),
                message: "collision".into(),
                suggestion: None,
            }],
        };
        assert_eq!(
            serde_json::to_value(response).expect("response serializes"),
            serde_json::json!({
                "valid": false,
                "issues": [{
                    "code": "PORTABLE_COLLISION",
                    "field": "sourcePath",
                    "entryIndex": 2,
                    "conflictingEntryIndex": 4,
                    "message": "collision"
                }]
            })
        );
    }

    #[test]
    fn generation_preparation_matrix_isolated_retry_only_and_rolls_back() {
        use crate::import::status::copy_lock_files_paths;
        use crate::import::verification::{STAGING_GENERATION_MARKER, prepare_generation};
        use crate::import::{import_lock_dir_for_relocation, rollback_preparation_failure};

        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = project.join(STAGING_DIRECTORY);
        fs::create_dir_all(&staging).expect("staging");
        let selected = "SELECTED".to_string();
        let preserved = "PRESERVED".to_string();

        // A fresh marker is durable, selected evidence starts absent, and a
        // copied retry lock stays in its unselected, explicitly-authorized scope.
        let marker = prepare_generation(&staging, std::slice::from_ref(&selected))
            .expect("fresh generation");
        assert_eq!(
            fs::read_to_string(staging.join(STAGING_GENERATION_MARKER)).unwrap(),
            marker
        );
        assert!(
            !import_lock_dir_for_relocation(&staging, &selected)
                .join("999_ready.status")
                .exists()
        );
        let prior = import_lock_dir_for_relocation(&project, &preserved);
        fs::create_dir_all(&prior).unwrap();
        fs::write(prior.join("010_DCM2NII.status"), "converted").unwrap();
        fs::write(prior.join("020_NII2BIDS.status"), "bids").unwrap();
        fs::write(prior.join("999_ready.status"), "prior committed").unwrap();
        copy_lock_files_paths(&project, &staging, std::slice::from_ref(&preserved)).unwrap();
        assert!(
            import_lock_dir_for_relocation(&staging, &preserved)
                .join("999_ready.status")
                .is_file()
        );
        assert!(
            !import_lock_dir_for_relocation(&staging, &selected)
                .join("999_ready.status")
                .exists()
        );

        // A stale selected lock rejects preparation before another marker can
        // be issued, and preparation failure removes only owned staging.
        fs::remove_file(staging.join(STAGING_GENERATION_MARKER)).unwrap();
        let selected_lock = import_lock_dir_for_relocation(&staging, &selected);
        fs::create_dir_all(&selected_lock).unwrap();
        fs::write(selected_lock.join("999_ready.status"), "stale").unwrap();
        assert!(prepare_generation(&staging, std::slice::from_ref(&selected)).is_err());
        assert_eq!(
            rollback_preparation_failure(&staging, "write failed".to_string()),
            "write failed"
        );
        assert!(!staging.exists());
        assert!(prior.join("999_ready.status").is_file());
    }
}

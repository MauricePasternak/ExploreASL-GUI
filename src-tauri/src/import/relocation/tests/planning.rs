use crate::import_relocation::{
    bind_plan, create_plan, inventory_subject, plan_relocation, relocate, validate_plan_scope,
};
use std::fs;
use tempfile::tempdir;

#[test]
fn planner_reports_empty_and_populated_project_relative_subject_inventories() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(&project).expect("project");

    let empty = plan_relocation(&project, &["A".to_string()]).expect("empty plan");
    assert!(empty.subjects[0].entries.is_empty());

    fs::create_dir_all(project.join("rawdata/sub-A/ses-01")).expect("rawdata");
    fs::write(project.join("rawdata/sub-A/ses-01/asl.nii"), "old").expect("file");
    fs::create_dir_all(project.join("rawdata/sub-A/ses-02")).expect("extra session");
    fs::write(project.join("rawdata/sub-A/obsolete.json"), "old").expect("extra file");
    let inventory = inventory_subject(&project, "A").expect("inventory");

    assert_eq!(inventory.sessions, vec!["ses-01", "ses-02"]);
    assert!(
        inventory
            .entries
            .iter()
            .all(|entry| !std::path::Path::new(&entry.path).is_absolute())
    );
    assert!(
        inventory
            .entries
            .iter()
            .any(|entry| entry.path == "rawdata/sub-A/obsolete.json")
    );
    assert!(
        inventory
            .entries
            .iter()
            .any(|entry| entry.path == "rawdata/sub-A/ses-02")
    );
}

#[test]
fn planner_fingerprint_is_deterministic_and_scoped_to_rawdata() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("rawdata");
    fs::write(project.join("rawdata/sub-A/image.nii"), "old").expect("rawdata file");
    fs::create_dir_all(project.join("derivatives/ExploreASL/log")).expect("log dir");
    fs::write(
        project.join("derivatives/ExploreASL/log/import_sub-A.log"),
        "log",
    )
    .expect("log");
    fs::create_dir_all(
        project.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-A_ses-01"),
    )
    .expect("legacy lock");

    let first = inventory_subject(&project, "A").expect("first");
    fs::write(
        project.join("derivatives/ExploreASL/log/import_sub-A.log"),
        "changed derived log",
    )
    .unwrap();
    fs::remove_dir_all(
        project.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-A_ses-01"),
    )
    .unwrap();
    let second = inventory_subject(&project, "A").expect("second");
    assert_eq!(first.fingerprint, second.fingerprint);
    assert_eq!(first.file_count, 1);
    assert!(
        first
            .entries
            .iter()
            .all(|entry| entry.path.starts_with("rawdata/sub-A"))
    );
}

#[cfg(unix)]
#[test]
fn planner_rejects_symlink_entries_and_unsafe_project_roots() {
    use std::os::unix::fs::symlink;

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("rawdata");
    symlink("/etc/passwd", project.join("rawdata/sub-A/escape")).expect("symlink");
    assert!(inventory_subject(&project, "A").is_err());
    assert!(plan_relocation(&workspace.path().join("missing"), &["A".to_string()]).is_err());
}

#[cfg(unix)]
#[test]
fn planner_rejects_symlink_and_special_rawdata_ancestors() {
    use std::os::unix::fs::symlink;
    use std::process::Command;

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let external = workspace.path().join("external");
    fs::create_dir_all(external.join("sub-A")).unwrap();
    fs::create_dir_all(&project).unwrap();
    symlink(&external, project.join("rawdata")).unwrap();
    assert!(inventory_subject(&project, "A").is_err());

    fs::remove_file(project.join("rawdata")).unwrap();
    assert!(
        Command::new("mkfifo")
            .arg(project.join("rawdata"))
            .status()
            .unwrap()
            .success()
    );
    assert!(inventory_subject(&project, "A").is_err());
}

#[test]
fn plan_rejects_foreign_scope_and_stale_destination_before_relocation() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let foreign = workspace.path().join("foreign");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("project rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
    fs::create_dir_all(&foreign).expect("foreign");
    let plan = create_plan(&project, &["A".to_string()], "plan-a".to_string()).expect("plan");

    assert!(validate_plan_scope(&plan, &foreign, &["A".to_string()]).is_err());
    assert!(validate_plan_scope(&plan, &project, &["B".to_string()]).is_err());

    let mut bound = plan.clone();
    bind_plan(&mut bound, &project, &["A".to_string()], 7).expect("bind");
    fs::write(project.join("rawdata/sub-A/changed.nii"), "changed").expect("change");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new");
    let error =
        relocate(&bound, 7, &staging, &["A".to_string()], false, false).expect_err("stale plan");
    assert!(error.to_string().contains("stale"));
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
        "old"
    );
    assert!(staging.join("rawdata/sub-A/new.nii").exists());
}

#[test]
fn dataset_candidate_collision_preserves_unrelated_files_and_directories_in_every_plan_phase() {
    for (source_present, destination_present) in
        [(true, true), (false, false), (false, true), (true, false)]
    {
        for directory in [false, true] {
            let workspace = tempdir().unwrap();
            let project = workspace.path().join("project");
            let staging = super::common::write_old_and_staged(&project, "A");
            if source_present {
                fs::write(staging.join("rawdata/dataset_description.json"), "staged").unwrap();
            }
            if destination_present {
                fs::write(project.join("rawdata/dataset_description.json"), "existing").unwrap();
            }
            let plan = super::common::bound_plan(&project, &["A"], "dataset-collision");
            let candidate = project.join(
                "rawdata/.dataset_description.json.easl-relocation-datasetcollision-run-candidate",
            );
            let sentinel = if directory {
                fs::create_dir(&candidate).unwrap();
                candidate.join("unrelated.txt")
            } else {
                candidate.clone()
            };
            fs::write(&sentinel, "unrelated").unwrap();

            let error = relocate(&plan, 1, &staging, &["A".into()], false, false)
                .expect_err("reserved candidate collision must precede mutation");

            assert!(error.to_string().contains("collision"));
            assert_eq!(fs::read_to_string(&sentinel).unwrap(), "unrelated");
            assert_eq!(
                fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
                "old"
            );
            assert!(
                !project
                    .join(crate::import_relocation::JOURNAL_FILE)
                    .exists()
            );
        }
    }
}

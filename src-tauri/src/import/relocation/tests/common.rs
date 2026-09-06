use crate::import_relocation::{RelocationPlan, bind_plan, create_plan};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn bound_plan(project: &Path, subjects: &[&str], id: &str) -> RelocationPlan {
    let subjects = subjects
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    let mut plan = create_plan(project, &subjects, id.to_string()).expect("plan");
    bind_plan(&mut plan, project, &subjects, 1).expect("bind");
    plan
}

pub(super) fn write_old_and_staged(project: &Path, subject: &str) -> PathBuf {
    fs::create_dir_all(project.join(format!("rawdata/sub-{subject}"))).expect("old rawdata");
    fs::write(
        project.join(format!("rawdata/sub-{subject}/old.nii")),
        "old",
    )
    .expect("old file");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join(format!("rawdata/sub-{subject}"))).expect("staged rawdata");
    fs::write(
        staging.join(format!("rawdata/sub-{subject}/new.nii")),
        "new",
    )
    .expect("new file");
    staging
}

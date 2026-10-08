//! Explicit configuration binding export. Backend tests never write bindings.
use super::model::{ProjectEdit, ProjectSnapshot};
use std::path::Path;
use ts_rs::{Config, TS};

pub fn export_project_types(directory: &Path) -> Result<(), ts_rs::ExportError> {
    let config = Config::new().with_out_dir(directory);
    ProjectSnapshot::export_all(&config)?;
    ProjectEdit::export_all(&config)?;
    super::model::ProjectInspection::export_all(&config)?;
    super::model::RecentProjectIdentity::export_all(&config)?;
    super::validation::ProjectParseError::export_all(&config)
}

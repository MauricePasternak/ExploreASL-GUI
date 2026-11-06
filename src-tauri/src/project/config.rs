//! Accepted configuration, one inspected candidate, and revision-ordered saving.
use super::{
    model::*,
    ownership::{self, ActiveProject},
    persistence, validation,
};
use crate::app::state::AppState;
use anyhow::{Result, anyhow, bail};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::Path,
    sync::Arc,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub(crate) struct ActiveProjectConfig {
    pub(crate) document: ProjectDocument,
    pub(crate) ownership: Arc<ActiveProject>,
    pub(crate) generation: u64,
    pub(crate) accepted_revision: u64,
    pub(crate) persisted_revision: u64,
    pub(crate) recovered_from_backup: bool,
}

#[derive(Clone)]
pub(crate) struct ProjectCandidate {
    pub(crate) id: String,
    pub(crate) document: ProjectDocument,
    pub(crate) ownership: Arc<ActiveProject>,
    pub(crate) recovered_from_backup: bool,
    pub(crate) unsaved: bool,
}

#[derive(Default)]
pub(crate) struct ProjectConfigState {
    pub(crate) active: Option<ActiveProjectConfig>,
    pub(crate) pending: Option<ProjectCandidate>,
    pub(crate) generation: u64,
}

fn timestamp() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

pub(crate) fn defaults(
    name: String,
    source: DataSource,
    profile_id: String,
) -> Result<ProjectDocument> {
    let created_at = timestamp()?;
    let id = uuid::Uuid::new_v4().to_string();
    Ok(ProjectDocument {
        schema_version: SchemaVersion,
        project_meta: ProjectMeta {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            created_at: created_at.clone(),
            last_opened: created_at.clone(),
            current_phase: ProjectPhase::Import,
            data_source: source,
        },
        mapping_state: MappingState {
            source_data_path: (source == DataSource::Bids).then(|| ".".into()),
            ..Default::default()
        },
        data_par: DataPar::switch_defaults(),
        ui_state: UiState {
            navbar_collapsed: Some(true),
            import: Some(ImportUiState {
                selected_profile_id: Some(profile_id),
                bids_review_confirmed: Some(false),
                skipped_subjects: Some(Vec::new()),
                ..Default::default()
            }),
            processing: None,
            data_vis: None,
            datapar: Some(DataParUiState {
                advanced_visibility: Some(AdvancedVisibility::default()),
            }),
            manifest: ManifestConfig {
                reviewers: vec![Reviewer {
                    id: id.clone(),
                    label: "Reviewer 1".into(),
                    created_at,
                }],
                active_reviewer_id: id.clone(),
                verdicts: BTreeMap::from([(id, BTreeMap::new())]),
                resolved_verdicts: BTreeMap::new(),
            },
        },
    })
}

pub(crate) fn serialize(document: &ProjectDocument) -> Result<Vec<u8>> {
    validation::validate_document(document)?;
    // serde_json's default map sorts keys, including flattened scientific maps.
    Ok(serde_json::to_vec_pretty(&serde_json::to_value(document)?)?)
}

pub(crate) fn allowed_phases(document: &ProjectDocument) -> Vec<ProjectPhase> {
    let phases = [
        ProjectPhase::Import,
        ProjectPhase::Parameters,
        ProjectPhase::Processing,
        ProjectPhase::Visualization,
        ProjectPhase::Manifest,
    ];
    let current = phases
        .iter()
        .position(|phase| *phase == document.project_meta.current_phase)
        .unwrap();
    let import = document.ui_state.import.as_ref();
    let processing_ready = match document.project_meta.data_source {
        DataSource::Bids => import.is_some_and(|value| value.bids_review_confirmed == Some(true)),
        DataSource::Dicom => import.is_some_and(|value| value.completed == Some(true)),
    };
    let population_ready = document
        .ui_state
        .processing
        .as_ref()
        .and_then(|value| value.population.as_ref())
        .is_some_and(|value| value.completed == Some(true));
    phases
        .into_iter()
        .enumerate()
        .filter_map(|(index, phase)| {
            (index <= current
                || match phase {
                    ProjectPhase::Import | ProjectPhase::Parameters => true,
                    ProjectPhase::Processing => processing_ready,
                    ProjectPhase::Visualization | ProjectPhase::Manifest => population_ready,
                })
            .then_some(phase)
        })
        .collect()
}

impl ActiveProjectConfig {
    pub(crate) fn snapshot(&self) -> ProjectSnapshot {
        ProjectSnapshot {
            document: self.document.clone(),
            root_path: self.ownership.root().to_string_lossy().into_owned(),
            activation_generation: self.generation,
            accepted_revision: self.accepted_revision,
            persisted_revision: self.persisted_revision,
            recovered_from_backup: self.recovered_from_backup,
            allowed_phases: allowed_phases(&self.document),
            recovery: None,
        }
    }
}

pub(crate) fn snapshot_for_state(state: &AppState, generation: u64) -> Result<ProjectSnapshot> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    snapshot_locked(state, generation)
}

fn snapshot_locked(state: &AppState, generation: u64) -> Result<ProjectSnapshot> {
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    let active = config
        .active
        .as_ref()
        .ok_or_else(|| anyhow!("No accepted project configuration"))?;
    check_activation(active, &ownership, generation)?;
    Ok(active.snapshot())
}

fn check_activation(
    active: &ActiveProjectConfig,
    ownership: &Arc<ActiveProject>,
    generation: u64,
) -> Result<()> {
    if generation != active.generation || !Arc::ptr_eq(&active.ownership, ownership) {
        bail!("Project activation expired");
    }
    Ok(())
}

pub(crate) fn edit_for_state(
    state: &AppState,
    generation: u64,
    edit: ProjectEdit,
) -> Result<ProjectSnapshot> {
    // Lock order: transition -> capability -> configuration. Disk work occurs
    // here or in save, never while an execution-state guard is retained.
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    ownership::ensure_not_shutting_down(state).map_err(anyhow::Error::msg)?;
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let mut config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    let active = config
        .active
        .as_mut()
        .ok_or_else(|| anyhow!("No accepted project configuration"))?;
    check_activation(active, &ownership, generation)?;
    let confirm_bids = matches!(&edit, ProjectEdit::ConfirmBids { .. });
    let mut next = active.document.clone();
    apply_edit(&mut next, ownership.root(), edit)?;
    validation::validate_document(&next)?;
    if confirm_bids
        && (next != active.document
            || active.accepted_revision != active.persisted_revision
            || active.recovered_from_backup)
    {
        persistence::write_current_owned(
            &ownership,
            &serialize(&next)?,
            active.recovered_from_backup,
        )?;
    }
    if next != active.document {
        active.document = next;
        active.accepted_revision += 1;
    }
    if confirm_bids {
        active.persisted_revision = active.accepted_revision;
        active.recovered_from_backup = false;
    }
    Ok(active.snapshot())
}

pub(crate) fn save_for_state(state: &AppState, generation: u64) -> Result<ProjectSnapshot> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    save_locked(state, generation)
}

pub(crate) fn save_locked(state: &AppState, generation: u64) -> Result<ProjectSnapshot> {
    {
        let config = state
            .project_config
            .lock()
            .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
        let active = config
            .active
            .as_ref()
            .ok_or_else(|| anyhow!("No accepted project configuration"))?;
        if active.generation != generation {
            bail!("Project activation expired");
        }
        if active.accepted_revision == active.persisted_revision && !active.recovered_from_backup {
            return Ok(active.snapshot());
        }
    }
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let mut config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    let active = config
        .active
        .as_mut()
        .ok_or_else(|| anyhow!("No accepted project configuration"))?;
    check_activation(active, &ownership, generation)?;
    save_active(active)?;
    Ok(active.snapshot())
}

fn save_active(active: &mut ActiveProjectConfig) -> Result<()> {
    if active.accepted_revision != active.persisted_revision || active.recovered_from_backup {
        let bytes = serialize(&active.document).map_err(|error| persistence::AtomicWriteError {
            category: persistence::WriteErrorCategory::InvalidSerialization,
            message: error.to_string(),
            details: format!("{error:#}"),
        })?;
        persistence::write_current_owned(&active.ownership, &bytes, active.recovered_from_backup)?;
        active.persisted_revision = active.accepted_revision;
        active.recovered_from_backup = false;
    }
    Ok(())
}

pub(crate) fn capture_import_locked(state: &AppState, profile_id: &str) -> Result<ImportSnapshot> {
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    let active = config
        .active
        .as_ref()
        .ok_or_else(|| anyhow!("No accepted project configuration"))?;
    check_activation(active, &ownership, active.generation)?;
    let mapping = &active.document.mapping_state;
    Ok(ImportSnapshot {
        source_data_path: mapping.source_data_path.clone().unwrap_or_default(),
        path_patterns: mapping.path_patterns.clone().unwrap_or_default(),
        tokenizer_configs: mapping.tokenizer_configs.clone().unwrap_or_default(),
        b_match_directories: mapping.b_match_directories.unwrap_or(true),
        modality_aliases: mapping.modality_aliases.clone().unwrap_or_default(),
        session_aliases: mapping.session_aliases.clone().unwrap_or_default(),
        run_aliases: mapping.run_aliases.clone().unwrap_or_default(),
        subject_renames: mapping.subject_renames.clone().unwrap_or_default(),
        metadata_groups: mapping.metadata_groups.clone().unwrap_or_default(),
        subject_rows: mapping.subject_rows.clone().unwrap_or_default(),
        selected_profile_id: Some(profile_id.into()),
    })
}

fn result_edit_locked(
    state: &AppState,
    generation: u64,
    apply: impl FnOnce(&mut ProjectDocument) -> Result<()>,
) -> Result<()> {
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let mut config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    let active = config
        .active
        .as_mut()
        .ok_or_else(|| anyhow!("No accepted project configuration"))?;
    check_activation(active, &ownership, generation)?;
    result_edit(active, apply)
}

fn result_edit(
    active: &mut ActiveProjectConfig,
    apply: impl FnOnce(&mut ProjectDocument) -> Result<()>,
) -> Result<()> {
    let mut next = active.document.clone();
    apply(&mut next)?;
    validation::validate_document(&next)?;
    if next != active.document {
        active.document = next;
        active.accepted_revision += 1;
    }
    Ok(())
}

fn import_result(
    document: &mut ProjectDocument,
    snapshot: &crate::import::ImportRunSnapshot,
    admitted: Option<ImportSnapshot>,
) -> Result<()> {
    if !snapshot.lifecycle.is_terminal() || snapshot.confirmation_required {
        bail!("Import terminal evidence is not eligible; confirm external stop if required");
    }
    let import = document.ui_state.import.get_or_insert_default();
    import.current_phase = Some(match snapshot.lifecycle {
        crate::import::ImportLifecycle::Completed => ExecutionPhase::Completed,
        crate::import::ImportLifecycle::Failed => ExecutionPhase::Failed,
        crate::import::ImportLifecycle::Cancelled => ExecutionPhase::Cancelled,
        _ => ExecutionPhase::Interrupted,
    });
    import.completed = Some(snapshot.lifecycle == crate::import::ImportLifecycle::Completed);
    if snapshot.lifecycle == crate::import::ImportLifecycle::Completed {
        if let Some(admitted) = admitted {
            import.most_recent_config = Some(admitted);
        } else {
            log::warn!(
                "Successful historical import lacks admitted configuration; prior baseline preserved"
            );
        }
    }
    Ok(())
}

fn processing_result(
    document: &mut ProjectDocument,
    record: &crate::processing::record::ProcessingRecord,
) -> Result<()> {
    if !record.lifecycle.is_terminal()
        || record.available_action != crate::processing::record::AvailableAction::Acknowledge
    {
        bail!("Processing terminal evidence awaits external-stop confirmation");
    }
    let processing = document.ui_state.processing.get_or_insert_default();
    processing.current_phase = Some(match record.lifecycle {
        crate::processing::ProcessingLifecycle::Completed => ExecutionPhase::Completed,
        crate::processing::ProcessingLifecycle::Failed => ExecutionPhase::Failed,
        crate::processing::ProcessingLifecycle::Cancelled => ExecutionPhase::Cancelled,
        _ => ExecutionPhase::Interrupted,
    });
    if record.execution_committed {
        for module in &record.request.selected_modules {
            let result = match module.as_str() {
                "structural" => processing.structural.get_or_insert_default(),
                "asl" => processing.asl.get_or_insert_default(),
                "population" => processing.population.get_or_insert_default(),
                _ => bail!("Unknown admitted processing module"),
            };
            result.completed =
                Some(record.lifecycle == crate::processing::ProcessingLifecycle::Completed);
            result.last_run = Some(LastRun {
                profile_id: record.request.execution_profile.id().into(),
                explore_asl_version: record
                    .versions
                    .as_ref()
                    .map(|versions| versions.explore_asl.clone()),
                matlab_version: record
                    .versions
                    .as_ref()
                    .map(|versions| versions.matlab.clone()),
                gui_version: record
                    .versions
                    .as_ref()
                    .map(|versions| versions.gui.clone()),
                mtime: if module == "population" {
                    record.population_ready_mtime_ms.map(|value| value as i64)
                } else {
                    crate::processing::recovery::module_ready_mtime(record, module)?
                },
            });
        }
    }
    Ok(())
}

pub(crate) fn reconcile_import_for_state(
    state: &AppState,
    generation: u64,
    run_id: String,
) -> Result<ProjectSnapshot> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let (snapshot, admitted, acknowledged) = {
        let run = state
            .import_state
            .lock()
            .map_err(|_| anyhow!("Import state lock was poisoned"))?;
        if run.run_id != run_id || run.project_root != ownership.root() {
            bail!("Import reconciliation is stale or foreign");
        }
        (
            run.snapshot(),
            run.admitted_config.clone(),
            run.acknowledged,
        )
    };
    if !acknowledged {
        if !snapshot.lifecycle.is_terminal() || snapshot.confirmation_required {
            bail!("Import terminal evidence is not eligible; confirm external stop if required");
        }
        result_edit_locked(state, generation, |document| {
            import_result(document, &snapshot, admitted)
        })?;
    }
    let saved = if acknowledged {
        snapshot_locked(state, generation)?
    } else {
        save_locked(state, generation)?
    };
    crate::import::acknowledge_import_run_locked(state, &run_id)?;
    Ok(saved)
}

pub(crate) fn reconcile_processing_for_state(
    state: &AppState,
    generation: u64,
    run_id: uuid::Uuid,
    terminal_revision: u64,
) -> Result<ProjectSnapshot> {
    crate::processing::pipeline::reap_finished_supervisor(state).map_err(anyhow::Error::msg)?;
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
    let record = crate::processing::record::records(ownership.root())?
        .pop()
        .filter(|record| record.run_id == run_id);
    if record.is_none() {
        let replay = crate::processing::record::lookup_run(ownership.root(), run_id)?
            .ok_or_else(|| anyhow!("Processing reconciliation is stale or foreign"))?;
        if replay.terminal_revision != terminal_revision {
            bail!("Stale processing terminal revision");
        }
        let config = state
            .project_config
            .lock()
            .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
        let active = config
            .active
            .as_ref()
            .ok_or_else(|| anyhow!("No accepted project configuration"))?;
        check_activation(active, &ownership, generation)?;
        return Ok(active.snapshot());
    }
    let acknowledged = record.as_ref().is_some_and(|record| record.acknowledged);
    if let Some(record) = record {
        if !record.lifecycle.is_terminal()
            || record.terminal_revision != Some(terminal_revision)
            || (!record.acknowledged
                && record.available_action
                    != crate::processing::record::AvailableAction::Acknowledge)
        {
            bail!("Processing reconciliation is stale or awaits external-stop confirmation");
        }
        if !record.acknowledged {
            result_edit_locked(state, generation, |document| {
                processing_result(document, &record)
            })?;
        }
    }
    let saved = if acknowledged {
        snapshot_locked(state, generation)?
    } else {
        save_locked(state, generation)?
    };
    let mut processing = state
        .processing_state
        .lock()
        .map_err(|_| anyhow!("Processing state lock was poisoned"))?;
    crate::processing::runs::acknowledge_locked(
        ownership.root(),
        &mut processing,
        run_id,
        terminal_revision,
    )
    .map_err(anyhow::Error::msg)?;
    Ok(saved)
}

pub(crate) fn invalidate_population_for_state(state: &AppState, root: &Path) -> Result<()> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let generation = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?
        .active
        .as_ref()
        .filter(|active| active.ownership.root() == root)
        .ok_or_else(|| anyhow!("No accepted configuration for committed processing"))?
        .generation;
    result_edit_locked(state, generation, |document| {
        document
            .ui_state
            .processing
            .get_or_insert_default()
            .population
            .get_or_insert_default()
            .completed = Some(false);
        Ok(())
    })
}

/// Transition guard is held. Candidate results persist before root/config publication.
pub(crate) fn reconcile_candidate_locked(
    state: &AppState,
    active: &mut ActiveProjectConfig,
) -> Result<()> {
    let import = {
        let run = state
            .import_state
            .lock()
            .map_err(|_| anyhow!("Import state lock was poisoned"))?;
        (run.lifecycle.is_terminal() && !run.acknowledged && !run.confirmation_required)
            .then(|| (run.snapshot(), run.admitted_config.clone()))
    };
    if let Some((snapshot, admitted)) = import {
        result_edit(active, |document| {
            import_result(document, &snapshot, admitted)
        })?;
        save_active(active)?;
        crate::import::acknowledge_import_run_owned(state, &active.ownership, &snapshot.run_id)?;
    }
    let record = crate::processing::record::records(active.ownership.root())?.pop();
    if let Some(record) = &record
        && !record.acknowledged
        && record.execution_committed
        && record
            .request
            .selected_modules
            .iter()
            .any(|module| module == "population")
        && record.available_action == crate::processing::record::AvailableAction::ConfirmStopped
    {
        result_edit(active, |document| {
            document
                .ui_state
                .processing
                .get_or_insert_default()
                .population
                .get_or_insert_default()
                .completed = Some(false);
            Ok(())
        })?;
        save_active(active)?;
    }
    if let Some(record) = record
        && !record.acknowledged
        && record.lifecycle.is_terminal()
        && record.available_action == crate::processing::record::AvailableAction::Acknowledge
    {
        result_edit(active, |document| processing_result(document, &record))?;
        save_active(active)?;
        let mut processing = state
            .processing_state
            .lock()
            .map_err(|_| anyhow!("Processing state lock was poisoned"))?;
        crate::processing::runs::acknowledge_locked(
            active.ownership.root(),
            &mut processing,
            record.run_id,
            record
                .terminal_revision
                .ok_or_else(|| anyhow!("Missing terminal revision"))?,
        )
        .map_err(anyhow::Error::msg)?;
    }
    Ok(())
}

pub(crate) fn reconcile_settled_for_state(state: &AppState) -> Result<()> {
    let generation = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?
        .active
        .as_ref()
        .map(|active| active.generation);
    let Some(generation) = generation else {
        return Ok(());
    };
    let import = {
        let run = state
            .import_state
            .lock()
            .map_err(|_| anyhow!("Import state lock was poisoned"))?;
        (run.lifecycle.is_terminal() && !run.acknowledged).then(|| run.run_id.clone())
    };
    if let Some(run_id) = import {
        reconcile_import_for_state(state, generation, run_id)?;
    }
    let root = ownership::active(state).map_err(anyhow::Error::msg)?;
    if let Some(record) = crate::processing::record::records(root.root())?.pop() {
        if record.lifecycle.is_terminal() {
            reconcile_processing_for_state(
                state,
                generation,
                record.run_id,
                record.terminal_revision.ok_or_else(|| {
                    anyhow!("Processing interruption requires external-stop confirmation")
                })?,
            )?;
        } else {
            bail!("Processing remains unsettled");
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn reconcile_import_result(
    app: tauri::AppHandle,
    generation: u64,
    run_id: String,
) -> Result<ProjectSnapshot, ConfigCommandError> {
    blocking(app, "The import result could not be saved.", move |state| {
        reconcile_import_for_state(state, generation, run_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn reconcile_processing_result(
    app: tauri::AppHandle,
    generation: u64,
    run_id: uuid::Uuid,
    terminal_revision: u64,
) -> Result<ProjectSnapshot, ConfigCommandError> {
    blocking(
        app,
        "The processing result could not be saved.",
        move |state| reconcile_processing_for_state(state, generation, run_id, terminal_revision),
    )
    .await
}

fn accepted_source(root: &Path, path: &str) -> Result<String> {
    let source = super::source_paths::inspect_source_path_impl(root, Path::new(path))?;
    if !source.exists || !source.readable {
        bail!("Selected source is missing or unreadable");
    }
    Ok(source
        .project_relative_path
        .unwrap_or_else(|| source.absolute_path.to_string_lossy().into_owned()))
}

fn apply_edit(document: &mut ProjectDocument, root: &Path, edit: ProjectEdit) -> Result<()> {
    match edit {
        ProjectEdit::Import {
            mut mapping,
            preferences,
        } => {
            if document.project_meta.data_source == DataSource::Bids
                && mapping != document.mapping_state
            {
                bail!("BIDS mapping requires review confirmation");
            }
            if mapping.source_data_path != document.mapping_state.source_data_path
                && let Some(path) = &mapping.source_data_path
            {
                mapping.source_data_path = Some(accepted_source(root, path)?);
            }
            document.mapping_state = mapping;
            let import = document.ui_state.import.get_or_insert_default();
            import.active_step = preferences.active_step;
            import.selected_profile_id = preferences.selected_profile_id;
        }
        ProjectEdit::Parameters { values, visibility } => {
            document.data_par = values;
            document.ui_state.datapar = Some(DataParUiState {
                advanced_visibility: Some(visibility),
            });
        }
        ProjectEdit::Processing { mut config } => {
            let processing = document.ui_state.processing.get_or_insert_default();
            if config.modules.contains(&ProcessingModule::Population)
                && config
                    .modules
                    .iter()
                    .any(|module| *module != ProcessingModule::Population)
            {
                if processing.config.as_ref().is_some_and(|previous| {
                    previous.modules.contains(&ProcessingModule::Population)
                }) {
                    config
                        .modules
                        .retain(|module| *module != ProcessingModule::Population);
                } else {
                    config.modules = vec![ProcessingModule::Population];
                }
            }
            if config.modules.contains(&ProcessingModule::Population) {
                config.workers = 1;
            }
            if !config.modules.iter().any(|module| {
                matches!(module, ProcessingModule::Structural | ProcessingModule::Asl)
            }) {
                config.rerun_bids2_legacy = Some(false);
            }
            processing.config = Some(config);
        }
        ProjectEdit::Visualization { config } => document.ui_state.data_vis = Some(config),
        ProjectEdit::Phase { phase } => {
            if !allowed_phases(document).contains(&phase) {
                bail!("Project phase is not accessible");
            }
            document.project_meta.current_phase = phase;
        }
        ProjectEdit::RenameProject { name } => {
            if name.chars().any(|character| {
                character.is_control() || matches!(character, '\u{2028}' | '\u{2029}')
            }) {
                bail!("Project name must be a single line without control characters");
            }
            let name = name.trim();
            if name.is_empty() {
                bail!("Project name cannot be blank");
            }
            document.project_meta.name = name.to_owned();
        }
        ProjectEdit::Navbar { collapsed } => document.ui_state.navbar_collapsed = Some(collapsed),
        ProjectEdit::AddReviewer => {
            let manifest = &mut document.ui_state.manifest;
            if manifest.reviewers.len() < 5 {
                let id = uuid::Uuid::new_v4().to_string();
                manifest.verdicts.insert(id.clone(), BTreeMap::new());
                manifest.reviewers.push(Reviewer {
                    id,
                    label: format!("Reviewer {}", manifest.reviewers.len() + 1),
                    created_at: timestamp()?,
                });
            }
        }
        ProjectEdit::RemoveReviewer { id } => {
            let manifest = &mut document.ui_state.manifest;
            if manifest.reviewers.len() > 1
                && manifest.reviewers.iter().any(|reviewer| reviewer.id == id)
            {
                manifest.reviewers.retain(|reviewer| reviewer.id != id);
                manifest.verdicts.remove(&id);
                if manifest.active_reviewer_id == id {
                    manifest.active_reviewer_id = manifest.reviewers[0].id.clone();
                }
                if manifest.reviewers.len() == 1 {
                    manifest.resolved_verdicts.clear();
                }
            }
        }
        ProjectEdit::RenameReviewer { id, label } => {
            let Some(reviewer) = document
                .ui_state
                .manifest
                .reviewers
                .iter_mut()
                .find(|reviewer| reviewer.id == id)
            else {
                return Ok(());
            };
            reviewer.label = label;
        }
        ProjectEdit::ActiveReviewer { id } => document.ui_state.manifest.active_reviewer_id = id,
        ProjectEdit::Verdict {
            subject_session,
            reviewer_id,
            mut value,
        } => {
            let manifest = &mut document.ui_state.manifest;
            let id = reviewer_id.unwrap_or_else(|| manifest.active_reviewer_id.clone());
            if !manifest.reviewers.iter().any(|reviewer| reviewer.id == id) {
                bail!("Reviewer is not registered");
            }
            if let Some(value) = &mut value {
                value.set_at = crate::manifest::read_prior_modules_mtimes_impl(
                    root,
                    std::slice::from_ref(&subject_session),
                )
                .get(&subject_session)
                .copied()
                .flatten()
                .unwrap_or(0);
            }
            if value.is_none()
                && !manifest
                    .verdicts
                    .get(&id)
                    .is_some_and(|slice| slice.contains_key(&subject_session))
            {
                return Ok(());
            }
            let slice = manifest.verdicts.entry(id).or_default();
            if slice.get(&subject_session) != value.as_ref() {
                if let Some(value) = value {
                    slice.insert(subject_session.clone(), value);
                } else {
                    slice.remove(&subject_session);
                }
                manifest.resolved_verdicts.remove(&subject_session);
            }
        }
        ProjectEdit::Resolution {
            subject_session,
            value,
        } => {
            if let Some(mut value) = value {
                value.set_at = crate::manifest::read_prior_modules_mtimes_impl(
                    root,
                    std::slice::from_ref(&subject_session),
                )
                .get(&subject_session)
                .copied()
                .flatten()
                .unwrap_or(0);
                document
                    .ui_state
                    .manifest
                    .resolved_verdicts
                    .insert(subject_session, value);
            } else {
                document
                    .ui_state
                    .manifest
                    .resolved_verdicts
                    .remove(&subject_session);
            }
        }
        ProjectEdit::RelinkDicom {
            path,
            raw_paths,
            patterns,
            compatible,
        } => {
            if document.project_meta.data_source != DataSource::Dicom {
                bail!("Only DICOM projects can relink DICOM sources");
            }
            let path = accepted_source(root, &path)?;
            let import = document.ui_state.import.get_or_insert_default();
            if compatible {
                if let Some(snapshot) = &mut import.most_recent_config {
                    snapshot.source_data_path = path.clone();
                }
            } else {
                document.mapping_state = MappingState {
                    ingestion_complete: Some(!raw_paths.is_empty()),
                    b_match_directories: document.mapping_state.b_match_directories,
                    raw_paths: Some(raw_paths),
                    path_patterns: Some(patterns),
                    ..Default::default()
                };
                import.most_recent_config = None;
                import.completed = Some(false);
                import.current_phase = Some(ExecutionPhase::Idle);
                import.active_step = Some(0);
            }
            document.mapping_state.source_data_path = Some(path);
        }
        ProjectEdit::RelinkExternal { source, compatible } => {
            let visualization = document.ui_state.data_vis.get_or_insert_default();
            let join = visualization
                .join_config
                .as_mut()
                .ok_or_else(|| anyhow!("No external join to relink"))?;
            join.external_source = source;
            if !compatible {
                join.keys.clear();
                visualization.column_types = Some(BTreeMap::new());
                visualization.identifiers = None;
                visualization.level_orderings = Some(BTreeMap::new());
                visualization.axis_assignment = Some(AxisAssignment::default());
                visualization.domain_filters = Some(DomainFilters::default());
                visualization.stage = Some("selectData".into());
            }
        }
        ProjectEdit::ConfirmBids { groups, skipped } => confirm_bids(document, groups, skipped)?,
    }
    Ok(())
}

fn confirm_bids(
    document: &mut ProjectDocument,
    groups: Vec<BidsReviewGroup>,
    skipped: Vec<String>,
) -> Result<()> {
    if document.project_meta.data_source != DataSource::Bids || groups.is_empty() {
        bail!("BIDS review requires detected groups");
    }
    let mut labels = BTreeSet::new();
    let mut rows = BTreeMap::<String, SubjectRow>::new();
    for group in &groups {
        if group.label.trim().is_empty() || !labels.insert(group.label.trim().to_lowercase()) {
            bail!("BIDS group labels must be nonempty and case-insensitively unique");
        }
        for subject in &group.subjects {
            let name = subject
                .subject_label
                .strip_prefix("sub-")
                .unwrap_or(&subject.subject_label);
            for session in &subject.session_labels {
                let id = format!("sub-{name}_{session}");
                if rows.get(&id).is_some_and(|row| row.group_id != group.id) {
                    bail!(
                        "BIDS subject-session belongs to different groups; manual merge required"
                    );
                }
                rows.insert(
                    id.clone(),
                    SubjectRow {
                        id,
                        subject: name.into(),
                        session: session.clone(),
                        group_id: group.id.clone(),
                    },
                );
            }
        }
    }
    document.mapping_state = MappingState {
        source_data_path: Some(".".into()),
        ingestion_complete: Some(true),
        subject_rows: Some(rows.into_values().collect()),
        metadata_groups: Some(
            groups
                .into_iter()
                .map(|group| MetadataGroup {
                    id: group.id,
                    label: group.label.trim().to_owned(),
                    bids_params: group.bids_params,
                })
                .collect(),
        ),
        ..Default::default()
    };
    let import = document.ui_state.import.get_or_insert_default();
    import.bids_review_confirmed = Some(true);
    import.skipped_subjects = Some(skipped);
    document.project_meta.current_phase = ProjectPhase::Parameters;
    Ok(())
}

pub(crate) fn read_document(path: &Path) -> Result<Option<ProjectDocument>> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
        Ok(_) => {}
    }
    let mut bytes = Vec::new();
    super::setup::open_regular_no_follow(path)?.read_to_end(&mut bytes)?;
    Ok(Some(validation::parse_document(&bytes)?))
}

fn read_backup(root: &Path) -> Result<ProjectDocument> {
    read_document(&root.join("project.easl.bak"))
        .and_then(|document| document.ok_or_else(|| anyhow!("Backup is missing")))
        .map_err(|error| {
            persistence::AtomicWriteError {
                category: persistence::WriteErrorCategory::Recovery,
                message: format!("Project recovery failed: {error:#}"),
                details: format!("Project recovery failed: {error:#}"),
            }
            .into()
        })
}

pub(crate) fn inspect_for_state(
    state: &AppState,
    path: String,
    recents: Vec<RecentProjectIdentity>,
) -> Result<ProjectInspection> {
    let path = Path::new(&path);
    if path.file_name().and_then(|name| name.to_str()) != Some("project.easl") {
        bail!("Project files must be named project.easl");
    }
    let root = path
        .parent()
        .ok_or_else(|| anyhow!("Project path has no parent"))?;
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let ownership = ownership::for_root(state, root).map_err(anyhow::Error::msg)?;
    let cached = {
        let config = state
            .project_config
            .lock()
            .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
        config
            .active
            .as_ref()
            .filter(|active| Arc::ptr_eq(&active.ownership, &ownership))
            .map(|active| {
                (
                    active.document.clone(),
                    active.recovered_from_backup,
                    active.accepted_revision != active.persisted_revision,
                )
            })
    };
    let (document, recovered_from_backup, unsaved, setup_recovered) =
        if let Some((document, recovered, unsaved)) = cached {
            (document, recovered, unsaved, 0)
        } else {
            let recovery = super::setup::recover_root_owned(&ownership)?;
            let primary = read_document(&ownership.root().join("project.easl"));
            let (document, recovered) = match primary {
                Ok(Some(document)) => (document, false),
                Ok(None) => (read_backup(ownership.root())?, true),
                Err(error)
                    if matches!(
                        error.downcast_ref::<validation::ProjectParseError>(),
                        Some(validation::ProjectParseError::Malformed { .. })
                    ) =>
                {
                    (read_backup(ownership.root())?, true)
                }
                Err(error) => return Err(error),
            };
            (document, recovered, recovered, recovery.recovered)
        };
    let selected = ownership.root().join("project.easl");
    verify_source_references(&document, ownership.root())?;
    let mut duplicate_path = None;
    let mut moved_from = None;
    for prior in recents
        .iter()
        .filter(|prior| prior.project_id.as_deref() == Some(&document.project_meta.id))
    {
        let previous = Path::new(&prior.path);
        if previous == selected
            || previous.canonicalize().ok().as_deref() == selected.canonicalize().ok().as_deref()
                && previous.exists()
        {
            continue;
        }
        match read_document(previous) {
            Ok(None) => moved_from = Some(prior.path.clone()),
            Ok(Some(prior_document))
                if prior_document.project_meta.id == document.project_meta.id =>
            {
                duplicate_path = Some(prior.path.clone())
            }
            _ => {}
        }
        break;
    }
    let mut inspection =
        retain_candidate(state, document, ownership, recovered_from_backup, unsaved)?;
    inspection.duplicate_path = duplicate_path;
    inspection.moved_from = moved_from;
    inspection.setup_recovered = setup_recovered;
    Ok(inspection)
}

fn verify_source_references(document: &ProjectDocument, root: &Path) -> Result<()> {
    if let Some(path) = &document.mapping_state.source_data_path
        && !path.is_empty()
    {
        let inspection = super::source_paths::inspect_source_path_impl(root, Path::new(path))?;
        if inspection.exists && inspection.readable && inspection.is_directory {
            for raw in document.mapping_state.raw_paths.iter().flatten() {
                super::source_paths::inspect_source_path_impl(
                    &inspection.absolute_path,
                    Path::new(raw),
                )?;
            }
        }
    }
    if let Some(source) = document
        .ui_state
        .data_vis
        .as_ref()
        .and_then(|config| config.qcbf_source.as_ref())
    {
        super::source_paths::inspect_source_path_impl(root, Path::new(&source.relative_path))?;
    }
    Ok(())
}

fn retain_candidate(
    state: &AppState,
    document: ProjectDocument,
    ownership: Arc<ActiveProject>,
    recovered_from_backup: bool,
    unsaved: bool,
) -> Result<ProjectInspection> {
    let id = uuid::Uuid::new_v4().to_string();
    let inspection = ProjectInspection {
        candidate_id: id.clone(),
        project_id: document.project_meta.id.clone(),
        name: document.project_meta.name.clone(),
        root_path: ownership.root().to_string_lossy().into_owned(),
        recovered_from_backup,
        duplicate_path: None,
        moved_from: None,
        setup_recovered: 0,
    };
    state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?
        .pending = Some(ProjectCandidate {
        id,
        document,
        ownership,
        recovered_from_backup,
        unsaved,
    });
    Ok(inspection)
}

pub(crate) fn activate_for_state(
    state: &AppState,
    candidate_id: String,
    confirm_backup: bool,
) -> Result<ProjectSnapshot> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let candidate = {
        let config = state
            .project_config
            .lock()
            .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
        let pending = config
            .pending
            .as_ref()
            .ok_or_else(|| anyhow!("No inspected project candidate"))?;
        if pending.id != candidate_id {
            bail!("Inspected project candidate expired");
        }
        if pending.recovered_from_backup && !confirm_backup {
            bail!("Backup recovery requires confirmation");
        }
        let mut candidate = pending.clone();
        if let Some(active) = &config.active
            && Arc::ptr_eq(&active.ownership, &candidate.ownership)
            && active.document.project_meta.id == candidate.document.project_meta.id
        {
            // Reopening the current root gets a fresh activation, not an old
            // inspection's copy of settings edited during consent.
            candidate.document = active.document.clone();
            candidate.unsaved = active.accepted_revision != active.persisted_revision;
            candidate.recovered_from_backup = active.recovered_from_backup;
        }
        candidate
    };
    candidate.ownership.verify_root_identity()?;
    let generation = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?
        .generation
        + 1;
    let active = ActiveProjectConfig {
        document: candidate.document,
        ownership: candidate.ownership,
        generation,
        accepted_revision: u64::from(candidate.unsaved),
        persisted_revision: 0,
        recovered_from_backup: candidate.recovered_from_backup,
    };
    let root = active.ownership.root().to_string_lossy().into_owned();
    if let Err(error) = persistence::cleanup_current_owned(&active.ownership) {
        log::warn!("Could not clean stale project candidates: {error}");
    }
    let recovery =
        super::lifecycle::set_active_project_with_config_locked(root, state, Some(active))?;
    let mut config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    config.pending = None;
    let mut snapshot = config.active.as_ref().unwrap().snapshot();
    snapshot.recovery = Some(recovery);
    Ok(snapshot)
}

pub(crate) fn copy_candidate_for_state(
    state: &AppState,
    candidate_id: String,
    confirm_backup: bool,
) -> Result<ProjectInspection> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let mut config = state
        .project_config
        .lock()
        .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
    let candidate = config
        .pending
        .as_ref()
        .filter(|candidate| candidate.id == candidate_id)
        .ok_or_else(|| anyhow!("Inspected project candidate expired"))?;
    if candidate.recovered_from_backup && !confirm_backup {
        bail!("Backup recovery requires confirmation");
    }
    candidate.ownership.verify_root_identity()?;
    if config
        .active
        .as_ref()
        .is_some_and(|active| Arc::ptr_eq(&active.ownership, &candidate.ownership))
    {
        bail!("The active project cannot be identified as a separate copy");
    }
    let mut document = candidate.document.clone();
    document.project_meta.id = uuid::Uuid::new_v4().to_string();
    persistence::write_current_owned(
        &candidate.ownership,
        &serialize(&document)?,
        candidate.recovered_from_backup,
    )?;
    let candidate = config.pending.as_mut().unwrap();
    candidate.document = document;
    candidate.recovered_from_backup = false;
    candidate.unsaved = false;
    Ok(ProjectInspection {
        candidate_id: candidate.id.clone(),
        project_id: candidate.document.project_meta.id.clone(),
        name: candidate.document.project_meta.name.clone(),
        root_path: candidate.ownership.root().to_string_lossy().into_owned(),
        recovered_from_backup: false,
        duplicate_path: None,
        moved_from: None,
        setup_recovered: 0,
    })
}

pub(crate) fn create_for_state(
    state: &AppState,
    root: String,
    name: String,
    source: DataSource,
    profile_id: String,
) -> Result<ProjectInspection> {
    if source == DataSource::Bids {
        bail!("BIDS creation requires a confirmed setup plan");
    }
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let ownership = ownership::for_setup(state, Path::new(&root)).map_err(anyhow::Error::msg)?;
    let recovery = super::setup::recover_root_owned(&ownership)?;
    if fs::symlink_metadata(ownership.root().join("project.easl")).is_ok() {
        bail!("project.easl already exists");
    }
    let document = defaults(name, source, profile_id)?;
    persistence::write_current_owned(&ownership, &serialize(&document)?, false)?;
    let mut inspection = retain_candidate(state, document, ownership, false, false)?;
    inspection.setup_recovered = recovery.recovered;
    Ok(inspection)
}

pub(crate) fn preflight_creation_for_state(
    state: &AppState,
    root: String,
    mode: super::setup::SetupMode,
    name: String,
    profile_id: String,
) -> Result<super::setup::SetupPlan> {
    let source = match mode {
        super::setup::SetupMode::Bids => DataSource::Bids,
        super::setup::SetupMode::Dicom => DataSource::Dicom,
        super::setup::SetupMode::Repair => bail!("Creation cannot use repair mode"),
    };
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    let ownership = ownership::for_setup(state, Path::new(&root)).map_err(anyhow::Error::msg)?;
    let recovery = super::setup::recover_root_owned(&ownership)?;
    let document = defaults(name, source, profile_id)?;
    let bytes = String::from_utf8(serialize(&document)?)?;
    let mut plan = super::setup::preflight_for_state(&state.setup_plans, root, mode, Some(bytes))?;
    if recovery.recovered > 0 {
        plan.warnings.push(format!(
            "Recovered {} prior setup transaction(s) before this read-only plan.",
            recovery.recovered
        ));
    }
    Ok(plan)
}

pub(crate) fn retain_committed(
    state: &AppState,
    result: &mut super::setup::SetupCommitResult,
) -> Result<()> {
    if let (Some(document), Some(path)) = (&result.project_document, &result.project_path) {
        let root = Path::new(path)
            .parent()
            .ok_or_else(|| anyhow!("Committed project has no root"))?;
        let ownership = ownership::for_root(state, root).map_err(anyhow::Error::msg)?;
        result.candidate_id =
            Some(retain_candidate(state, document.clone(), ownership, false, false)?.candidate_id);
    }
    Ok(())
}

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(untagged)]
pub(crate) enum ConfigCommandError {
    Storage(persistence::AtomicWriteError),
    Parse(validation::ProjectParseError),
    Operation { message: String, details: String },
}

impl From<anyhow::Error> for ConfigCommandError {
    fn from(error: anyhow::Error) -> Self {
        Self::from_error(error, "The project operation could not be completed.")
    }
}

impl ConfigCommandError {
    fn from_error(error: anyhow::Error, summary: &str) -> Self {
        let operation = crate::error::CommandError::from_error(&error, summary);
        if let Some(error) = error.downcast_ref::<persistence::AtomicWriteError>() {
            return Self::storage(error.category);
        }
        if let Some(error) = error.downcast_ref::<validation::ProjectParseError>() {
            return Self::Parse(error.clone());
        }
        if error.chain().any(|cause| {
            cause
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.kind() == std::io::ErrorKind::PermissionDenied)
        }) {
            return Self::storage(persistence::WriteErrorCategory::PermissionDenied);
        }
        Self::Operation {
            message: operation.message,
            details: operation.details,
        }
    }

    fn storage(category: persistence::WriteErrorCategory) -> Self {
        use persistence::WriteErrorCategory;
        let (message, details) = match category {
            WriteErrorCategory::InvalidSerialization => (
                "Project settings could not be saved.",
                "The settings are not valid. Review them before saving again.",
            ),
            WriteErrorCategory::PermissionDenied => (
                "Project files could not be accessed.",
                "Check file and folder permissions, then try again.",
            ),
            WriteErrorCategory::InsufficientSpace => (
                "There is not enough disk space to save the project.",
                "Free some space, then save again.",
            ),
            WriteErrorCategory::TemporaryWrite => (
                "The project file could not be written.",
                "Check that the project folder is available and writable, then save again.",
            ),
            WriteErrorCategory::FileFlush => (
                "The project file could not be saved reliably.",
                "Check that the storage device is available, then save again.",
            ),
            WriteErrorCategory::Backup => (
                "The project backup could not be prepared.",
                "Check that the project folder is available and writable, then save again.",
            ),
            WriteErrorCategory::PrimaryReplacement => (
                "The project file could not be replaced.",
                "Check that the project folder is available and writable, then save again.",
            ),
            WriteErrorCategory::DurabilityUncertain => (
                "The project may not be saved reliably.",
                "The file was replaced, but storage could not confirm the save. Keep the project open and save again.",
            ),
            WriteErrorCategory::Recovery => (
                "The project could not be recovered.",
                "Keep the project and backup files unchanged. Restore a known-good backup before trying again.",
            ),
        };
        Self::Storage(persistence::AtomicWriteError {
            category,
            message: message.into(),
            details: details.into(),
        })
    }
}

async fn blocking<T: Send + 'static>(
    app: tauri::AppHandle,
    summary: &'static str,
    operation: impl FnOnce(&AppState) -> Result<T> + Send + 'static,
) -> Result<T, ConfigCommandError> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        operation(&app.state::<AppState>())
            .map_err(|error| ConfigCommandError::from_error(error, summary))
    })
    .await
    .map_err(|error| ConfigCommandError::from_error(error.into(), summary))?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn get_project_snapshot(
    app: tauri::AppHandle,
    generation: u64,
) -> Result<ProjectSnapshot, ConfigCommandError> {
    blocking(app, "Project settings could not be read.", move |state| {
        snapshot_for_state(state, generation)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn current_project_snapshot(
    app: tauri::AppHandle,
) -> Result<Option<ProjectSnapshot>, ConfigCommandError> {
    blocking(app, "Project settings could not be read.", |state| {
        let _transition = state
            .project_transition
            .lock()
            .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
        if state
            .project_config
            .lock()
            .map_err(|_| anyhow!("Project configuration lock was poisoned"))?
            .active
            .is_none()
        {
            return Ok(None);
        }
        let ownership = ownership::active(state).map_err(anyhow::Error::msg)?;
        let config = state
            .project_config
            .lock()
            .map_err(|_| anyhow!("Project configuration lock was poisoned"))?;
        let active = config.active.as_ref().unwrap();
        check_activation(active, &ownership, active.generation)?;
        Ok(Some(active.snapshot()))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn accept_project_edit(
    app: tauri::AppHandle,
    generation: u64,
    edit: ProjectEdit,
) -> Result<ProjectSnapshot, ConfigCommandError> {
    blocking(app, "Project changes could not be applied.", move |state| {
        edit_for_state(state, generation, edit)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn save_project(
    app: tauri::AppHandle,
    generation: u64,
) -> Result<ProjectSnapshot, ConfigCommandError> {
    blocking(app, "The project could not be saved.", move |state| {
        save_for_state(state, generation)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn inspect_project(
    app: tauri::AppHandle,
    path: String,
    recents: Vec<RecentProjectIdentity>,
) -> Result<ProjectInspection, ConfigCommandError> {
    blocking(app, "The project could not be opened.", move |state| {
        inspect_for_state(state, path, recents)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn activate_project(
    app: tauri::AppHandle,
    candidate_id: String,
    confirm_backup: bool,
) -> Result<ProjectSnapshot, ConfigCommandError> {
    blocking(app, "The project could not be opened.", move |state| {
        activate_for_state(state, candidate_id, confirm_backup)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn create_project(
    app: tauri::AppHandle,
    root: String,
    name: String,
    source: DataSource,
    profile_id: String,
) -> Result<ProjectInspection, ConfigCommandError> {
    blocking(app, "The project could not be created.", move |state| {
        create_for_state(state, root, name, source, profile_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn copy_project_candidate(
    app: tauri::AppHandle,
    candidate_id: String,
    confirm_backup: bool,
) -> Result<ProjectInspection, ConfigCommandError> {
    blocking(app, "The project could not be copied.", move |state| {
        copy_candidate_for_state(state, candidate_id, confirm_backup)
    })
    .await
}

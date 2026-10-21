use crate::project::persistence::{
    AtomicWriteError, FailurePoint, WriteErrorCategory, atomic_write_project_for_test,
    cleanup_project_temps_for_state,
};
use std::fs;
use tempfile::tempdir;

fn project_path() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempdir().expect("temporary project directory");
    let project = dir.path().join("project.easl");
    (dir, project)
}

#[test]
fn atomic_write_error_categories_serialize_for_frontend_contract() {
    for (category, expected) in [
        (
            WriteErrorCategory::InvalidSerialization,
            "invalid_serialization",
        ),
        (WriteErrorCategory::PermissionDenied, "permission_denied"),
        (WriteErrorCategory::InsufficientSpace, "insufficient_space"),
        (WriteErrorCategory::TemporaryWrite, "temporary_write"),
        (WriteErrorCategory::FileFlush, "file_flush"),
        (WriteErrorCategory::Backup, "backup"),
        (
            WriteErrorCategory::PrimaryReplacement,
            "primary_replacement",
        ),
        (
            WriteErrorCategory::DurabilityUncertain,
            "durability_uncertain",
        ),
        (WriteErrorCategory::Recovery, "recovery"),
    ] {
        let error = AtomicWriteError {
            category,
            message: "native write failure".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(&error).expect("serialize atomic write error"),
            serde_json::json!({
                "category": expected,
                "message": "native write failure",
            }),
            "unexpected frontend error contract for {category:?}"
        );
        assert_eq!(
            serde_json::to_value(error)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            2
        );
    }
}

#[test]
fn creates_primary_without_backup() {
    let (_dir, project) = project_path();

    atomic_write_project_for_test(&project, b"new", false, None).expect("write new project");

    assert_eq!(fs::read(&project).unwrap(), b"new");
    assert!(!project.with_extension("easl.bak").exists());
}

#[test]
fn replacement_keeps_previous_primary_as_backup() {
    let (_dir, project) = project_path();
    fs::write(&project, b"old").unwrap();

    atomic_write_project_for_test(&project, b"new", false, None).expect("replace project");

    assert_eq!(fs::read(&project).unwrap(), b"new");
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        b"old"
    );
}

#[test]
fn canonical_project_bytes_survive_create_open_save_and_reopen() {
    let (_dir, project) = project_path();
    let original = br#"{
  "schemaVersion": 2,
  "projectMeta": {
    "id": "project-1",
    "name": "Original",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "lastOpened": "2026-09-01T00:00:00.000Z",
    "currentPhase": "import",
    "dataSource": "dicom"
  },
  "uiState": {
    "processing": {"currentPhase":"completed","structural":{"completed":true,"lastRun":{"profileId":"old","exploreASLVersion":"1","matlabVersion":"2","guiVersion":"3","Mtime":12}},"asl":{"completed":true,"lastRun":{"profileId":"old","exploreASLVersion":"1","matlabVersion":"2","guiVersion":"3","Mtime":13}},"population":{"completed":true,"lastRun":{"profileId":"old","exploreASLVersion":"1","matlabVersion":"2","guiVersion":"3","Mtime":14}}},
    "manifest": {"reviewers": [{"id": "11111111-1111-4111-8111-111111111111", "label": "Reviewer 1", "createdAt": "2026-01-01T00:00:00Z"}, {"id": "33333333-3333-4333-8333-333333333333", "label": "Reviewer 2", "createdAt": "2026-01-01T00:00:00Z"}], "activeReviewerId": "11111111-1111-4111-8111-111111111111", "verdicts": {"11111111-1111-4111-8111-111111111111": {"sub-01_01": {"status": "pass", "reason": "motion", "notes": "Reviewed", "setAt": 1}}, "33333333-3333-4333-8333-333333333333": {}}, "resolvedVerdicts": {"sub-01_01": {"status": "fail", "reason": "coverage", "setAt": 2}}},
    "import": {"mostRecentConfig": {"sourceDataPath": ".", "pathPatterns": [], "tokenizerConfigs": {}, "bMatchDirectories": true, "modalityAliases": [], "sessionAliases": [], "runAliases": [], "subjectRenames": [], "metadataGroups": [{"id": "g", "label": "Group", "bidsParams": {"PostLabelingDelay": [1.8, 0], "vendor": {"nested": [true, null, 3]}}}], "subjectRows": [], "selectedProfileId": "profile"}}
  },
  "mappingState": {},
  "dataPar": {
    "M0": 0, "BackgroundSuppressionNumberPulses": 4, "BackgroundSuppressionPulseTime": [0.5,1.2], "M0_GMScaleFactor": 1, "bRegisterM02ASL": 1, "M0_conventionalProcessing": 0, "RepetitionTimePreparationM0": 8,
    "nCompartments": 1, "Lambda": 0.9, "T2art": 50, "T1blood": 1650, "T1GM": 1300, "T1WM": 1100, "T2GM": 80, "T2WM": 45, "T2tissueMultiTE": 0.04,
    "bUseExternalQuantification": true, "ExternalQuantificationType": "BASIL", "ExternalQuantificationSmoothGaussianMM": [5.5,5,1.5], "bMaskingExternal": false, "bSpatialBASIL": true, "bInferT1BASIL": false, "bInferATTBASIL": true, "ExchBASIL": "mix", "DispBASIL": "gamma", "ATTSDBASIL": 1.5, "bCleanUpExternal": false,
    "Quality": null, "DELETETEMP": 0, "SkipIfNoFlair": 1, "SkipIfNoASL": 0, "SkipIfNoM0": 1, "enableMetadataGroupingCorrection": true,
    "motionCorrection": 1, "bTopUp": false, "bPVCNativeSpace": 1, "bPVCGaussianMM": 1, "PVCNativeSpaceKernel": [5,5,1], "SaveCBF4D": true, "SpikeRemovalThreshold": 3, "SpikeRemovalAbsoluteThreshold": 100, "bRegistrationContrast": 1, "bAffineRegistration": 2, "bDCTRegistration": 0, "bUseMNIasDummyStructural": 0, "bHct2BloodT1": 1, "ApplyQuantification": [1,0,1,0,1,0],
    "Atlases": ["MNI_Structural","Hammers"], "TissueMasking": ["GM","WM"], "TissueThreshold": [0,1], "bMasking": [1,0,1,0], "MinimalROIVolume": 10, "bWMH": true, "DataTypes": ["CBF","M0map"],
    "bRunLongReg": 1, "bRunDARTEL": 0, "WMHsegmAlg": "LPA", "bSegmentSPM12": 1, "bHammersCAT12": 0, "bFixResolution": true, "bLesionFilling": false, "bAutoACPC": true,
    "bAutomaticallyDetectFSL": true, "bAutomaticallyDetectVABY": false, "vendor": {"nested": [true,null,3]}
  }
}"#;

    atomic_write_project_for_test(&project, original, false, None).expect("create project");
    let state = crate::app::state::AppState::default();
    let inspection = crate::project::config::inspect_for_state(
        &state,
        project.to_string_lossy().into_owned(),
        vec![],
    )
    .unwrap();
    let opened =
        crate::project::config::activate_for_state(&state, inspection.candidate_id, false).unwrap();
    crate::project::config::save_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(
        fs::read(&project).unwrap(),
        original,
        "opening is read-only"
    );
    let edited = crate::project::config::edit_for_state(
        &state,
        opened.activation_generation,
        crate::project::model::ProjectEdit::Navbar { collapsed: false },
    )
    .unwrap();
    assert!(edited.accepted_revision > edited.persisted_revision);
    let saved =
        crate::project::config::save_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(saved.accepted_revision, saved.persisted_revision);
    let disk = fs::read(&project).unwrap();
    let backup = fs::read(project.with_extension("easl.bak")).unwrap();
    let entries = || {
        fs::read_dir(project.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<std::collections::BTreeSet<_>>()
    };
    let before_entries = entries();
    assert!(
        crate::project::config::edit_for_state(
            &state,
            opened.activation_generation,
            crate::project::model::ProjectEdit::ActiveReviewer {
                id: "22222222-2222-4222-8222-222222222222".into(),
            },
        )
        .is_err()
    );
    let rejected =
        crate::project::config::snapshot_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(rejected.document, saved.document);
    assert_eq!(
        (rejected.accepted_revision, rejected.persisted_revision),
        (saved.accepted_revision, saved.persisted_revision)
    );
    assert_eq!(fs::read(&project).unwrap(), disk);
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        backup
    );
    assert_eq!(entries(), before_entries);
    let unchanged = crate::project::config::edit_for_state(
        &state,
        opened.activation_generation,
        crate::project::model::ProjectEdit::Navbar { collapsed: false },
    )
    .unwrap();
    assert_eq!(unchanged.document, saved.document);
    assert_eq!(
        (unchanged.accepted_revision, unchanged.persisted_revision),
        (saved.accepted_revision, saved.persisted_revision)
    );
    crate::project::config::save_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(fs::read(&project).unwrap(), disk);
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        backup
    );
    assert_eq!(entries(), before_entries);
    let reopened = crate::project::validation::parse_document(&fs::read(&project).unwrap())
        .expect("reopen saved project");

    assert_eq!(u8::from(reopened.schema_version), 2);
    assert_eq!(reopened.project_meta.name, "Original");
    assert_eq!(reopened.ui_state.navbar_collapsed, Some(false));
    assert_eq!(reopened.data_par, opened.document.data_par);
    assert_eq!(reopened.ui_state.import, opened.document.ui_state.import);
    assert_eq!(
        reopened.ui_state.manifest,
        opened.document.ui_state.manifest
    );
    assert!(
        !serde_json::to_value(&reopened.data_par)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("Quality")
    );
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        original
    );
    let newer = crate::project::config::edit_for_state(
        &state,
        opened.activation_generation,
        crate::project::model::ProjectEdit::Navbar { collapsed: true },
    )
    .unwrap();
    assert!(newer.accepted_revision > saved.persisted_revision);
    let pending =
        crate::project::config::snapshot_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(pending.accepted_revision, newer.accepted_revision);
    assert_eq!(pending.persisted_revision, saved.persisted_revision);
    crate::project::config::save_for_state(&state, opened.activation_generation).unwrap();
    let candidate = crate::project::config::inspect_for_state(
        &state,
        project.to_string_lossy().into_owned(),
        vec![],
    )
    .unwrap();
    let reopened =
        crate::project::config::activate_for_state(&state, candidate.candidate_id, false).unwrap();
    assert_ne!(reopened.activation_generation, opened.activation_generation);
    assert_eq!(reopened.document.ui_state.navbar_collapsed, Some(true));
    assert!(crate::project::config::save_for_state(&state, opened.activation_generation).is_err());

    use crate::project::model::{
        DataSource, ImportUiState, ModuleResult, ProcessingUiState,
        ProjectPhase::{Import, Manifest, Parameters, Processing, Visualization},
    };
    for (source, ready, population, expected) in [
        (DataSource::Dicom, None, false, vec![Import, Parameters]),
        (
            DataSource::Dicom,
            Some(false),
            false,
            vec![Import, Parameters],
        ),
        (
            DataSource::Dicom,
            Some(true),
            false,
            vec![Import, Parameters, Processing],
        ),
        (DataSource::Bids, None, false, vec![Import, Parameters]),
        (
            DataSource::Bids,
            Some(false),
            true,
            vec![Import, Parameters, Visualization, Manifest],
        ),
        (
            DataSource::Bids,
            Some(true),
            false,
            vec![Import, Parameters, Processing],
        ),
    ] {
        let mut document = reopened.document.clone();
        document.project_meta.data_source = source;
        document.ui_state.import = ready.map(|ready| ImportUiState {
            completed: Some(source == DataSource::Dicom && ready),
            bids_review_confirmed: Some(source == DataSource::Bids && ready),
            ..Default::default()
        });
        document.ui_state.processing = population.then_some(ProcessingUiState {
            population: Some(ModuleResult {
                completed: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        });
        assert_eq!(crate::project::config::allowed_phases(&document), expected);
    }

    let copy = tempdir().unwrap();
    let copy_path = copy.path().join("project.easl");
    let original_bytes = fs::read(&project).unwrap();
    fs::write(&copy_path, &original_bytes).unwrap();
    let inspected = crate::project::config::inspect_for_state(
        &state,
        copy_path.to_string_lossy().into_owned(),
        vec![crate::project::model::RecentProjectIdentity {
            path: project.to_string_lossy().into_owned(),
            project_id: Some(reopened.document.project_meta.id.clone()),
        }],
    )
    .unwrap();
    assert_eq!(
        inspected.duplicate_path,
        Some(project.to_string_lossy().into_owned())
    );
    let copied = crate::project::config::copy_candidate_for_state(
        &state,
        inspected.candidate_id.clone(),
        false,
    )
    .unwrap();
    let persisted =
        crate::project::validation::parse_document(&fs::read(&copy_path).unwrap()).unwrap();
    assert_ne!(persisted.project_meta.id, reopened.document.project_meta.id);
    assert_eq!(persisted.project_meta.id, copied.project_id);
    let mut expected = reopened.document.clone();
    expected.project_meta.id = copied.project_id;
    assert_eq!(
        persisted, expected,
        "copy preserves every non-identity field"
    );
    assert_eq!(fs::read(&project).unwrap(), original_bytes);
    assert_eq!(
        crate::project::config::snapshot_for_state(&state, reopened.activation_generation)
            .unwrap()
            .document,
        reopened.document,
        "copy persistence precedes activation and retains A"
    );
    let activated =
        crate::project::config::activate_for_state(&state, copied.candidate_id, false).unwrap();
    assert_eq!(activated.document, persisted);
    assert_eq!(activated.accepted_revision, activated.persisted_revision);
    for (path, project_id, moved) in [
        (
            copy.path().join("missing.easl"),
            Some(activated.document.project_meta.id.clone()),
            true,
        ),
        (copy.path().join("missing.easl"), None, false),
        (
            project.clone(),
            Some(activated.document.project_meta.id.clone()),
            false,
        ),
    ] {
        let inspected = crate::project::config::inspect_for_state(
            &state,
            copy_path.to_string_lossy().into_owned(),
            vec![crate::project::model::RecentProjectIdentity {
                path: path.to_string_lossy().into_owned(),
                project_id,
            }],
        )
        .unwrap();
        assert_eq!(
            inspected.moved_from,
            moved.then(|| path.to_string_lossy().into_owned())
        );
        assert_eq!(inspected.duplicate_path, None);
    }
    use crate::project::{config, model::*};
    let generation = activated.activation_generation;
    let mut expected = activated.document.clone();
    for (modules, normalized, workers) in [
        (
            vec![ProcessingModule::Structural, ProcessingModule::Population],
            vec![ProcessingModule::Population],
            1,
        ),
        (
            vec![ProcessingModule::Population, ProcessingModule::Asl],
            vec![ProcessingModule::Asl],
            4,
        ),
        (
            vec![ProcessingModule::Population],
            vec![ProcessingModule::Population],
            1,
        ),
    ] {
        let selection = ProcessingConfig {
            subjects: vec!["sub-01_01".into()],
            modules,
            selected_profile_id: "profile".into(),
            workers: 4,
            rerun_bids2_legacy: Some(true),
        };
        let accepted = config::edit_for_state(
            &state,
            generation,
            ProjectEdit::Processing { config: selection },
        )
        .unwrap();
        let selection = accepted
            .document
            .ui_state
            .processing
            .as_ref()
            .unwrap()
            .config
            .as_ref()
            .unwrap();
        assert_eq!(selection.modules, normalized);
        assert_eq!(selection.workers, workers);
        assert_eq!(
            selection.rerun_bids2_legacy,
            Some(normalized != vec![ProcessingModule::Population])
        );
        expected.ui_state.processing.as_mut().unwrap().config = Some(selection.clone());
        assert_eq!(
            accepted.document, expected,
            "selection preserves every result and sibling section"
        );
    }
    let visualization: VisualizationConfig = serde_json::from_value(serde_json::json!({
        "qcbfSource":{"relativePath":"qcbf.tsv","fileHash":"q"}, "joinConfig":{"externalSource":{"absolutePath":copy.path().join("external.csv"),"fileHash":"same","sheetName":null},"keys":[{"left":"subject","right":"id"}],"dropRightOn":true,"naTokens":["NA"],"delimiter":","},
        "columnTypes":{"group":"nominal"},"levelOrderings":{"group":["A","B"]},"identifiers":{"subject":"subject","session":"session","run":"run"},"axisAssignment":{"x":"group","y":"qcbf","colorBy":null},"domainFilters":{"xMin":null,"xMax":null,"yMin":1,"yMax":2},"stage":"visualize","pointSize":14,"nvColormap":"hot"
    })).unwrap();
    let mut values = expected.data_par.clone();
    values.Quality = Some(1_u8.try_into().unwrap());
    let visibility = AdvancedVisibility {
        show_advanced_sections: true,
        ..Default::default()
    };
    expected.data_par = values.clone();
    expected.ui_state.datapar = Some(DataParUiState {
        advanced_visibility: Some(visibility.clone()),
    });
    assert_eq!(
        config::edit_for_state(
            &state,
            generation,
            ProjectEdit::Parameters { values, visibility }
        )
        .unwrap()
        .document,
        expected
    );
    expected.ui_state.data_vis = Some(visualization.clone());
    assert_eq!(
        config::edit_for_state(
            &state,
            generation,
            ProjectEdit::Visualization {
                config: visualization
            }
        )
        .unwrap()
        .document,
        expected
    );
    for compatible in [true, false] {
        let source = ExternalSource {
            absolute_path: copy.path().join("replacement.csv").to_string_lossy().into(),
            file_hash: if compatible { "same" } else { "changed" }.into(),
            sheet_name: None,
        };
        let vis = expected.ui_state.data_vis.as_mut().unwrap();
        vis.join_config.as_mut().unwrap().external_source = source.clone();
        if !compatible {
            vis.join_config.as_mut().unwrap().keys.clear();
            vis.column_types = Some(Default::default());
            vis.identifiers = None;
            vis.level_orderings = Some(Default::default());
            vis.axis_assignment = Some(Default::default());
            vis.domain_filters = Some(Default::default());
            vis.stage = Some("selectData".into());
        }
        assert_eq!(
            config::edit_for_state(
                &state,
                generation,
                ProjectEdit::RelinkExternal { source, compatible }
            )
            .unwrap()
            .document,
            expected
        );
    }
    config::save_for_state(&state, generation).unwrap();
    assert_eq!(
        crate::project::validation::parse_document(&fs::read(&copy_path).unwrap()).unwrap(),
        expected
    );
    let log_dir = copy.path().join("derivatives/ExploreASL/log");
    fs::create_dir_all(&log_dir).unwrap();
    let log = log_dir.join("xASL_module_ASL_sub-01_01_ASL_2.log");
    fs::write(&log, "complete").unwrap();
    let mtime = log
        .metadata()
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let value = Verdict {
        status: VerdictStatus::Pass,
        reason: None,
        notes: None,
        set_at: 999,
    };
    let accepted = config::edit_for_state(
        &state,
        generation,
        ProjectEdit::Verdict {
            subject_session: "sub-01_01".into(),
            reviewer_id: None,
            value: Some(value.clone()),
        },
    )
    .unwrap();
    let id = accepted
        .document
        .ui_state
        .manifest
        .active_reviewer_id
        .clone();
    assert_eq!(
        accepted.document.ui_state.manifest.verdicts[&id]["sub-01_01"].set_at,
        mtime
    );
    let notes = &accepted.document.ui_state.manifest.verdicts[&id]["sub-01_01"].notes;
    assert!(notes.is_none());
    let resolved = config::edit_for_state(
        &state,
        generation,
        ProjectEdit::Resolution {
            subject_session: "sub-01_01".into(),
            value: Some(value),
        },
    )
    .unwrap();
    assert_eq!(
        resolved.document.ui_state.manifest.resolved_verdicts["sub-01_01"].set_at,
        mtime
    );
    let edit = |edit| config::edit_for_state(&state, generation, edit).unwrap();
    let before = resolved;
    let appended = edit(ProjectEdit::AddReviewer);
    let manifest = &appended.document.ui_state.manifest;
    let added = manifest.reviewers.last().unwrap();
    assert_eq!(added.label, "Reviewer 3");
    assert_eq!(manifest.active_reviewer_id, id);
    assert_eq!(
        manifest.verdicts[&id],
        before.document.ui_state.manifest.verdicts[&id]
    );
    assert!(manifest.verdicts[&added.id].is_empty());
    let second = manifest.reviewers[1].id.clone();
    let selected = edit(ProjectEdit::ActiveReviewer { id: second.clone() });
    let renamed = edit(ProjectEdit::RenameReviewer {
        id: second.clone(),
        label: "Second QC reader".into(),
    });
    let mut expected = selected.document.clone();
    expected.ui_state.manifest.reviewers[1].label = "Second QC reader".into();
    assert_eq!(renamed.document, expected);
    assert_eq!(
        edit(ProjectEdit::RenameReviewer {
            id: "unknown".into(),
            label: "Unknown".into()
        }),
        renamed
    );
    assert!(
        config::edit_for_state(
            &state,
            generation,
            ProjectEdit::RenameReviewer {
                id: second.clone(),
                label: String::new()
            }
        )
        .is_err()
    );
    let pass = Verdict {
        status: VerdictStatus::Pass,
        reason: Some(FailReason::Other),
        notes: Some("second".into()),
        set_at: 999,
    };
    let targeted = edit(ProjectEdit::Verdict {
        subject_session: "sub-02_01".into(),
        reviewer_id: Some(id.clone()),
        value: Some(pass.clone()),
    });
    assert_eq!(
        targeted.document.ui_state.manifest.verdicts[&id]["sub-02_01"].set_at,
        0
    );
    let active = edit(ProjectEdit::Verdict {
        subject_session: "sub-01_01".into(),
        reviewer_id: None,
        value: Some(pass.clone()),
    });
    assert_eq!(
        active.document.ui_state.manifest.verdicts[&second]["sub-01_01"].notes,
        pass.notes
    );
    let mut fail = pass.clone();
    fail.status = VerdictStatus::Fail;
    fail.reason = None;
    for edit in [
        ProjectEdit::Verdict {
            subject_session: "sub-01_01".into(),
            reviewer_id: None,
            value: Some(fail.clone()),
        },
        ProjectEdit::Resolution {
            subject_session: "sub-01_01".into(),
            value: Some(fail),
        },
        ProjectEdit::Verdict {
            subject_session: "sub-01_01".into(),
            reviewer_id: Some("unknown".into()),
            value: Some(pass.clone()),
        },
    ] {
        assert!(config::edit_for_state(&state, generation, edit).is_err());
        assert_eq!(
            config::snapshot_for_state(&state, generation).unwrap(),
            active
        );
    }
    edit(ProjectEdit::Resolution {
        subject_session: "sub-01_01".into(),
        value: Some(pass.clone()),
    });
    let changed = edit(ProjectEdit::Verdict {
        subject_session: "sub-01_01".into(),
        reviewer_id: Some(id.clone()),
        value: None,
    });
    assert!(
        changed
            .document
            .ui_state
            .manifest
            .resolved_verdicts
            .is_empty()
    );
    assert_eq!(
        changed.document.ui_state.manifest.verdicts[&second],
        active.document.ui_state.manifest.verdicts[&second]
    );
    edit(ProjectEdit::Resolution {
        subject_session: "sub-01_01".into(),
        value: Some(pass),
    });
    let removed = edit(ProjectEdit::RemoveReviewer { id: second });
    assert_eq!(removed.document.ui_state.manifest.active_reviewer_id, id);
    let sole = edit(ProjectEdit::RemoveReviewer {
        id: added.id.clone(),
    });
    assert_eq!(
        sole.document.ui_state.manifest.reviewers,
        vec![before.document.ui_state.manifest.reviewers[0].clone()]
    );
    assert!(sole.document.ui_state.manifest.resolved_verdicts.is_empty());
    assert_eq!(sole.document.ui_state.manifest.verdicts.len(), 1);
    assert_eq!(edit(ProjectEdit::RemoveReviewer { id: id.clone() }), sole);
    for _ in 1..5 {
        edit(ProjectEdit::AddReviewer);
    }
    let capped = config::snapshot_for_state(&state, generation).unwrap();
    assert_eq!(edit(ProjectEdit::AddReviewer), capped);
    let mut siblings = capped.document.clone();
    siblings.ui_state.manifest = before.document.ui_state.manifest.clone();
    assert_eq!(siblings, before.document);
    config::save_for_state(&state, generation).unwrap();
    assert_eq!(
        crate::project::validation::parse_document(&fs::read(&copy_path).unwrap()).unwrap(),
        capped.document
    );
}

#[test]
fn bids_confirmation_derives_mapping_and_rejects_unreviewed_replacements() {
    use crate::project::{config, model::*};
    let (dir, path) = project_path();
    let state = crate::app::state::AppState::default();
    let mut prior = config::defaults("BIDS".into(), DataSource::Bids, "profile".into()).unwrap();
    prior.mapping_state.metadata_groups = Some(vec![MetadataGroup {
        id: "prior".into(),
        label: "Prior group".into(),
        bids_params: BidsMetadata::default(),
    }]);
    prior.mapping_state.subject_rows = Some(vec![SubjectRow {
        id: "sub-old_1".into(),
        subject: "old".into(),
        session: "1".into(),
        group_id: "prior".into(),
    }]);
    let prior_bytes = config::serialize(&prior).unwrap();
    fs::write(&path, &prior_bytes).unwrap();
    let inspection = config::inspect_for_state(&state, path.display().to_string(), vec![]).unwrap();
    let opened = config::activate_for_state(&state, inspection.candidate_id, false).unwrap();
    let group = BidsReviewGroup {
        id: "group".into(),
        label: "Group".into(),
        bids_params: BidsMetadata::default(),
        vendor: "Vendor".into(),
        sequence: "Sequence".into(),
        labeling_type: "PCASL".into(),
        subjects: vec![BidsReviewSubject {
            subject_label: "sub-01".into(),
            session_labels: vec!["1".into(), "2".into()],
        }],
    };
    for groups in [
        vec![],
        vec![BidsReviewGroup {
            label: "".into(),
            ..group.clone()
        }],
        vec![
            group.clone(),
            BidsReviewGroup {
                id: "other".into(),
                label: "gRoUp".into(),
                ..group.clone()
            },
        ],
    ] {
        assert!(
            config::edit_for_state(
                &state,
                opened.activation_generation,
                ProjectEdit::ConfirmBids {
                    groups,
                    skipped: vec![]
                }
            )
            .is_err()
        );
        assert_eq!(
            config::snapshot_for_state(&state, opened.activation_generation)
                .unwrap()
                .document,
            opened.document
        );
    }
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let backup = dir.path().join("project.easl.bak");
    fs::write(&backup, &prior_bytes).unwrap();
    assert!(
        config::edit_for_state(
            &state,
            opened.activation_generation,
            ProjectEdit::ConfirmBids {
                groups: vec![group.clone()],
                skipped: vec![]
            }
        )
        .is_err()
    );
    let failed = config::snapshot_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(failed.document, opened.document);
    assert_eq!(
        (failed.accepted_revision, failed.persisted_revision),
        (opened.accepted_revision, opened.persisted_revision)
    );
    assert_eq!(fs::read(&backup).unwrap(), prior_bytes);
    fs::remove_dir(&path).unwrap();
    fs::write(&path, config::serialize(&opened.document).unwrap()).unwrap();
    let accepted = config::edit_for_state(
        &state,
        opened.activation_generation,
        ProjectEdit::ConfirmBids {
            groups: vec![group],
            skipped: vec!["sub-missing_1".into()],
        },
    )
    .unwrap();
    assert_eq!(
        accepted.document.mapping_state.source_data_path.as_deref(),
        Some(".")
    );
    assert_eq!(
        accepted.document.mapping_state.ingestion_complete,
        Some(true)
    );
    assert_eq!(
        accepted.document.mapping_state.subject_rows,
        Some(vec![
            SubjectRow {
                id: "sub-01_1".into(),
                subject: "01".into(),
                session: "1".into(),
                group_id: "group".into()
            },
            SubjectRow {
                id: "sub-01_2".into(),
                subject: "01".into(),
                session: "2".into(),
                group_id: "group".into()
            },
        ])
    );
    assert_eq!(
        accepted
            .document
            .mapping_state
            .metadata_groups
            .as_ref()
            .unwrap()[0]
            .label,
        "Group"
    );
    assert_eq!(
        accepted.document.project_meta.current_phase,
        ProjectPhase::Parameters
    );
    let import = accepted.document.ui_state.import.as_ref().unwrap();
    assert_eq!(import.bids_review_confirmed, Some(true));
    assert_eq!(import.skipped_subjects, Some(vec!["sub-missing_1".into()]));
    assert_eq!(accepted.accepted_revision, accepted.persisted_revision);
    config::save_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(
        crate::project::validation::parse_document(&fs::read(&path).unwrap()).unwrap(),
        accepted.document
    );
    let changed = config::edit_for_state(
        &state,
        opened.activation_generation,
        ProjectEdit::Import {
            mapping: accepted.document.mapping_state.clone(),
            preferences: ImportPreferences {
                active_step: Some(3),
                selected_profile_id: Some("other-profile".into()),
            },
        },
    )
    .unwrap();
    assert_eq!(
        changed.document.mapping_state,
        accepted.document.mapping_state
    );
    assert_eq!(
        changed
            .document
            .ui_state
            .import
            .as_ref()
            .unwrap()
            .bids_review_confirmed,
        Some(true)
    );
    assert!(
        config::edit_for_state(
            &state,
            opened.activation_generation,
            ProjectEdit::Import {
                mapping: MappingState::default(),
                preferences: ImportPreferences::default()
            }
        )
        .is_err()
    );
    assert_eq!(
        config::snapshot_for_state(&state, opened.activation_generation)
            .unwrap()
            .document,
        changed.document
    );
    assert!(dir.path().join("project.easl").exists());
}

#[test]
fn dicom_relinks_preserve_compatible_settings_and_reset_only_source_dependent_settings() {
    use crate::project::{config, model::*};
    let (dir, path) = project_path();
    let state = crate::app::state::AppState::default();
    let mut document =
        config::defaults("Study".into(), DataSource::Dicom, "profile".into()).unwrap();
    document.data_par.Lambda = Some(0.9);
    document
        .ui_state
        .import
        .as_mut()
        .unwrap()
        .most_recent_config = Some(ImportSnapshot {
        source_data_path: ".".into(),
        path_patterns: vec![],
        tokenizer_configs: Default::default(),
        b_match_directories: false,
        modality_aliases: vec![],
        session_aliases: vec![],
        run_aliases: vec![],
        subject_renames: vec![],
        metadata_groups: vec![],
        subject_rows: vec![],
        selected_profile_id: Some("profile".into()),
    });
    fs::write(&path, config::serialize(&document).unwrap()).unwrap();
    let inspected = config::inspect_for_state(&state, path.display().to_string(), vec![]).unwrap();
    let opened = config::activate_for_state(&state, inspected.candidate_id, false).unwrap();
    let generation = opened.activation_generation;
    let mut mapping = opened.document.mapping_state;
    mapping.source_data_path = Some(".".into());
    mapping.b_match_directories = Some(false);
    mapping.raw_paths = Some(vec!["sub/scan.dcm".into()]);
    let pattern = serde_json::json!({
        "signature": "sub/<TOKEN>",
        "samplePath": "sub/scan.dcm",
        "blocks": ["sub", "scan.dcm"],
        "uniqueNames": {"0": ["sub"], "1": ["scan.dcm"]},
        "count": 1,
        "depth": 2
    });
    mapping.path_patterns = Some(vec![serde_json::from_value(pattern.clone()).unwrap()]);
    mapping.subject_renames = Some(vec![SubjectRename {
        original: "sub".into(),
        target: "subject".into(),
    }]);
    config::edit_for_state(
        &state,
        generation,
        serde_json::from_value(serde_json::json!({
            "kind": "import",
            "mapping": mapping,
            "preferences": {"activeStep": 4, "selectedProfileId": "profile"}
        }))
        .unwrap(),
    )
    .unwrap();
    fs::create_dir(dir.path().join("replacement")).unwrap();
    let internal = dir.path().join("replacement").display().to_string();
    let external = tempdir().unwrap();
    let absolute = external
        .path()
        .canonicalize()
        .unwrap()
        .display()
        .to_string();
    for (source, stored, compatible) in [
        (internal.as_str(), "./replacement", true),
        (absolute.as_str(), absolute.as_str(), true),
        (internal.as_str(), "./replacement", false),
    ] {
        let accepted = config::edit_for_state(
            &state,
            generation,
            serde_json::from_value(serde_json::json!({
                "kind": "relinkDicom",
                "path": source,
                "rawPaths": ["new/scan.dcm"],
                "patterns": [pattern],
                "compatible": compatible
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            accepted.document.mapping_state.source_data_path.as_deref(),
            Some(stored)
        );
        assert_eq!(
            accepted
                .document
                .ui_state
                .import
                .as_ref()
                .unwrap()
                .selected_profile_id
                .as_deref(),
            Some("profile")
        );
        assert_eq!(
            accepted.document.mapping_state.b_match_directories,
            Some(false)
        );
        assert_eq!(accepted.document.data_par, document.data_par);
        if compatible {
            assert_eq!(
                accepted
                    .document
                    .ui_state
                    .import
                    .as_ref()
                    .unwrap()
                    .most_recent_config
                    .as_ref()
                    .unwrap()
                    .source_data_path,
                stored
            );
            let mut expected_mapping = mapping.clone();
            expected_mapping.source_data_path = Some(stored.into());
            assert_eq!(accepted.document.mapping_state, expected_mapping);
            assert_eq!(accepted.document.mapping_state.raw_paths, mapping.raw_paths);
            assert_eq!(
                accepted.document.mapping_state.subject_renames,
                mapping.subject_renames
            );
        } else {
            assert_eq!(
                accepted
                    .document
                    .ui_state
                    .import
                    .as_ref()
                    .unwrap()
                    .most_recent_config,
                None
            );
            assert_eq!(
                accepted.document.mapping_state.raw_paths,
                Some(vec!["new/scan.dcm".into()])
            );
            assert_eq!(accepted.document.mapping_state.subject_renames, None);
            assert_eq!(
                accepted.document.mapping_state.ingestion_complete,
                Some(true)
            );
            assert_eq!(
                accepted
                    .document
                    .ui_state
                    .import
                    .as_ref()
                    .unwrap()
                    .active_step,
                Some(0)
            );
        }
        config::save_for_state(&state, generation).unwrap();
        assert_eq!(
            crate::project::validation::parse_document(&fs::read(&path).unwrap()).unwrap(),
            accepted.document
        );
    }
}

#[test]
fn every_interruption_leaves_complete_old_or_new_bytes() {
    for (failure, expected_category) in [
        (FailurePoint::TempCreate, WriteErrorCategory::TemporaryWrite),
        (FailurePoint::TempWrite, WriteErrorCategory::TemporaryWrite),
        (FailurePoint::TempSync, WriteErrorCategory::FileFlush),
        (FailurePoint::BackupRotation, WriteErrorCategory::Backup),
        (FailurePoint::BackupSync, WriteErrorCategory::Backup),
        (
            FailurePoint::PrimaryReplace,
            WriteErrorCategory::PrimaryReplacement,
        ),
        (
            FailurePoint::DirectorySync,
            WriteErrorCategory::DurabilityUncertain,
        ),
    ] {
        let (_dir, project) = project_path();
        fs::write(&project, b"old").unwrap();

        let error = atomic_write_project_for_test(&project, b"new", false, Some(failure))
            .expect_err("injected operation must fail");

        assert_eq!(
            error.category, expected_category,
            "unexpected category for {failure:?}"
        );
        let candidates = [project.clone(), project.with_extension("easl.bak")];
        assert!(
            candidates
                .iter()
                .any(|path| fs::read(path).is_ok_and(|b| b == b"old" || b == b"new"))
        );
    }
}

#[test]
fn current_backup_inspection_requires_consent_and_preserves_recovery_bytes() {
    use crate::project::{config, model::DataSource};
    let state = crate::app::state::AppState::default();
    let original =
        config::defaults("Original".into(), DataSource::Dicom, "profile".into()).unwrap();
    let bytes = config::serialize(&original).unwrap();
    let mut roots = Vec::new();
    for (primary, recovered, unsupported) in [
        (Some(bytes.as_slice()), false, false),
        (None, true, false),
        (Some(b"{".as_slice()), true, false),
        (Some(br#"{"schemaVersion":3}"#.as_slice()), false, true),
    ] {
        let root = tempdir().unwrap();
        let path = root.path().join("project.easl");
        let backup = root.path().join("project.easl.bak");
        if let Some(primary) = primary {
            fs::write(&path, primary).unwrap();
        }
        fs::write(&backup, &bytes).unwrap();
        let inspection =
            config::inspect_for_state(&state, path.to_string_lossy().into_owned(), vec![]);
        assert_eq!(fs::read(&path).ok().as_deref(), primary);
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        if unsupported {
            assert!(inspection.is_err());
            continue;
        }
        let candidate = inspection.unwrap();
        assert_eq!(candidate.recovered_from_backup, recovered);
        if recovered {
            let before = state
                .project_config
                .lock()
                .unwrap()
                .active
                .as_ref()
                .unwrap()
                .snapshot();
            assert!(
                config::activate_for_state(&state, candidate.candidate_id.clone(), false).is_err()
            );
            assert_eq!(
                config::snapshot_for_state(&state, before.activation_generation)
                    .unwrap()
                    .document,
                before.document
            );
        }
        let opened = config::activate_for_state(&state, candidate.candidate_id, recovered).unwrap();
        assert_eq!(opened.document, original);
        assert_eq!(opened.recovered_from_backup, recovered);
        assert_eq!(fs::read(&path).ok().as_deref(), primary);
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        if recovered {
            if path.exists() {
                fs::remove_file(&path).unwrap();
            }
            fs::create_dir(&path).unwrap();
            assert!(config::save_for_state(&state, opened.activation_generation).is_err());
            let pending = config::snapshot_for_state(&state, opened.activation_generation).unwrap();
            assert!(pending.recovered_from_backup);
            assert_eq!(pending.document, opened.document);
            assert_eq!(
                (pending.accepted_revision, pending.persisted_revision),
                (opened.accepted_revision, opened.persisted_revision)
            );
            assert_eq!(fs::read(&backup).unwrap(), bytes);
            fs::remove_dir(&path).unwrap();
            if let Some(primary) = primary {
                fs::write(&path, primary).unwrap();
            }
        }
        config::save_for_state(&state, opened.activation_generation).unwrap();
        let repaired = config::snapshot_for_state(&state, opened.activation_generation).unwrap();
        assert!(!repaired.recovered_from_backup);
        assert_eq!(repaired.accepted_revision, repaired.persisted_revision);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        roots.push(root);
    }
}

#[test]
fn unsupported_directory_sync_succeeds_with_reduced_durability() {
    let (_dir, project) = project_path();

    let outcome = atomic_write_project_for_test(
        &project,
        b"new",
        false,
        Some(FailurePoint::DirectorySyncUnsupported),
    )
    .expect("unsupported directory sync must not fail the write");

    assert!(!outcome.directory_sync_supported);
    assert_eq!(fs::read(project).unwrap(), b"new");
}

#[test]
fn recovery_preservation_does_not_rotate_malformed_primary_over_backup() {
    let (_dir, project) = project_path();
    fs::write(&project, b"malformed").unwrap();
    fs::write(project.with_extension("easl.bak"), b"known-good").unwrap();

    atomic_write_project_for_test(&project, b"repaired", true, None).expect("repair primary");

    assert_eq!(fs::read(&project).unwrap(), b"repaired");
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        b"known-good"
    );
}

#[test]
fn removes_only_writer_owned_stale_temps_after_success() {
    let (dir, project) = project_path();
    let stale = dir.path().join(".project.easl.atomic-stale.tmp");
    let unrelated = dir.path().join(".project.easl.tmp");
    fs::write(&stale, b"stale").unwrap();
    fs::write(&unrelated, b"keep").unwrap();

    atomic_write_project_for_test(&project, b"new", false, None).expect("write project");

    assert!(!stale.exists());
    assert!(unrelated.exists());
}

#[test]
fn open_time_cleanup_removes_only_writer_owned_stale_temps() {
    let (dir, project) = project_path();
    let stale = dir.path().join(".project.easl.atomic-abandoned.tmp");
    let unrelated = dir.path().join(".other.easl.atomic-abandoned.tmp");
    fs::write(&stale, b"stale").unwrap();
    fs::write(&unrelated, b"keep").unwrap();

    cleanup_project_temps_for_state(&crate::app::state::AppState::default(), &project).unwrap();

    assert!(!stale.exists());
    assert!(unrelated.exists());
}

use crate::app::state::AppState;
use crate::import::ImportLifecycle;
use crate::processing::{ProcessingLifecycle, ProcessingRun};
use crate::project::{config, model::*, validation};
use std::fs;

#[test]
fn rename_changes_only_display_name_during_work_and_survives_save_and_reopen() {
    for source in [DataSource::Dicom, DataSource::Bids] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.easl");
        let state = AppState::default();
        let mut document = config::defaults("Original".into(), source, "profile".into()).unwrap();
        document.data_par.Quality = Some(1.try_into().unwrap());
        document.ui_state.processing = Some(ProcessingUiState {
            structural: Some(ModuleResult {
                completed: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        });
        let reviewer = document.ui_state.manifest.active_reviewer_id.clone();
        document
            .ui_state
            .manifest
            .verdicts
            .get_mut(&reviewer)
            .unwrap()
            .insert(
                "sub-01_01".into(),
                Verdict {
                    status: VerdictStatus::Pass,
                    reason: None,
                    notes: Some("Reviewed".into()),
                    set_at: 1,
                },
            );
        fs::write(&path, config::serialize(&document).unwrap()).unwrap();
        let data = directory.path().join("source.nii");
        let description = directory.path().join("dataset_description.json");
        fs::write(&data, b"unchanged image").unwrap();
        fs::write(&description, br#"{"Name":"Dataset name"}"#).unwrap();
        let candidate =
            config::inspect_for_state(&state, path.display().to_string(), vec![]).unwrap();
        let opened = config::activate_for_state(&state, candidate.candidate_id, false).unwrap();
        if source == DataSource::Dicom {
            let mut run = state.import_state.lock().unwrap();
            run.run_id = "import-rename".into();
            run.lifecycle = ImportLifecycle::Running;
            run.project_root = directory.path().to_path_buf();
        } else {
            let mut run = ProcessingRun::new(
                "processing-rename".into(),
                directory.path().to_path_buf(),
                vec!["asl".into()],
                vec!["sub-01_01".into()],
            );
            run.lifecycle = ProcessingLifecycle::Running;
            state.processing_state.lock().unwrap().current_run = Some(run);
        }
        let renamed = config::edit_for_state(
            &state,
            opened.activation_generation,
            ProjectEdit::RenameProject {
                name: "  Étude – ASL / 2026 🧠  ".into(),
            },
        )
        .unwrap();
        let mut expected = opened.document.clone();
        expected.project_meta.name = "Étude – ASL / 2026 🧠".into();
        assert_eq!(
            renamed.document, expected,
            "rename preserves every non-name field"
        );
        assert_eq!(renamed.root_path, opened.root_path);
        assert_eq!(renamed.activation_generation, opened.activation_generation);
        assert_eq!(renamed.accepted_revision, opened.accepted_revision + 1);
        assert_eq!(
            validation::parse_document(&fs::read(&path).unwrap()).unwrap(),
            opened.document,
            "acceptance does not save early"
        );
        if source == DataSource::Dicom {
            let run = state.import_state.lock().unwrap();
            assert_eq!(run.lifecycle, ImportLifecycle::Running);
            assert_eq!(run.run_id, "import-rename");
        } else {
            let run = state.processing_state.lock().unwrap();
            assert_eq!(
                run.current_run.as_ref().unwrap().lifecycle,
                ProcessingLifecycle::Running
            );
            assert_eq!(
                run.current_run.as_ref().unwrap().run_id,
                "processing-rename"
            );
        }
        config::invalidate_population_for_state(&state, directory.path()).unwrap();
        expected.ui_state.processing.as_mut().unwrap().population = Some(ModuleResult {
            completed: Some(false),
            ..Default::default()
        });
        let saved = config::save_for_state(&state, opened.activation_generation).unwrap();
        assert_eq!(saved.accepted_revision, saved.persisted_revision);
        assert_eq!(
            validation::parse_document(&fs::read(&path).unwrap()).unwrap(),
            expected
        );
        assert_eq!(fs::read(&data).unwrap(), b"unchanged image");
        assert_eq!(
            fs::read(&description).unwrap(),
            br#"{"Name":"Dataset name"}"#
        );
        assert_eq!(
            validation::parse_document(&fs::read(path.with_extension("easl.bak")).unwrap())
                .unwrap(),
            opened.document
        );
        *state.import_state.lock().unwrap() = Default::default();
        state.processing_state.lock().unwrap().current_run = None;
        let candidate =
            config::inspect_for_state(&state, path.display().to_string(), vec![]).unwrap();
        let reopened = config::activate_for_state(&state, candidate.candidate_id, false).unwrap();
        assert_eq!(reopened.document, expected);
        assert!(
            config::edit_for_state(
                &state,
                opened.activation_generation,
                ProjectEdit::RenameProject {
                    name: "Expired".into()
                }
            )
            .is_err()
        );
        assert_eq!(
            config::snapshot_for_state(&state, reopened.activation_generation)
                .unwrap()
                .document,
            expected
        );
    }
}

#[test]
fn rename_validates_native_submissions_preserves_legacy_names_and_ignores_noops() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("project.easl");
    let state = AppState::default();
    let document =
        config::defaults("Legacy\nname".into(), DataSource::Dicom, "profile".into()).unwrap();
    fs::write(&path, config::serialize(&document).unwrap()).unwrap();
    let candidate = config::inspect_for_state(&state, path.display().to_string(), vec![]).unwrap();
    let opened = config::activate_for_state(&state, candidate.candidate_id, false).unwrap();
    let before = config::snapshot_for_state(&state, opened.activation_generation).unwrap();
    let disk = fs::read(&path).unwrap();
    for name in [
        "",
        "   ",
        "\nNew",
        "New\r",
        "New\tname",
        "Bad\0name",
        "Bad\u{7f}name",
        "Bad\u{85}name",
        "Bad\u{2028}name",
        "Bad\u{2029}name",
    ] {
        assert!(
            config::edit_for_state(
                &state,
                opened.activation_generation,
                ProjectEdit::RenameProject { name: name.into() }
            )
            .is_err(),
            "must reject {name:?}"
        );
        assert_eq!(
            config::snapshot_for_state(&state, opened.activation_generation).unwrap(),
            before
        );
        assert_eq!(fs::read(&path).unwrap(), disk);
        assert!(!path.with_extension("easl.bak").exists());
    }
    let accepted = config::edit_for_state(
        &state,
        opened.activation_generation,
        ProjectEdit::RenameProject {
            name: "  Corrected  ".into(),
        },
    )
    .unwrap();
    let saved = config::save_for_state(&state, opened.activation_generation).unwrap();
    assert_eq!(accepted.document.project_meta.name, "Corrected");
    let disk = fs::read(&path).unwrap();
    let backup = fs::read(path.with_extension("easl.bak")).unwrap();
    for name in ["Corrected", "  Corrected  "] {
        assert_eq!(
            config::edit_for_state(
                &state,
                opened.activation_generation,
                ProjectEdit::RenameProject { name: name.into() }
            )
            .unwrap(),
            saved
        );
        config::save_for_state(&state, opened.activation_generation).unwrap();
        assert_eq!(fs::read(&path).unwrap(), disk);
        assert_eq!(fs::read(path.with_extension("easl.bak")).unwrap(), backup);
    }
}

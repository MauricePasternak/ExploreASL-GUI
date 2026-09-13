//! Byte fixtures ported from src/lib/participantsUtils.test.ts.
use crate::processing::{SubjectInfo, participants::merge, record::*};

fn fixture() -> (Vec<String>, Vec<SubjectInfo>, ParticipantInputs) {
    let selected = vec!["sub-001Philips_01".into(), "sub-002Siemens_02".into()];
    let inventory = vec![
        SubjectInfo {
            subject_session: "sub-001Philips_01".into(),
            subject: "001Philips".into(),
            session: "01".into(),
            has_structural: true,
            has_asl: true,
            asl_runs: vec!["01".into(), "ASL_002".into()],
        },
        SubjectInfo {
            subject_session: "sub-002Siemens_02".into(),
            subject: "002Siemens".into(),
            session: "02".into(),
            has_structural: true,
            has_asl: true,
            asl_runs: vec![],
        },
    ];
    let inputs = ParticipantInputs {
        correction: true,
        subject_rows: vec![
            ParticipantRow {
                subject: "001Philips".into(),
                session: "01".into(),
                group_id: Some("group-philips".into()),
            },
            ParticipantRow {
                subject: "002Siemens".into(),
                session: "02".into(),
                group_id: Some("global-defaults".into()),
            },
        ],
        metadata_groups: vec![ParticipantGroup {
            id: "group-philips".into(),
            label: " Philips  Override ".into(),
        }],
    };
    (selected, inventory, inputs)
}

#[test]
fn participant_creation_and_exact_merge_preserve_ported_bytes() {
    let (selected, inventory, inputs) = fixture();
    let created = merge(&selected, &inventory, &inputs, None, None, None);
    assert_eq!(
        created.tsv.as_deref(),
        Some(
            "participant_id\tsession\tsite\nsub-001Philips_01\tASL_1\tPhilips_Override\nsub-001Philips_01\tASL_2\tPhilips_Override\nsub-002Siemens_02\tASL_1\tGlobal_Defaults\n"
        )
    );
    let merged = merge(
        &selected,
        &inventory,
        &inputs,
        None,
        Some(
            "participant_id\tsession\tGM_vol\tWM_vol\nsub-002Siemens_02\tASL_1\t0.67894\t0.5418\nsub-001Philips_01\tASL_1\t0.63988\t0.48649\n",
        ),
        Some(
            r#"{"participant_id":{"Description":"custom id desc"},"custom_column":{"Description":"a custom measurement"}}"#,
        ),
    );
    assert_eq!(
        merged.tsv.as_deref(),
        Some(
            "participant_id\tsession\tsite\tGM_vol\tWM_vol\nsub-001Philips_01\tASL_1\tPhilips_Override\t0.63988\t0.48649\nsub-001Philips_01\tASL_2\tPhilips_Override\t\t\nsub-002Siemens_02\tASL_1\tGlobal_Defaults\t0.67894\t0.5418\n"
        )
    );
    let json: serde_json::Value = serde_json::from_str(merged.json.as_ref().unwrap()).unwrap();
    assert_eq!(json["participant_id"]["Description"], "custom id desc");
    assert_eq!(json["custom_column"]["Description"], "a custom measurement");
    assert_eq!(json["site"]["Description"], "Site identifier");
    assert_eq!(json["gm_vol"]["Units"], "liter");
}

#[test]
fn root_site_and_base_rows_win_even_with_correction_disabled() {
    let (mut selected, mut inventory, mut inputs) = fixture();
    inputs.correction = false;
    selected.push("sub-001Philips_03".into());
    inventory.push(SubjectInfo {
        subject_session: "sub-001Philips_03".into(),
        subject: "001Philips".into(),
        session: "03".into(),
        has_structural: false,
        has_asl: true,
        asl_runs: vec!["invalid".into()],
    });
    let root = "\u{feff}participant_id\tsite\tAge\tGender\nsub-001Philips\tCenter A\t21\tF\nsub-unselected\tOther\t30\tM\n";
    let output = merge(&selected, &inventory, &inputs, Some(root), None, None);
    assert_eq!(
        output.tsv.as_deref(),
        Some(
            "participant_id\tsession\tsite\tAge\tGender\nsub-001Philips_01\tASL_1\tCenter A\t21\tF\nsub-001Philips_01\tASL_2\tCenter A\t21\tF\nsub-001Philips_03\tASL_1\tCenter A\t21\tF\nsub-002Siemens_02\tASL_1\tGlobal_Defaults\t\t\nsub-unselected\t\tOther\t30\tM\n"
        )
    );
}

#[test]
fn disabled_correction_strips_only_existing_derivative_site() {
    let (selected, inventory, mut inputs) = fixture();
    inputs.correction = false;
    let empty = merge(
        &selected,
        &inventory,
        &inputs,
        Some("participant_id\tage\nsub-001Philips\t21\n"),
        None,
        None,
    );
    assert!(empty.tsv.is_none() && empty.json.is_none());
    let stripped = merge(
        &selected,
        &inventory,
        &inputs,
        None,
        Some("participant_id\tsession\tsite\tGM_vol\nsub-001Philips_01\tASL_1\told\t0.5\n"),
        Some(r#"{"site":{},"custom":42}"#),
    );
    assert_eq!(
        stripped.tsv.as_deref(),
        Some("participant_id\tsession\tGM_vol\nsub-001Philips_01\tASL_1\t0.5\n")
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(stripped.json.as_ref().unwrap()).unwrap(),
        serde_json::json!({"custom":42})
    );
}

//! Derivative participant artifacts; root participant files are read-only inputs.
use super::{record::ParticipantInputs, types::SubjectInfo};

#[derive(Default, Debug)]
pub(crate) struct Artifacts {
    pub tsv: Option<String>,
    pub json: Option<String>,
}

type Row = std::collections::BTreeMap<String, String>;
fn lines(input: &str) -> Vec<&str> {
    input
        .trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect()
}
fn table(input: Option<&str>) -> (Vec<String>, Vec<Row>) {
    let lines = lines(input.unwrap_or_default());
    let Some(header) = lines.first() else {
        return Default::default();
    };
    let headers: Vec<String> = header.split('\t').map(|s| s.trim().to_string()).collect();
    let rows = lines
        .iter()
        .skip(1)
        .map(|line| {
            let values: Vec<_> = line.split('\t').collect();
            headers
                .iter()
                .enumerate()
                .map(|(i, h)| (h.clone(), values.get(i).unwrap_or(&"").trim().to_string()))
                .collect()
        })
        .collect();
    (headers, rows)
}
fn cell<'a>(row: &'a Row, column: &str) -> &'a str {
    row.get(column).map(String::as_str).unwrap_or_default()
}
fn base(id: &str) -> &str {
    id.rsplit_once('_').map(|(base, _)| base).unwrap_or(id)
}
fn serialize_table(headers: &[String], rows: &[Row]) -> String {
    let mut lines = vec![headers.join("\t")];
    lines.extend(rows.iter().map(|row| {
        headers
            .iter()
            .map(|h| cell(row, h))
            .collect::<Vec<_>>()
            .join("\t")
    }));
    lines.join("\n") + "\n"
}

pub(crate) fn merge(
    selected: &[String],
    inventory: &[SubjectInfo],
    inputs: &ParticipantInputs,
    root_tsv: Option<&str>,
    derivative_tsv: Option<&str>,
    derivative_json: Option<&str>,
) -> Artifacts {
    let (_, root_rows) = table(root_tsv);
    let mut sites = std::collections::BTreeMap::new();
    for row in &root_rows {
        if !cell(row, "participant_id").is_empty() && !cell(row, "site").is_empty() {
            sites.insert(cell(row, "participant_id"), cell(row, "site"));
        }
    }
    if !inputs.correction && sites.is_empty() {
        let mut result = Artifacts::default();
        if let Some(input) = derivative_tsv {
            let lines = lines(input);
            if let Some(header) = lines.first() {
                let mut headers: Vec<_> = header.split('\t').map(str::trim).collect();
                if let Some(index) = headers.iter().position(|h| *h == "site") {
                    headers.remove(index);
                    let mut output = vec![headers.join("\t")];
                    for line in lines.iter().skip(1) {
                        let mut cols: Vec<_> = line.split('\t').collect();
                        if index < cols.len() {
                            cols.remove(index);
                        }
                        output.push(cols.join("\t"));
                    }
                    result.tsv = Some(output.join("\n") + "\n");
                }
            }
        }
        if let Some(mut json) =
            derivative_json.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            && let Some(object) = json.as_object_mut()
            && object.remove("site").is_some()
        {
            result.json = serde_json::to_string_pretty(&json).ok();
        }
        return result;
    }
    let (headers, existing) = table(derivative_tsv.or(root_tsv));
    let mut targets = Vec::<Row>::new();
    for id in selected {
        let clean = id.strip_prefix("sub-").unwrap_or(id);
        let (subject, session) = clean.rsplit_once('_').unwrap_or((clean, "01"));
        let site = sites
            .get(base(id))
            .map(|s| (*s).to_string())
            .unwrap_or_else(|| {
                let row = inputs
                    .subject_rows
                    .iter()
                    .find(|r| r.subject == subject && r.session == session);
                row.and_then(|r| r.group_id.as_ref())
                    .map(|group| {
                        inputs
                            .metadata_groups
                            .iter()
                            .find(|g| &g.id == group)
                            .map(|g| g.label.split_whitespace().collect::<Vec<_>>().join("_"))
                            .unwrap_or_else(|| {
                                if group == "global-defaults" {
                                    "Global_Defaults".into()
                                } else {
                                    String::new()
                                }
                            })
                    })
                    .unwrap_or_default()
            });
        let runs = inventory
            .iter()
            .find(|s| &s.subject_session == id)
            .map(|s| s.asl_runs.clone())
            .filter(|r| !r.is_empty())
            .unwrap_or_else(|| vec!["1".into()]);
        for run in runs {
            targets.push(Row::from([
                ("participant_id".into(), id.clone()),
                (
                    "session".into(),
                    format!("ASL_{}", super::utils::normalize_asl_run_id(&run)),
                ),
                ("site".into(), site.clone()),
            ]));
        }
    }
    let mut rows = Vec::new();
    for target in &targets {
        let exact = existing.iter().find(|row| {
            cell(row, "participant_id") == cell(target, "participant_id")
                && cell(row, "session") == cell(target, "session")
        });
        let mut row = exact
            .or_else(|| {
                existing
                    .iter()
                    .find(|row| cell(row, "participant_id") == base(cell(target, "participant_id")))
            })
            .cloned()
            .unwrap_or_default();
        row.extend(target.clone());
        rows.push(row);
    }
    rows.extend(existing.into_iter().filter(|row| {
        !selected
            .iter()
            .any(|id| base(id) == cell(row, "participant_id"))
            && !targets.iter().any(|target| {
                cell(row, "participant_id") == cell(target, "participant_id")
                    && cell(row, "session") == cell(target, "session")
            })
    }));
    rows.sort_by(|a, b| {
        cell(a, "participant_id")
            .cmp(cell(b, "participant_id"))
            .then_with(|| cell(a, "session").cmp(cell(b, "session")))
    });
    let mut final_headers: Vec<String> = ["participant_id", "session", "site"]
        .into_iter()
        .map(str::to_string)
        .collect();
    final_headers.extend(
        headers
            .into_iter()
            .filter(|h| !["participant_id", "session", "site"].contains(&h.as_str())),
    );
    let mut json = defaults();
    if let Some(existing) = derivative_json
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.as_object().cloned())
    {
        json.as_object_mut().unwrap().extend(existing);
    }
    Artifacts {
        tsv: Some(serialize_table(&final_headers, &rows)),
        json: serde_json::to_string_pretty(&json).ok(),
    }
}

fn defaults() -> serde_json::Value {
    serde_json::json!({
        "participant_id": {"Description": "Unique participant identifier, including _session suffix (==visit in ExploreASL legacy)"},
        "session": {"Description": "Unique run identifier (== session in ExploreASL legacy)"},
        "site": {"Description": "Site identifier"},
        "gm_vol": {"Description": "Gray matter volume of the participant at this visit", "Units": "liter"},
        "wm_vol": {"Description": "White matter volume of the participant at this visit", "Units": "liter"},
        "csf_vol": {"Description": "Cerebrospinal fluid volume of the participant at this visit", "Units": "liter"},
        "gm_icv_ratio": {"Description": "Ratio of gray matter volume to the intracranial volume of the participant at this visit, proxy of gray matter atrophy", "Units": "ratio"},
        "gmwm_icv_ratio": {"Description": "Ratio of parenchymal volume (gray matter + WM volume) to the intracranial volume of the participant at this visit, proxy of wholebrain atrophy", "Units": "ratio"},
        "motion": {"Description": "Mean net displacement vector difference (head motion) of this ASL scan", "Units": "mm RMS"}
    })
}

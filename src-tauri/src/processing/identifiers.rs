//! ExploreASL module names and ASL run identifiers used by processing.
//!
//! GUI/BIDS Run = ExploreASL Session. GUI/BIDS Session = ExploreASL Visit.

pub fn module_index_to_name(index: usize) -> &'static str {
    match index {
        0 => "xASL_module_Structural",
        1 => "xASL_module_ASL",
        2 => "xASL_module_Population",
        _ => panic!("Invalid module index: {}", index),
    }
}

pub fn normalize_asl_run_id(raw: &str) -> String {
    let s = raw.trim();
    let s = s
        .strip_prefix("ASL_")
        .or_else(|| s.strip_prefix("asl_"))
        .unwrap_or(s);
    if s.is_empty() {
        return "1".to_string();
    }
    match s.parse::<u32>() {
        Ok(n) if n >= 1 => n.to_string(),
        _ => "1".to_string(),
    }
}

pub fn normalize_asl_run_id_opt(raw: Option<&str>) -> String {
    match raw {
        Some(s) => normalize_asl_run_id(s),
        None => "1".to_string(),
    }
}

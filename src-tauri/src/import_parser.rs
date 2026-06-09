/**
 * MATLAB stdout parser for the ExploreASL import pipeline.
 *
 * Converts raw MATLAB stdout lines into typed [`ImportStructuredEvent`]s that
 * the Tauri frontend consumes. The parser is deliberately stateful: ExploreASL
 * emits multi-line error blocks and the parser must accumulate them before
 * deciding what happened to a subject.
 *
 * # Handled patterns
 *
 * | Pattern | Action |
 * |---------|--------|
 * | `Subject: <name>, Module:` | SubjectStart (DCM2NII step) |
 * | `DICOM to NIFTI CONVERSION` | marks current step DCM2NII |
 * | `NIFTI to BIDS CONVERSION` | marks current step NII2BIDS + emits SubjectStart |
 * | `NII2BIDS failed for <description>` | begins PendingFailure accumulation |
 * | `DCM2NII failed for <description>` | begins PendingFailure accumulation |
 * | `Message: <detail>` | appends to PendingFailure message |
 * | `ERROR: Import module terminated for subject N: <name>` | begins PendingModuleError accumulation |
 * | MATLAB `ans = '...'` error block | accumulated into PendingModuleError |
 * | `Job-iteration N stopped at … and took N seconds` | SubjectComplete (unless subject failed) |
 * | `xASL_module_Import completed 100%` | ImportComplete |
 * | `status: <N>` | Dcm2NiiStatus |
 */
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

// =============================================================================
// Regex constants
// =============================================================================

pub const SUBJECT_START_RE: &str = r"Subject: ([A-Za-z0-9_-]+), Module:";
pub const JOB_ITERATION_RE: &str = r"Job-iteration (\d+) stopped at .+ and took (\d+) seconds";
pub const NII2BIDS_FAILED_RE: &str = r"NII2BIDS failed for (.+)";
pub const DCM2NII_FAILED_RE: &str = r"DCM2NII failed for (.+)";
pub const IMPORT_COMPLETE_RE: &str = r"xASL_module_Import completed 100%";
pub const STATUS_CODE_RE: &str = r"status: (-?\d+)";
pub const MESSAGE_LINE_RE: &str = r"Message:\s*(.*)";
pub const PROGRESS_BAR_RE: &str = r"^[\d%\s]+$";
/// Matches the ExploreASL error line emitted when a subject's import iteration
/// fails unexpectedly (e.g. a bug in the pipeline or a broken sourcestructure).
///
/// Example: `ERROR: Import module terminated for subject 1: C9ORF007Philips`
///
/// Capture group 1 is the raw subject name as printed by ExploreASL.
pub const MODULE_TERMINATED_RE: &str =
    r"ERROR: Import module terminated for subject \d+: ([A-Za-z0-9_-]+)";

// =============================================================================
// Regex accessors (compiled once via OnceLock)
// =============================================================================

pub fn subject_start_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(SUBJECT_START_RE).expect("subject start regex should compile"))
}

pub fn job_iteration_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(JOB_ITERATION_RE).expect("job iteration regex should compile"))
}

pub fn nii2bids_failed_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(NII2BIDS_FAILED_RE).expect("NII2BIDS failure regex should compile")
    })
}

pub fn dcm2nii_failed_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(DCM2NII_FAILED_RE).expect("DCM2NII failure regex should compile"))
}

pub fn import_complete_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(IMPORT_COMPLETE_RE).expect("import complete regex should compile"))
}

pub fn status_code_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(STATUS_CODE_RE).expect("status code regex should compile"))
}

pub fn message_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(MESSAGE_LINE_RE).expect("message line regex should compile"))
}

pub fn progress_bar_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(PROGRESS_BAR_RE).expect("progress bar regex should compile"))
}

pub fn module_terminated_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(MODULE_TERMINATED_RE).expect("module terminated regex should compile")
    })
}

// =============================================================================
// Event types
// =============================================================================

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImportStructuredEvent {
    SubjectStart {
        subject: String,
        step: String,
    },
    SubjectComplete {
        subject: String,
        duration_secs: u64,
    },
    ImportFailed {
        subject: String,
        step: String,
        message: String,
    },
    ImportComplete,
    Dcm2NiiStatus {
        subject: String,
        exit_code: i32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportRawEvent {
    pub line: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportOutputLineSource {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportOutputLine {
    pub source: ImportOutputLineSource,
    pub line: String,
}

impl ImportOutputLine {
    pub fn stdout(line: impl Into<String>) -> Self {
        Self {
            source: ImportOutputLineSource::Stdout,
            line: line.into(),
        }
    }

    pub fn stderr(line: impl Into<String>) -> Self {
        Self {
            source: ImportOutputLineSource::Stderr,
            line: line.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedImportStream {
    pub raw_events: Vec<ImportRawEvent>,
    pub structured_events: Vec<ImportStructuredEvent>,
}

// =============================================================================
// Internal accumulator types
// =============================================================================

/// Accumulates a `NII2BIDS failed` / `DCM2NII failed` error and its optional
/// subsequent `Message:` detail lines before being flushed as `ImportFailed`.
#[derive(Debug)]
struct PendingFailure {
    subject: String,
    step: String,
    message: String,
}

/// Accumulates the lines of an `ERROR: Import module terminated` block.
///
/// ExploreASL emits a multi-line MATLAB error dump after the trigger line:
/// ```text
/// ERROR: Import module terminated for subject 1: SubjectName
///
/// ans =
///
///     'Error using SomeFunction
///      Detail of the error here.
///
///      Error in ExploreASL (line 94)
///              ExploreASL_Import(x);'
///
///
/// CONT: but continue with next iteration!
/// ```
/// Lines in the `ans = '...'` block are accumulated until a structural line
/// (next subject header, job-iteration, another ERROR, etc.) flushes the block.
#[derive(Debug)]
struct PendingModuleError {
    subject: String,
    step: String,
    /// Raw content lines collected from the MATLAB error block.
    lines: Vec<String>,
}

// =============================================================================
// Parser
// =============================================================================

#[derive(Debug)]
pub struct ImportOutputParser {
    subject_list: Vec<String>,
    current_subject: Option<String>,
    pending_failures: Vec<PendingFailure>,
    pending_module_error: Option<PendingModuleError>,
    failed_subjects: std::collections::HashSet<String>,
    current_step: String,
}

impl ImportOutputParser {
    pub fn new(subject_list: &[String]) -> Self {
        Self {
            subject_list: subject_list.to_vec(),
            current_subject: None,
            pending_failures: Vec::new(),
            pending_module_error: None,
            failed_subjects: std::collections::HashSet::new(),
            current_step: "DCM2NII".to_string(),
        }
    }

    pub fn push_line(
        &mut self,
        line: &str,
        source: ImportOutputLineSource,
    ) -> Vec<ImportStructuredEvent> {
        // ── Priority 1: module-terminated accumulation ──────────────────────
        // Must be checked before the pending_failures block because a new
        // ERROR line should flush any lingering pending_failures first.
        if self.pending_module_error.is_some() {
            return self.handle_pending_module_error_line(line, source);
        }

        // ── Priority 2: NII2BIDS/DCM2NII failed accumulation ────────────────
        if !self.pending_failures.is_empty() {
            if let Some(captures) = message_line_re().captures(line) {
                let detail = captures
                    .get(1)
                    .map(|value| value.as_str().trim())
                    .unwrap_or_default();
                for failure in &mut self.pending_failures {
                    if !detail.is_empty() {
                        failure.message.push('\n');
                        failure.message.push_str(detail);
                    }
                }
                return Vec::new();
            }

            let mut events = self.flush_pending_failures();
            if line.trim().is_empty() {
                return events;
            }
            events.extend(self.parse_non_message_line(line, source));
            return events;
        }

        self.parse_non_message_line(line, source)
    }

    pub fn finish(&mut self) -> Vec<ImportStructuredEvent> {
        let mut events = self.flush_pending_module_error();
        events.extend(self.flush_pending_failures());
        events
    }

    // ── Module-terminated accumulation ──────────────────────────────────────

    /// Handle a line while [`PendingModuleError`] is active.
    ///
    /// Lines are classified into three categories:
    /// - **Flush triggers** – structural output that signals the error block is
    ///   over (next subject, job-iteration, import-complete, another ERROR, or a
    ///   known-failure prefix). These flush the pending error and then re-parse
    ///   the triggering line.
    /// - **Skip lines** – noise from MATLAB's variable display (`ans =`) and the
    ///   ExploreASL continuation marker (`CONT:`). Discarded without accumulation.
    /// - **Content lines** – all other non-empty lines. Appended to
    ///   `pending_module_error.lines` to form the final error message.
    fn handle_pending_module_error_line(
        &mut self,
        line: &str,
        source: ImportOutputLineSource,
    ) -> Vec<ImportStructuredEvent> {
        // Flush triggers: structural lines that end the error block.
        let is_flush_trigger = subject_start_re().is_match(line)
            || job_iteration_re().is_match(line)
            || import_complete_re().is_match(line)
            || module_terminated_re().is_match(line)
            || nii2bids_failed_re().is_match(line)
            || dcm2nii_failed_re().is_match(line);

        if is_flush_trigger {
            let mut events = self.flush_pending_module_error();
            events.extend(self.parse_non_message_line(line, source));
            return events;
        }

        let trimmed = line.trim();

        // Skip MATLAB variable display (`ans =`) and ExploreASL continuation marker.
        let is_skip_line = trimmed.is_empty()
            || trimmed.starts_with("ans =")
            || trimmed == "ans"
            || trimmed.starts_with("CONT:");

        if !is_skip_line {
            if let Some(ref mut pending) = self.pending_module_error {
                pending.lines.push(line.to_string());
            }
        }

        Vec::new()
    }

    fn flush_pending_module_error(&mut self) -> Vec<ImportStructuredEvent> {
        let pending = match self.pending_module_error.take() {
            Some(p) => p,
            None => return Vec::new(),
        };

        let message = build_module_terminated_message(&pending.lines);

        vec![ImportStructuredEvent::ImportFailed {
            subject: pending.subject,
            step: pending.step,
            message,
        }]
    }

    // ── NII2BIDS/DCM2NII failed accumulation ────────────────────────────────

    fn set_pending_failures(
        &mut self,
        step: &str,
        description: Option<regex::Match<'_>>,
        fallback_message: &str,
    ) {
        let description = description
            .map(|value| value.as_str())
            .unwrap_or(fallback_message);

        let mut pending = Vec::new();
        for subject in &self.subject_list {
            if description.contains(subject.as_str()) {
                self.failed_subjects.insert(subject.clone());
                pending.push(PendingFailure {
                    subject: subject.clone(),
                    step: step.to_string(),
                    message: fallback_message.to_string(),
                });
            }
        }
        self.pending_failures = pending;
    }

    fn flush_pending_failures(&mut self) -> Vec<ImportStructuredEvent> {
        self.pending_failures
            .drain(..)
            .map(|failure| ImportStructuredEvent::ImportFailed {
                subject: failure.subject,
                step: failure.step,
                message: failure.message,
            })
            .collect()
    }

    // ── Main per-line dispatch ───────────────────────────────────────────────

    fn parse_non_message_line(
        &mut self,
        line: &str,
        source: ImportOutputLineSource,
    ) -> Vec<ImportStructuredEvent> {
        if source == ImportOutputLineSource::Stdout {
            if line.contains("DICOM to NIFTI CONVERSION") {
                self.current_step = "DCM2NII".to_string();
            } else if line.contains("NIFTI to BIDS CONVERSION") {
                self.current_step = "NII2BIDS".to_string();
                if let Some(ref subject) = self.current_subject {
                    return vec![ImportStructuredEvent::SubjectStart {
                        subject: subject.clone(),
                        step: self.current_step.clone(),
                    }];
                }
            }

            if let Some(captures) = subject_start_re().captures(line) {
                if let Some(subject) = captures.get(1).map(|value| value.as_str().to_string()) {
                    self.current_subject = Some(subject.clone());
                    self.current_step = "DCM2NII".to_string();
                    return vec![ImportStructuredEvent::SubjectStart {
                        subject,
                        step: self.current_step.clone(),
                    }];
                }
            }

            if let Some(captures) = job_iteration_re().captures(line) {
                if let (Some(subject), Some(duration)) = (
                    self.current_subject.clone(),
                    captures
                        .get(2)
                        .and_then(|value| value.as_str().parse::<u64>().ok()),
                ) {
                    if !self.failed_subjects.contains(&subject) {
                        return vec![ImportStructuredEvent::SubjectComplete {
                            subject,
                            duration_secs: duration,
                        }];
                    } else {
                        return Vec::new();
                    }
                }
            }

            if import_complete_re().is_match(line) {
                return vec![ImportStructuredEvent::ImportComplete];
            }

            if let Some(captures) = status_code_re().captures(line) {
                if let (Some(subject), Some(exit_code)) = (
                    self.current_subject.clone(),
                    captures
                        .get(1)
                        .and_then(|value| value.as_str().parse::<i32>().ok()),
                ) {
                    return vec![ImportStructuredEvent::Dcm2NiiStatus { subject, exit_code }];
                }
            }

            // ── New: ERROR: Import module terminated ─────────────────────────
            if let Some(captures) = module_terminated_re().captures(line) {
                let captured_name = captures
                    .get(1)
                    .map(|m| m.as_str())
                    .unwrap_or_default();

                // Match against subject list using the same substring strategy as
                // the NII2BIDS/DCM2NII failure handlers.
                let matched_subjects: Vec<String> = self
                    .subject_list
                    .iter()
                    .filter(|s| captured_name.contains(s.as_str()) || s.as_str().contains(captured_name))
                    .cloned()
                    .collect();

                if !matched_subjects.is_empty() {
                    // Use the first matched subject as the "owner" of this error.
                    // In practice ExploreASL prints one subject per ERROR line.
                    let subject = matched_subjects[0].clone();
                    self.failed_subjects.insert(subject.clone());
                    self.pending_module_error = Some(PendingModuleError {
                        subject,
                        step: self.current_step.clone(),
                        lines: Vec::new(),
                    });
                    return Vec::new();
                }
            }
        }

        if let Some(captures) = nii2bids_failed_re().captures(line) {
            self.set_pending_failures("NII2BIDS", captures.get(1), line);
            return Vec::new();
        }

        if let Some(captures) = dcm2nii_failed_re().captures(line) {
            self.set_pending_failures("DCM2NII", captures.get(1), line);
        }

        Vec::new()
    }
}

// =============================================================================
// Message formatting
// =============================================================================

/// Build a human-readable error message from the raw lines collected from a
/// MATLAB `ans = '...'` error block.
///
/// MATLAB displays string variables surrounded by single quotes, with each
/// line indented. This function:
/// 1. Trims leading/trailing whitespace from every line.
/// 2. Strips the opening `'` from the first non-empty content line.
/// 3. Strips the closing `'` from the last non-empty content line.
/// 4. Drops empty lines that appear at the very start or very end of the block.
/// 5. Falls back to a generic message if nothing meaningful was captured.
fn build_module_terminated_message(lines: &[String]) -> String {
    if lines.is_empty() {
        return "Import module terminated unexpectedly".to_string();
    }

    let mut result: Vec<String> = lines
        .iter()
        .map(|line| line.trim().to_string())
        .collect();

    // Strip the leading ' from the first content line.
    if let Some(first) = result.first_mut() {
        if first.starts_with('\'') {
            *first = first[1..].to_string();
        }
    }

    // Strip the trailing ' from the last content line.
    if let Some(last) = result.last_mut() {
        if last.ends_with('\'') {
            *last = last[..last.len() - 1].to_string();
        }
    }

    // Drop lines that became empty after stripping.
    let trimmed: Vec<String> = result.into_iter().filter(|s| !s.is_empty()).collect();

    if trimmed.is_empty() {
        return "Import module terminated unexpectedly".to_string();
    }

    trimmed.join("\n")
}

// =============================================================================
// Public parsing helpers
// =============================================================================

pub fn parse_import_lines(lines: &[String], subject_list: &[String]) -> Vec<ImportStructuredEvent> {
    let mut parser = ImportOutputParser::new(subject_list);
    let mut events = Vec::new();

    for line in lines {
        events.extend(parser.push_line(line, ImportOutputLineSource::Stdout));
    }
    events.extend(parser.finish());

    events
}

pub fn parse_import_stream_lines(
    lines: &[ImportOutputLine],
    subject_list: &[String],
) -> ParsedImportStream {
    let mut parser = ImportOutputParser::new(subject_list);
    let mut raw_events = Vec::new();
    let mut structured_events = Vec::new();

    for output_line in lines {
        raw_events.push(ImportRawEvent {
            line: output_line.line.clone(),
        });

        structured_events.extend(parser.push_line(&output_line.line, output_line.source));
    }
    structured_events.extend(parser.finish());
    ParsedImportStream {
        raw_events,
        structured_events,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── Existing parser behaviour ────────────────────────────────────────────

    #[test]
    fn parser_emits_subject_start_from_module_line() {
        let events = parse_import_lines(
            &["Subject: BADDIE, Module: xASL_module_Import".to_string()],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![ImportStructuredEvent::SubjectStart {
                subject: "BADDIE".to_string(),
                step: "DCM2NII".to_string(),
            }]
        );
    }

    #[test]
    fn parser_emits_subject_completion_with_duration_for_current_subject() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "BADDIE".to_string(),
                    duration_secs: 42
                },
            ]
        );
    }

    #[test]
    fn parser_emits_import_complete_from_completion_line() {
        let events = parse_import_lines(
            &["xASL_module_Import completed 100%".to_string()],
            &["BADDIE".to_string()],
        );

        assert_eq!(events, vec![ImportStructuredEvent::ImportComplete]);
    }

    #[test]
    fn parser_matches_nii2bids_failure_subject_substring_and_message_lines() {
        let events = parse_import_lines(
            &[
                "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1".to_string(),
                "Message: LabelingDuration has invalid value".to_string(),
                "Message: Check studyPar.json".to_string(),
                "".to_string(),
            ],
            &["BADDIE".to_string(), "GOODIE".to_string()],
        );

        assert_eq!(
            events,
            vec![ImportStructuredEvent::ImportFailed {
                subject: "BADDIE".to_string(),
                step: "NII2BIDS".to_string(),
                message: "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1\nLabelingDuration has invalid value\nCheck studyPar.json".to_string(),
            }]
        );
    }

    #[test]
    fn parser_matches_dcm2nii_failure_subject_substring() {
        let events = parse_import_lines(
            &["DCM2NII failed for source folder BADDIE_ses-01_run-1".to_string()],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![ImportStructuredEvent::ImportFailed {
                subject: "BADDIE".to_string(),
                step: "DCM2NII".to_string(),
                message: "DCM2NII failed for source folder BADDIE_ses-01_run-1".to_string(),
            }]
        );
    }

    #[test]
    fn parser_emits_dcm2nii_status_with_current_subject_context() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "status: 1".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::Dcm2NiiStatus {
                    subject: "BADDIE".to_string(),
                    exit_code: 1
                },
            ]
        );
    }

    #[test]
    fn parser_does_not_emit_subject_completion_if_subject_failed() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1".to_string(),
                "Message: LabelingDuration has invalid value".to_string(),
                "".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert!(events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed { .. })));
        assert!(!events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })));
    }

    #[test]
    fn parser_user_reported_failure() {
        let events = parse_import_lines(
            &[
                "Subject: C9ORF059Siemens, Module: xASL_module_Import".to_string(),
                "[=========================================== CONVERT RUN ======================================]".to_string(),
                "Converting subject C9ORF059Siemens, session 11, run ASL_1, scan sub-C9ORF059Siemens_ses-11_T1w ...".to_string(),
                "scan sub-C9ORF059Siemens_ses-11_T2w ...".to_string(),
                "scan sub-C9ORF059Siemens_ses-11_asl ...".to_string(),
                "Warning: The following user-defined/DICOM fields and DICOM-Phoenix fields differ:  SoftwareVersions PostLabelingDelay BolusCutOffDelayTime".to_string(),
                "".to_string(),
                "[==============================================================================================]".to_string(),
                "NII2BIDS failed for perfusion image of C9ORF059Siemens_ses-11_run-1".to_string(),
                "Message: Unknown value in BIDS fields M0Type".to_string(),
                "xASL_imp_NII2BIDS_Subject_DefineM0Type, line 47...".to_string(),
                "Continuing...".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["C9ORF059Siemens".to_string()],
        );

        assert!(events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
            ref subject,
            ref step,
            ref message,
        } if subject == "C9ORF059Siemens" && step == "NII2BIDS" && message.contains("Unknown value in BIDS fields M0Type"))));
        assert!(!events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })));
    }

    #[test]
    fn parser_detects_step_transitions_and_updates_subject_start_step() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 10 seconds".to_string(),
                "Subject: GOODIE, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "Job-iteration 2 stopped at 12:35:56 and took 15 seconds".to_string(),
            ],
            &["BADDIE".to_string(), "GOODIE".to_string()],
        );

        assert_eq!(
            events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "NII2BIDS".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "BADDIE".to_string(),
                    duration_secs: 10
                },
                ImportStructuredEvent::SubjectStart {
                    subject: "GOODIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectStart {
                    subject: "GOODIE".to_string(),
                    step: "NII2BIDS".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "GOODIE".to_string(),
                    duration_secs: 15
                },
            ]
        );
    }

    #[test]
    fn stream_parser_logs_stderr_without_mutating_stdout_parser_state() {
        let parsed = parse_import_stream_lines(
            &[
                ImportOutputLine::stderr("Subject: NOISY, Module: xASL_module_Import"),
                ImportOutputLine::stdout("Subject: BADDIE, Module: xASL_module_Import"),
                ImportOutputLine::stderr(
                    "Job-iteration 99 stopped at 12:34:56 and took 999 seconds",
                ),
                ImportOutputLine::stdout("Job-iteration 1 stopped at 12:35:56 and took 42 seconds"),
            ],
            &["BADDIE".to_string(), "NOISY".to_string()],
        );

        assert_eq!(
            parsed
                .raw_events
                .iter()
                .map(|event| event.line.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Subject: NOISY, Module: xASL_module_Import",
                "Subject: BADDIE, Module: xASL_module_Import",
                "Job-iteration 99 stopped at 12:34:56 and took 999 seconds",
                "Job-iteration 1 stopped at 12:35:56 and took 42 seconds",
            ]
        );
        assert_eq!(
            parsed.structured_events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "BADDIE".to_string(),
                    duration_secs: 42
                },
            ]
        );
    }

    #[test]
    fn import_output_line_constructors_tag_stream_source() {
        assert_eq!(
            ImportOutputLine::stdout("ready").source,
            ImportOutputLineSource::Stdout
        );
        assert_eq!(
            ImportOutputLine::stderr("warning").source,
            ImportOutputLineSource::Stderr
        );
    }

    // ── New: ERROR: Import module terminated ─────────────────────────────────

    /// Full realistic scenario matching the stdout the user reported:
    ///   ERROR line → empty line → `ans =` → empty line → MATLAB error block
    ///   → empty lines → CONT line → empty line → Job-iteration
    ///
    /// Expected: subject is `failed` (not `completed`), message contains error
    /// detail, `ImportComplete` fires at the end.
    #[test]
    fn parser_module_terminated_marks_subject_failed_not_completed() {
        let events = parse_import_lines(
            &[
                "Subject: C9ORF007Philips, Module: xASL_module_Import".to_string(),
                "==================================== NIFTI to BIDS CONVERSION ================================".to_string(),
                "ERROR: Import module terminated for subject 1: C9ORF007Philips".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using xASL_wrp_NII2BIDS_Subject>xASL_imp_CheckForAliasInSession".to_string(),
                "     Session name cannot be identified for a subject_session C9ORF007Philips_01".to_string(),
                "     ".to_string(),
                "     Error in ExploreASL (line 94)".to_string(),
                "             ExploreASL_Import(x);'".to_string(),
                "".to_string(),
                "".to_string(),
                "CONT: but continue with next iteration!   ".to_string(),
                "".to_string(),
                "Job-iteration 1 stopped at 09-Jun-2026 16:52:53 and took 24 seconds".to_string(),
                "xASL_module_Import completed 100%".to_string(),
            ],
            &["C9ORF007Philips".to_string()],
        );

        // Subject must be marked failed with step = NII2BIDS (current step when ERROR fires)
        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject,
                ref step,
                ref message,
            } if subject == "C9ORF007Philips"
                && step == "NII2BIDS"
                && message.contains("Session name cannot be identified"))),
            "Expected ImportFailed with error detail, got: {events:?}"
        );

        // Must NOT also emit SubjectComplete for the failed subject
        assert!(
            !events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete {
                ref subject, ..
            } if subject == "C9ORF007Philips")),
            "SubjectComplete must not fire for a module-terminated subject"
        );

        // Overall completion marker must still fire
        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportComplete)),
            "ImportComplete must still be emitted"
        );
    }

    /// Two consecutive subjects both fail via module terminated.
    /// Each must produce its own ImportFailed; neither produces SubjectComplete.
    #[test]
    fn parser_module_terminated_handles_two_consecutive_failed_subjects() {
        let events = parse_import_lines(
            &[
                // Subject 1
                "Subject: C9ORF007Philips, Module: xASL_module_Import".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 1: C9ORF007Philips".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using SomeFn".to_string(),
                "     Detail for subject 1.'".to_string(),
                "".to_string(),
                "CONT: but continue with next iteration!".to_string(),
                "Job-iteration 1 stopped at 09-Jun-2026 16:52:53 and took 24 seconds".to_string(),
                // Subject 2
                "Subject: C9ORF059Siemens, Module: xASL_module_Import".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 2: C9ORF059Siemens".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using SomeFn".to_string(),
                "     Detail for subject 2.'".to_string(),
                "".to_string(),
                "CONT: but continue with next iteration!".to_string(),
                "Job-iteration 2 stopped at 09-Jun-2026 16:53:21 and took 28 seconds".to_string(),
                "xASL_module_Import completed 100%".to_string(),
            ],
            &["C9ORF007Philips".to_string(), "C9ORF059Siemens".to_string()],
        );

        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject, ..
            } if subject == "C9ORF007Philips")),
            "C9ORF007Philips must be marked failed"
        );
        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject, ..
            } if subject == "C9ORF059Siemens")),
            "C9ORF059Siemens must be marked failed"
        );
        assert!(
            !events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })),
            "No SubjectComplete must be emitted"
        );
        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportComplete))
        );
    }

    /// First subject fails via module terminated, second succeeds normally.
    /// The second subject's SubjectComplete must not be suppressed.
    #[test]
    fn parser_module_terminated_first_fails_second_succeeds() {
        let events = parse_import_lines(
            &[
                // Subject 1 – fails
                "Subject: C9ORF007Philips, Module: xASL_module_Import".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 1: C9ORF007Philips".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using SomeFn".to_string(),
                "     Bad session name.'".to_string(),
                "".to_string(),
                "CONT: but continue with next iteration!".to_string(),
                "Job-iteration 1 stopped at 09-Jun-2026 16:52:53 and took 24 seconds".to_string(),
                // Subject 2 – succeeds
                "Subject: C9ORF059Siemens, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "Job-iteration 2 stopped at 09-Jun-2026 16:53:21 and took 28 seconds".to_string(),
                "xASL_module_Import completed 100%".to_string(),
            ],
            &["C9ORF007Philips".to_string(), "C9ORF059Siemens".to_string()],
        );

        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject, ..
            } if subject == "C9ORF007Philips"))
        );
        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete {
                ref subject, ..
            } if subject == "C9ORF059Siemens")),
            "C9ORF059Siemens must still complete successfully"
        );
        assert!(
            !events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete {
                ref subject, ..
            } if subject == "C9ORF007Philips")),
            "C9ORF007Philips must not produce SubjectComplete"
        );
    }

    /// The ERROR line fires after the NII2BIDS header, so `current_step` should
    /// be `NII2BIDS` at that point. The ImportFailed event must reflect that.
    #[test]
    fn parser_module_terminated_during_nii2bids_records_correct_step() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 1: BADDIE".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Something went wrong.'".to_string(),
                "".to_string(),
                "CONT: continue".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 10 seconds".to_string(),
                "xASL_module_Import completed 100%".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject,
                ref step,
                ..
            } if subject == "BADDIE" && step == "NII2BIDS")),
            "Step must be NII2BIDS, got: {events:?}"
        );
    }

    /// If the process ends while a module-terminated block is still open
    /// (no Job-iteration line to flush it), `finish()` must emit the event.
    #[test]
    fn parser_module_terminated_flushed_by_finish_when_no_job_iteration() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "ERROR: Import module terminated for subject 1: BADDIE".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error: something unexpected happened.'".to_string(),
                // No Job-iteration line — process ended abruptly
            ],
            &["BADDIE".to_string()],
        );

        assert!(
            events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject,
                ref message,
                ..
            } if subject == "BADDIE" && message.contains("Error: something unexpected happened"))),
            "finish() must flush the pending module error; got: {events:?}"
        );
    }

    // ── build_module_terminated_message unit tests ───────────────────────────

    #[test]
    fn build_message_strips_matlab_quote_wrapper() {
        let lines = vec![
            "    'Error using SomeFn".to_string(),
            "     Detail line.".to_string(),
            "     Error in ExploreASL (line 94)".to_string(),
            "             call();'".to_string(),
        ];
        let msg = build_module_terminated_message(&lines);
        assert!(msg.starts_with("Error using SomeFn"), "got: {msg}");
        assert!(msg.ends_with("call();"), "got: {msg}");
        assert!(!msg.contains('\''), "stray quotes in: {msg}");
    }

    #[test]
    fn build_message_returns_fallback_for_empty_input() {
        assert_eq!(
            build_module_terminated_message(&[]),
            "Import module terminated unexpectedly"
        );
    }

    #[test]
    fn build_message_returns_fallback_when_only_whitespace_lines() {
        let lines = vec!["   ".to_string(), "   ".to_string()];
        assert_eq!(
            build_module_terminated_message(&lines),
            "Import module terminated unexpectedly"
        );
    }
}

use super::*;

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

        assert!(events
            .iter()
            .any(|e| matches!(e, ImportStructuredEvent::ImportFailed { .. })));
        assert!(!events
            .iter()
            .any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })));
    }

    #[test]
    fn parser_user_reported_failure() {
        let events = parse_import_lines(
            &[
                "Subject: 002Siemens, Module: xASL_module_Import".to_string(),
                "[=========================================== CONVERT RUN ======================================]".to_string(),
                "Converting subject 002Siemens, session 11, run ASL_1, scan sub-002Siemens_ses-11_T1w ...".to_string(),
                "scan sub-002Siemens_ses-11_T2w ...".to_string(),
                "scan sub-002Siemens_ses-11_asl ...".to_string(),
                "Warning: The following user-defined/DICOM fields and DICOM-Phoenix fields differ:  SoftwareVersions PostLabelingDelay BolusCutOffDelayTime".to_string(),
                "".to_string(),
                "[==============================================================================================]".to_string(),
                "NII2BIDS failed for perfusion image of 002Siemens_ses-11_run-1".to_string(),
                "Message: Unknown value in BIDS fields M0Type".to_string(),
                "xASL_imp_NII2BIDS_Subject_DefineM0Type, line 47...".to_string(),
                "Continuing...".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["002Siemens".to_string()],
        );

        assert!(events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
            ref subject,
            ref step,
            ref message,
        } if subject == "002Siemens" && step == "NII2BIDS" && message.contains("Unknown value in BIDS fields M0Type"))));
        assert!(!events
            .iter()
            .any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })));
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
                "Subject: 001Philips, Module: xASL_module_Import".to_string(),
                "==================================== NIFTI to BIDS CONVERSION ================================".to_string(),
                "ERROR: Import module terminated for subject 1: 001Philips".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using xASL_wrp_NII2BIDS_Subject>xASL_imp_CheckForAliasInSession".to_string(),
                "     Session name cannot be identified for a subject_session 001Philips_01".to_string(),
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
            &["001Philips".to_string()],
        );

        // Subject must be marked failed with step = NII2BIDS (current step when ERROR fires)
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject,
                ref step,
                ref message,
            } if subject == "001Philips"
                && step == "NII2BIDS"
                && message.contains("Session name cannot be identified"))),
            "Expected ImportFailed with error detail, got: {events:?}"
        );

        // Must NOT also emit SubjectComplete for the failed subject
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::SubjectComplete {
                ref subject, ..
            } if subject == "001Philips")),
            "SubjectComplete must not fire for a module-terminated subject"
        );

        // Overall completion marker must still fire
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::ImportComplete)),
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
                "Subject: 001Philips, Module: xASL_module_Import".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 1: 001Philips".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using SomeFn".to_string(),
                "     Detail for subject 1.'".to_string(),
                "".to_string(),
                "CONT: but continue with next iteration!".to_string(),
                "Job-iteration 1 stopped at 09-Jun-2026 16:52:53 and took 24 seconds".to_string(),
                // Subject 2
                "Subject: 002Siemens, Module: xASL_module_Import".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 2: 002Siemens".to_string(),
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
            &["001Philips".to_string(), "002Siemens".to_string()],
        );

        assert!(
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject, ..
            } if subject == "001Philips")),
            "001Philips must be marked failed"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject, ..
            } if subject == "002Siemens")),
            "002Siemens must be marked failed"
        );
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })),
            "No SubjectComplete must be emitted"
        );
        assert!(events
            .iter()
            .any(|e| matches!(e, ImportStructuredEvent::ImportComplete)));
    }

    /// First subject fails via module terminated, second succeeds normally.
    /// The second subject's SubjectComplete must not be suppressed.
    #[test]
    fn parser_module_terminated_first_fails_second_succeeds() {
        let events = parse_import_lines(
            &[
                // Subject 1 – fails
                "Subject: 001Philips, Module: xASL_module_Import".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "ERROR: Import module terminated for subject 1: 001Philips".to_string(),
                "".to_string(),
                "ans =".to_string(),
                "".to_string(),
                "    'Error using SomeFn".to_string(),
                "     Bad session name.'".to_string(),
                "".to_string(),
                "CONT: but continue with next iteration!".to_string(),
                "Job-iteration 1 stopped at 09-Jun-2026 16:52:53 and took 24 seconds".to_string(),
                // Subject 2 – succeeds
                "Subject: 002Siemens, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "Job-iteration 2 stopped at 09-Jun-2026 16:53:21 and took 28 seconds".to_string(),
                "xASL_module_Import completed 100%".to_string(),
            ],
            &["001Philips".to_string(), "002Siemens".to_string()],
        );

        assert!(events
            .iter()
            .any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
                ref subject, ..
            } if subject == "001Philips")));
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::SubjectComplete {
                ref subject, ..
            } if subject == "002Siemens")),
            "002Siemens must still complete successfully"
        );
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::SubjectComplete {
                ref subject, ..
            } if subject == "001Philips")),
            "001Philips must not produce SubjectComplete"
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
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
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
            events
                .iter()
                .any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
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

    #[test]
    fn progress_bar_regex_matches_various_formats() {
        let re = progress_bar_re();
        assert!(re.is_match("20%"));
        assert!(re.is_match(" 20%"));
        assert!(re.is_match("100%"));
        assert!(re.is_match("  "));
        assert!(re.is_match("10 20 30"));
        assert!(re.is_match("20%[Warning: MXAGetFloat64ArrayAsDouble: cannot get element"));
        assert!(re.is_match("100%[Warning: something"));
        assert!(!re.is_match("Subject: BADDIE"));
        assert!(!re.is_match("Warning: general warning"));
    }
}

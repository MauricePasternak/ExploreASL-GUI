use super::{CommandError, IntoCommandResult};
use anyhow::{Context, Result};

#[test]
fn command_errors_do_not_expose_diagnostic_context() {
    let result: Result<()> =
        Err(anyhow::anyhow!("private source payload")).context("internal operation");
    let error = result.into_command_result().unwrap_err();
    assert_eq!(error.to_string(), "The operation could not be completed.");
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        serde_json::json!({"message": "The operation could not be completed.", "details": ""})
    );
}

#[test]
fn string_command_errors_are_not_assumed_to_be_safe_for_display() {
    let result: Result<(), String> = Err("native failure".to_owned());
    assert_eq!(
        result.into_command_result().unwrap_err(),
        CommandError {
            message: "The operation could not be completed.".into(),
            details: String::new(),
        }
    );
    assert_eq!(CommandError::from("private string").details, "");
}

#[test]
fn command_errors_offer_advice_only_for_known_io_kinds() {
    for (kind, advice) in [
        (std::io::ErrorKind::PermissionDenied, "permissions"),
        (std::io::ErrorKind::NotFound, "still exists"),
        (std::io::ErrorKind::StorageFull, "Free some space"),
    ] {
        let source = anyhow::Error::new(std::io::Error::new(kind, "private I/O diagnostic"))
            .context("private operation context");
        let error = CommandError::from_error(&source, "The file could not be read.");
        assert_eq!(error.message, "The file could not be read.");
        assert!(error.details.contains(advice));
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    }

    let unknown = CommandError::from(anyhow::Error::new(std::io::Error::other(
        "permission denied; no space; not found",
    )));
    assert!(
        unknown.details.is_empty(),
        "Do not classify diagnostic strings"
    );
    let success: Result<u8> = Ok(7);
    assert_eq!(success.into_command_result().unwrap(), 7);
}

#[test]
fn configuration_errors_keep_domain_fields_and_safe_parse_diagnostics() {
    use crate::project::{config::ConfigCommandError, persistence::AtomicWriteError};
    use crate::project::{persistence::WriteErrorCategory, validation::parse_document};

    for category in [
        WriteErrorCategory::InvalidSerialization,
        WriteErrorCategory::PermissionDenied,
        WriteErrorCategory::InsufficientSpace,
        WriteErrorCategory::TemporaryWrite,
        WriteErrorCategory::FileFlush,
        WriteErrorCategory::Backup,
        WriteErrorCategory::PrimaryReplacement,
        WriteErrorCategory::DurabilityUncertain,
        WriteErrorCategory::Recovery,
    ] {
        let storage = AtomicWriteError {
            category,
            message: "private storage diagnostic".into(),
            details: "private serialized payload".into(),
        };
        let stored = serde_json::to_value(ConfigCommandError::from(
            anyhow::Error::new(storage).context("private storage context"),
        ))
        .unwrap();
        assert_eq!(stored["category"], serde_json::to_value(category).unwrap());
        assert!(!stored["message"].as_str().unwrap().is_empty());
        assert!(!stored["details"].as_str().unwrap().is_empty());
        assert_ne!(stored["details"], stored["message"]);
        assert!(!stored.to_string().contains("private"));
        if category == WriteErrorCategory::DurabilityUncertain {
            assert!(
                stored["details"]
                    .as_str()
                    .unwrap()
                    .contains("file was replaced")
            );
        }
    }

    let permission = serde_json::to_value(ConfigCommandError::from(
        anyhow::Error::new(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "private permission diagnostic",
        ))
        .context("private file path"),
    ))
    .unwrap();
    assert_eq!(permission["category"], "permission_denied");
    assert!(!permission.to_string().contains("private"));

    for (bytes, kind) in [
        (
            br#"{"schemaVersion":2,"sensitive":"private-value"}"#.as_slice(),
            "malformed",
        ),
        (br#"{"schemaVersion":3}"#.as_slice(), "unsupported"),
    ] {
        let error = parse_document(bytes).unwrap_err();
        let parsed =
            serde_json::to_value(ConfigCommandError::from(anyhow::Error::new(error))).unwrap();
        assert_eq!(parsed["kind"], kind);
        assert_eq!(parsed["details"], parsed["message"]);
        assert!(parsed["message"].is_string());
        assert!(!parsed.to_string().contains("private-value"));
    }

    let operation = serde_json::to_value(ConfigCommandError::from(
        anyhow::anyhow!("source").context("operation"),
    ))
    .unwrap();
    assert_eq!(
        operation,
        serde_json::json!({"message": "The project operation could not be completed.", "details": ""})
    );
}

use super::{RelocationTransactionError, format_transaction_error};
use anyhow::Context;

#[test]
fn operational_errors_preserve_context_chain_at_string_boundary() {
    let source = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
    let operational = Err::<(), _>(source)
        .context("Failed to write relocation journal")
        .unwrap_err();
    let error = RelocationTransactionError::from(operational);

    assert_eq!(
        format_transaction_error(&error),
        "Failed to write relocation journal: denied"
    );
    assert_eq!(
        String::from(error),
        "Failed to write relocation journal: denied"
    );
}

#[test]
fn interruption_remains_machine_matchable() {
    let error = RelocationTransactionError::Interrupted {
        point: "after-journal".to_string(),
    };

    assert!(matches!(
        error,
        RelocationTransactionError::Interrupted { ref point } if point == "after-journal"
    ));
    assert_eq!(
        format_transaction_error(&error),
        "Injected relocation interruption at after-journal"
    );
}

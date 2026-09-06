#[derive(Debug, thiserror::Error)]
pub(super) enum RelocationTransactionError {
    #[error("Injected relocation interruption at {point}")]
    Interrupted { point: String },
    #[error(transparent)]
    Operational(#[from] anyhow::Error),
}

impl From<String> for RelocationTransactionError {
    fn from(error: String) -> Self {
        Self::Operational(anyhow::Error::msg(error))
    }
}

impl From<RelocationTransactionError> for String {
    fn from(error: RelocationTransactionError) -> Self {
        match error {
            RelocationTransactionError::Interrupted { point } => {
                format!("Injected relocation interruption at {point}")
            }
            RelocationTransactionError::Operational(error) => format!("{error:#}"),
        }
    }
}

pub(super) type RelocationTransactionResult<T> = Result<T, RelocationTransactionError>;

pub(super) fn format_transaction_error(error: &RelocationTransactionError) -> String {
    match error {
        RelocationTransactionError::Interrupted { .. } => error.to_string(),
        RelocationTransactionError::Operational(error) => format!("{error:#}"),
    }
}

#[cfg(test)]
mod tests {
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
}

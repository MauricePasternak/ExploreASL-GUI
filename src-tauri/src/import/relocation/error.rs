#[derive(Debug, thiserror::Error)]
pub(super) enum RelocationTransactionError {
    #[error("Injected relocation interruption at {point}")]
    Interrupted { point: String },
    #[error(transparent)]
    Operational(#[from] anyhow::Error),
}

impl From<&'static str> for RelocationTransactionError {
    fn from(error: &'static str) -> Self {
        Self::Operational(anyhow::anyhow!(error))
    }
}

impl From<String> for RelocationTransactionError {
    fn from(error: String) -> Self {
        Self::Operational(anyhow::anyhow!(error))
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
#[path = "tests/error.rs"]
mod tests;

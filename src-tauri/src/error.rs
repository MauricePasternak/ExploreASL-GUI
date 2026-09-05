use anyhow::Result;

/// Preserve an anyhow error's full context chain at serializable IPC boundaries.
pub(crate) trait IntoCommandResult<T> {
    fn into_command_result(self) -> Result<T, String>;
}

impl<T> IntoCommandResult<T> for Result<T> {
    fn into_command_result(self) -> Result<T, String> {
        self.map_err(|error| format!("{error:#}"))
    }
}

#[cfg(test)]
mod tests {
    use super::IntoCommandResult;
    use anyhow::{Context, Result};

    #[test]
    fn command_errors_preserve_the_full_context_chain() {
        let result: Result<()> = Err(anyhow::anyhow!("source")).context("operation");
        assert_eq!(
            result.into_command_result(),
            Err("operation: source".into())
        );
    }
}

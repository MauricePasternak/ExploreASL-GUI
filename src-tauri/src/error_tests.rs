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

use anyhow::Result;
use std::sync::{Mutex, MutexGuard};

/// Preserve an anyhow error's full context chain at serializable IPC boundaries.
pub(crate) trait IntoCommandResult<T> {
    fn into_command_result(self) -> Result<T, String>;
}

impl<T> IntoCommandResult<T> for Result<T> {
    fn into_command_result(self) -> Result<T, String> {
        self.map_err(|error| format!("{error:#}"))
    }
}

pub(crate) trait MutexExt<T> {
    fn lock_or_bail(&self, name: &str) -> Result<MutexGuard<'_, T>>;
}

impl<T> MutexExt<T> for Mutex<T> {
    fn lock_or_bail(&self, name: &str) -> Result<MutexGuard<'_, T>> {
        self.lock()
            .map_err(|_| anyhow::anyhow!("{name} lock was poisoned"))
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;

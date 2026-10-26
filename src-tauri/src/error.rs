use anyhow::Result;
use std::sync::{Mutex, MutexGuard};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type, thiserror::Error)]
#[error("{message}")]
pub struct CommandError {
    pub message: String,
    pub details: String,
}

impl CommandError {
    pub(crate) fn from_error(error: &anyhow::Error, message: &str) -> Self {
        log::error!("{message} {error:#}");
        let details = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<std::io::Error>())
            .map(|error| match error.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    "Access was denied. Check file and folder permissions, then try again."
                }
                std::io::ErrorKind::NotFound => {
                    "A required file or folder could not be found. Check that it still exists and try again."
                }
                std::io::ErrorKind::StorageFull => {
                    "There is not enough disk space. Free some space, then try again."
                }
                _ => "",
            })
            .unwrap_or_default();
        Self {
            message: message.into(),
            details: details.into(),
        }
    }
}

impl From<String> for CommandError {
    fn from(error: String) -> Self {
        anyhow::Error::msg(error).into()
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        Self::from_error(&error, "The operation could not be completed.")
    }
}

/// Log diagnostic errors and return human-facing failures at IPC boundaries.
pub(crate) trait IntoCommandResult<T> {
    fn into_command_result(self) -> Result<T, CommandError>;
}

impl<T, E: Into<CommandError>> IntoCommandResult<T> for Result<T, E> {
    fn into_command_result(self) -> Result<T, CommandError> {
        self.map_err(Into::into)
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

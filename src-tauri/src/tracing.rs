use std::fmt;
use std::time::Instant;

/// Simple tracing guard that logs command entry and exit with duration.
pub struct CommandTrace<'a> {
    name: &'a str,
    start: Instant,
}

impl<'a> CommandTrace<'a> {
    pub fn new(name: &'a str) -> Self {
        log::info!("[COMMAND] {} — started", name);
        Self {
            name,
            start: Instant::now(),
        }
    }

    pub fn arg<T: fmt::Debug>(&self, key: &str, value: T) {
        log::info!("[COMMAND] {} — arg {} = {:?}", self.name, key, value);
    }

    pub fn success<T: fmt::Debug>(&self, result: &T) {
        log::info!(
            "[COMMAND] {} — completed in {:?} with result: {:?}",
            self.name,
            self.start.elapsed(),
            result
        );
    }

    pub fn error<T: fmt::Debug>(&self, err: &T) {
        log::error!(
            "[COMMAND] {} — failed in {:?} with error: {:?}",
            self.name,
            self.start.elapsed(),
            err
        );
    }
}

impl<'a> Drop for CommandTrace<'a> {
    fn drop(&mut self) {
        log::info!(
            "[COMMAND] {} — dropped after {:?}",
            self.name,
            self.start.elapsed()
        );
    }
}

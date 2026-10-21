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
        let full = format!("{:?}", result);
        const MAX_LEN: usize = 200;
        if full.len() > MAX_LEN {
            log::info!(
                "[COMMAND] {} — completed in {:?} with result ({} chars): {}…",
                self.name,
                self.start.elapsed(),
                full.len(),
                full.chars().take(MAX_LEN).collect::<String>()
            );
        } else {
            log::info!(
                "[COMMAND] {} — completed in {:?} with result: {}",
                self.name,
                self.start.elapsed(),
                full
            );
        }
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

/// One warning per event producer, plus a final suppressed-failure count.
/// Keeps renderer loss visible without one warning per scientific output line.
pub(crate) struct EmissionWarnings {
    context: String,
    failures: u64,
}

impl EmissionWarnings {
    pub(crate) fn new(context: String) -> Self {
        Self {
            context,
            failures: 0,
        }
    }

    pub(crate) fn check(&mut self, event: &str, result: Result<(), impl fmt::Display>) {
        if let Err(error) = result {
            self.failures = self.failures.saturating_add(1);
            if self.failures == 1 {
                log::warn!(
                    "{} event={event} emission failed: {error}; further warnings suppressed, native execution continues",
                    self.context
                );
            }
        }
    }
}

impl Drop for EmissionWarnings {
    fn drop(&mut self) {
        if self.failures > 0 {
            log::warn!("{} failed_event_emissions={}", self.context, self.failures);
        }
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

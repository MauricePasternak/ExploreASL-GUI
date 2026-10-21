//! Keep plugin IPC/formatting, but avoid its unbounded failed-write buffer and
//! timestamp-colliding file rotation. Diagnostics never become run authority.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::PathBuf,
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{Builder, Target, TargetKind, fern};

const FILE_LIMIT: u64 = 5 * 1024 * 1024;
const RECORD_LIMIT: usize = 128 * 1024;
const ARCHIVES: usize = 5;
const TRUNCATED: &[u8] = b"\n[LOGGING] record truncated\n";

pub(super) fn init<R: Runtime>(app: &AppHandle<R>) {
    let mut targets = vec![Target::new(TargetKind::Stdout)];
    match app.path().app_log_dir() {
        Ok(directory) => targets.push(file_target(
            directory.join(format!("{}.log", app.package_info().name)),
        )),
        Err(error) => stderr_warning(format_args!("app log directory unavailable: {error}")),
    }
    #[cfg(debug_assertions)]
    targets.push(file_target(
        std::env::temp_dir().join("exploreasl-gui-logs/dev.log"),
    ));
    let result = Builder::default()
        .level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        })
        .targets(targets)
        .split(app);
    match result {
        Ok((_, level, logger)) => {
            if let Err(error) = tauri_plugin_log::attach_logger(level, logger) {
                stderr_warning(format_args!("logger installation failed: {error}"));
            }
        }
        Err(error) => stderr_warning(format_args!("logger setup failed: {error}")),
    }
}

fn file_target(path: PathBuf) -> Target {
    Target::new(TargetKind::Dispatch(fern::Dispatch::new().chain(
        fern::Output::writer(Box::new(BoundedFile::new(path)), "\n"),
    )))
}

fn stderr_warning(message: impl std::fmt::Display) {
    // Never recurse into log::*, panic on a broken stderr, or print every failed
    // record. The caller bounds frequency; precision bounds the error text.
    let _ = writeln!(
        io::stderr().lock(),
        "[LOGGING] {:.256}",
        message.to_string()
    );
}

struct BoundedFile {
    path: PathBuf,
    file: Option<File>,
    size: u64,
    buffer: Vec<u8>,
    truncated: bool,
    failure_reported: bool,
}

impl BoundedFile {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            file: None,
            size: 0,
            buffer: Vec::with_capacity(RECORD_LIMIT),
            truncated: false,
            failure_reported: false,
        }
    }

    fn archive(&self, number: usize) -> PathBuf {
        let mut path = self.path.as_os_str().to_os_string();
        path.push(format!(".{number}"));
        path.into()
    }

    fn rotate(&mut self) -> io::Result<()> {
        self.file.take();
        ignore_missing(fs::remove_file(self.archive(ARCHIVES)))?;
        for number in (1..ARCHIVES).rev() {
            ignore_missing(fs::rename(self.archive(number), self.archive(number + 1)))?;
        }
        ignore_missing(fs::rename(&self.path, self.archive(1)))?;
        self.size = 0;
        Ok(())
    }

    fn flush_record(&mut self) -> io::Result<()> {
        if self.file.is_none() {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?;
            self.size = file.metadata()?.len();
            self.file = Some(file);
        }
        if self.size + self.buffer.len() as u64 > FILE_LIMIT {
            self.rotate()?;
            self.file = Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&self.path)?,
            );
        }
        if let Some(file) = self.file.as_mut() {
            file.write_all(&self.buffer)?;
            file.flush()?;
            self.size += self.buffer.len() as u64;
        }
        Ok(())
    }
}

impl Write for BoundedFile {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let count = bytes.len().min(RECORD_LIMIT - self.buffer.len());
        self.buffer.extend_from_slice(&bytes[..count]);
        self.truncated |= count < bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        if self.truncated {
            self.buffer.truncate(RECORD_LIMIT - TRUNCATED.len());
            if let Err(error) = std::str::from_utf8(&self.buffer) {
                self.buffer.truncate(error.valid_up_to());
            }
            self.buffer.extend_from_slice(TRUNCATED);
        }
        let result = self.flush_record();
        // Clear on EVERY outcome, including partial writes, failed flushes and
        // rotation errors. Never replay or accumulate failed diagnostic records.
        self.buffer.clear();
        self.truncated = false;
        if let Err(error) = result {
            self.file = None;
            if !self.failure_reported {
                self.failure_reported = true;
                stderr_warning(format_args!(
                    "file sink failed: {error}; failed records discarded; further failures suppressed (stdout retained)"
                ));
            }
        }
        // fern otherwise prints one I/O warning per record. Failure is already
        // reported above; it must not escape into scientific command handling.
        Ok(())
    }
}

fn ignore_missing(result: io::Result<()>) -> io::Result<()> {
    match result {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

#[cfg(test)]
#[path = "logging_test.rs"]
mod tests;

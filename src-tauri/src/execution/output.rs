//! Bounded diagnostic drains; never execution or completion authority.
use crate::process::ProcessScope;
use std::{
    io::{self, Read},
    process::{Command, Stdio},
    sync::{Arc, mpsc},
    thread::{self, JoinHandle},
};

const LINE_LIMIT: usize = 64 * 1024;
type Pipe = Box<dyn Read + Send>;

struct Reader {
    source: &'static str,
    sender: mpsc::Sender<Pipe>,
    handle: JoinHandle<()>,
}

pub(crate) struct OutputDrains {
    context: String,
    readers: Vec<Reader>,
}

impl OutputDrains {
    /// Start readers BEFORE spawning the child. If thread creation fails, use
    /// null for that stream, not an unread pipe or a failed scientific launch.
    pub(crate) fn new(
        context: String,
        on_line: impl Fn(&'static str, String) + Send + Sync + 'static,
    ) -> Self {
        Self::new_with_stdout_level(context, log::Level::Info, on_line)
    }

    pub(crate) fn new_with_stdout_level(
        context: String,
        stdout_level: log::Level,
        on_line: impl Fn(&'static str, String) + Send + Sync + 'static,
    ) -> Self {
        let on_line = Arc::new(on_line);
        let mut readers = Vec::new();
        for source in ["stdout", "stderr"] {
            let level = if source == "stdout" {
                stdout_level
            } else {
                log::Level::Info
            };
            let (sender, receiver) = mpsc::channel::<Pipe>();
            let thread_context = context.clone();
            let callback = on_line.clone();
            let handle = thread::Builder::new()
                .name(format!("output-{source}"))
                .spawn(move || {
                    let context = thread_context;
                    let Ok(stream) = receiver.recv() else { return };
                    let mut truncated = 0_u64;
                    let result = drain_lines(stream, |line, shortened| {
                        if shortened {
                            truncated += 1;
                            if truncated == 1 {
                                log::warn!("{context} stream={source} output line truncated at {LINE_LIMIT} bytes; draining continues");
                            }
                        }
                        log::log!(level, "{context} stream={source} {line}");
                        callback(source, line);
                    });
                    if let Err(error) = result {
                        log::warn!("{context} stream={source} output read failed: {error}; execution outcome remains independent");
                    }
                    if truncated > 0 {
                        log::warn!("{context} stream={source} truncated_lines={truncated}");
                    }
                });
            match handle {
                Ok(handle) => readers.push(Reader {
                    source,
                    sender,
                    handle,
                }),
                Err(error) => log::warn!(
                    "{context} stream={source} diagnostic reader unavailable: {error}; output disabled, execution continues"
                ),
            }
        }
        Self { context, readers }
    }

    pub(crate) fn configure(&self, command: &mut Command) {
        command.stdout(if self.readers.iter().any(|r| r.source == "stdout") {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        command.stderr(if self.readers.iter().any(|r| r.source == "stderr") {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    }

    pub(crate) fn attach(&self, scope: &mut ProcessScope) {
        for reader in &self.readers {
            let pipe = match reader.source {
                "stdout" => scope.take_stdout().map(|s| Box::new(s) as Pipe),
                _ => scope.take_stderr().map(|s| Box::new(s) as Pipe),
            };
            let result = pipe.and_then(|pipe| {
                reader
                    .sender
                    .send(pipe)
                    .map_err(|_| io::Error::other("diagnostic reader stopped"))
            });
            if let Err(error) = result {
                log::warn!(
                    "{} stream={} output attachment failed: {error}",
                    self.context,
                    reader.source
                );
            }
        }
    }
}

impl Drop for OutputDrains {
    fn drop(&mut self) {
        // Callers settle attached scopes first. Unattached readers also join on
        // spawn/preparation failure because dropping their sender releases recv.
        for Reader {
            source,
            sender,
            handle,
        } in self.readers.drain(..)
        {
            drop(sender);
            if handle.join().is_err() {
                log::warn!(
                    "{} stream={source} diagnostic reader panicked",
                    self.context
                );
            }
        }
    }
}

fn drain_lines(mut stream: impl Read, mut emit: impl FnMut(String, bool)) -> io::Result<()> {
    let mut retained = Vec::with_capacity(LINE_LIMIT);
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let count = match stream.read(&mut buffer) {
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                if !retained.is_empty() {
                    let (line, lossy_truncated) = lossy_line(&retained);
                    emit(line, truncated || lossy_truncated);
                }
                return Err(error);
            }
        };
        if count == 0 {
            if !retained.is_empty() {
                let (line, lossy_truncated) = lossy_line(&retained);
                emit(line, truncated || lossy_truncated);
            }
            return Ok(());
        }
        for byte in &buffer[..count] {
            if *byte == b'\n' {
                if retained.last() == Some(&b'\r') {
                    retained.pop();
                }
                let (line, lossy_truncated) = lossy_line(&retained);
                emit(line, truncated || lossy_truncated);
                retained.clear();
                truncated = false;
            } else if retained.len() < LINE_LIMIT {
                retained.push(*byte);
            } else {
                truncated = true;
            }
        }
    }
}

fn lossy_line(bytes: &[u8]) -> (String, bool) {
    let mut line = String::from_utf8_lossy(bytes).into_owned();
    let truncated = line.len() > LINE_LIMIT;
    while line.len() > LINE_LIMIT {
        line.pop();
    }
    (line, truncated)
}

#[cfg(test)]
#[path = "output_test.rs"]
mod tests;

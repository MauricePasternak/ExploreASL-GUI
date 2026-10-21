use super::*;

struct FailedRead;
impl Read for FailedRead {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("injected read failure"))
    }
}

#[test]
fn bounds_invalid_utf8_long_lines_and_preserves_crlf_and_final_fragment() {
    let mut bytes = vec![0xff; LINE_LIMIT + 9000];
    bytes.extend_from_slice(b"\nnormal\r\nlast");
    let mut lines = Vec::new();
    drain_lines(bytes.as_slice(), |line, truncated| {
        lines.push((line, truncated))
    })
    .unwrap();
    assert_eq!(lines.len(), 3);
    assert!(lines[0].0.len() <= LINE_LIMIT);
    assert!(lines[0].1);
    assert_eq!(lines[1], ("normal".into(), false));
    assert_eq!(lines[2], ("last".into(), false));
    assert!(
        drain_lines(FailedRead, |_, _| {})
            .unwrap_err()
            .to_string()
            .contains("injected read failure")
    );
}

#[cfg(unix)]
#[test]
fn drains_both_full_pipes_without_renderer_and_joins_on_spawn_failure() {
    use std::sync::Mutex;
    struct Capture(Mutex<Vec<String>>);
    impl log::Log for Capture {
        fn enabled(&self, _: &log::Metadata<'_>) -> bool {
            true
        }
        fn log(&self, record: &log::Record<'_>) {
            let line = record.args().to_string();
            if line.starts_with("test run=") {
                self.0.lock().unwrap().push(line);
            }
        }
        fn flush(&self) {}
    }
    static CAPTURE: Capture = Capture(Mutex::new(Vec::new()));
    log::set_logger(&CAPTURE).unwrap();
    log::set_max_level(log::LevelFilter::Info);
    let lines = Arc::new(Mutex::new(Vec::new()));
    let received = lines.clone();
    let drains = OutputDrains::new("test run=pipe worker=1".into(), move |source, line| {
        assert!(
            CAPTURE
                .0
                .lock()
                .unwrap()
                .contains(&format!("test run=pipe worker=1 stream={source} {line}"))
        );
        received.lock().unwrap().push((source, line.len()));
    });
    let mut command = Command::new("sh");
    command.args([
        "-c",
        "(head -c 200000 /dev/zero) & (head -c 200000 /dev/zero >&2) & wait",
    ]);
    drains.configure(&mut command);
    let mut scope = ProcessScope::spawn(command).unwrap();
    drains.attach(&mut scope);
    assert!(
        scope
            .wait_for(std::time::Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .exit_status
            .success()
    );
    drop(drains);
    let lines = lines.lock().unwrap();
    assert_eq!(lines.len(), 2);
    assert!(lines.iter().all(|(_, length)| *length <= LINE_LIMIT));
    assert!(lines.iter().any(|(source, _)| *source == "stdout"));
    assert!(lines.iter().any(|(source, _)| *source == "stderr"));
    let logs = CAPTURE.0.lock().unwrap();
    assert!(
        logs.iter()
            .any(|line| line.contains("stream=stdout truncated_lines=1"))
    );
    assert!(
        logs.iter()
            .any(|line| line.contains("stream=stderr truncated_lines=1"))
    );
    drop(logs);

    let drains = OutputDrains::new("test run=failed-spawn".into(), |_, _| {});
    let mut command = Command::new("/nonexistent-exploreasl-output-test");
    drains.configure(&mut command);
    assert!(ProcessScope::spawn(command).is_err());
    drop(drains);

    let drains = OutputDrains::new("test run=read-error".into(), |_, _| {});
    for reader in &drains.readers {
        reader.sender.send(Box::new(FailedRead)).unwrap();
    }
    drop(drains);
    let logs = CAPTURE.0.lock().unwrap();
    assert_eq!(
        logs.iter()
            .filter(|line| line.contains("output read failed: injected read failure"))
            .count(),
        2
    );
    drop(logs);

    // The trace used to byte-slice a multibyte result and panic here.
    crate::tracing::CommandTrace::new("unicode-test").success(&format!("{}é", "x".repeat(198)));

    let mut warnings = crate::tracing::EmissionWarnings::new("test run=emission".into());
    for _ in 0..1000 {
        warnings.check("output", Err::<(), _>("renderer unavailable"));
    }
    drop(warnings);
    let logs = CAPTURE.0.lock().unwrap();
    assert_eq!(
        logs.iter()
            .filter(|line| line.starts_with("test run=emission"))
            .count(),
        2
    );
    assert!(
        logs.iter()
            .any(|line| line.contains("failed_event_emissions=1000"))
    );
}

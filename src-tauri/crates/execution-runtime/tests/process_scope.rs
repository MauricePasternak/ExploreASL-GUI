#![cfg(unix)]

use easl_execution_runtime::process::{CancellationToken, ProcessScope, cancel_all, run_probe};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

fn fixture(role: &str, root: &Path) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "process_scope_fixture"])
        .env("EASL_PROCESS_SCOPE_FIXTURE", role)
        .env("EASL_PROCESS_SCOPE_ROOT", root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn until(mut check: impl FnMut() -> bool, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn scope_exposes_both_pipes_for_concurrent_domain_draining() {
    let mut command = Command::new("sh");
    command
        .args(["-c", "printf stdout; printf stderr >&2"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut scope = ProcessScope::spawn(command).unwrap();
    let stdout = scope.take_stdout().unwrap();
    let stderr = scope.take_stderr().unwrap();
    let out = thread::spawn(move || std::io::read_to_string(stdout).unwrap());
    let err = thread::spawn(move || std::io::read_to_string(stderr).unwrap());
    assert!(scope.wait().unwrap().exit_status.success());
    assert_eq!(out.join().unwrap(), "stdout");
    assert_eq!(err.join().unwrap(), "stderr");
}

#[test]
#[allow(clippy::zombie_processes)] // Scope owns this fixture's ordinary descendant.
fn process_scope_fixture() {
    let Ok(role) = std::env::var("EASL_PROCESS_SCOPE_FIXTURE") else {
        return;
    };
    let root = std::path::PathBuf::from(std::env::var_os("EASL_PROCESS_SCOPE_ROOT").unwrap());
    static STOP: AtomicBool = AtomicBool::new(false);
    extern "C" fn terminate(_: i32) {
        STOP.store(true, Ordering::SeqCst);
    }
    unsafe {
        libc::signal(
            libc::SIGTERM,
            if role == "ignore-leader" {
                libc::SIG_IGN
            } else {
                terminate as *const () as libc::sighandler_t
            },
        );
    }
    if role == "leader" || role == "detached-leader" {
        let child_role = if role == "leader" {
            "descendant"
        } else {
            "detached"
        };
        fixture(child_role, &root).spawn().unwrap();
    }
    if role == "detached" {
        assert!(unsafe { libc::setsid() } > 0);
    }
    if role == "probe" {
        use std::io::Write;
        let stderr = thread::spawn(|| {
            std::io::stderr().write_all(&vec![b'e'; 4096]).unwrap();
        });
        std::io::stdout().write_all(&vec![b'o'; 4096]).unwrap();
        stderr.join().unwrap();
        return;
    }
    fs::write(root.join(format!("{role}-ready")), b"").unwrap();
    while !STOP.load(Ordering::SeqCst)
        && !(role == "detached" && root.join("detached-halt").exists())
    {
        thread::sleep(Duration::from_millis(10));
    }
    fs::write(root.join(format!("{role}-stopped")), b"").unwrap();
}

struct DetachedCleanup(std::path::PathBuf);

impl Drop for DetachedCleanup {
    fn drop(&mut self) {
        let _ = fs::write(self.0.join("detached-halt"), b"");
    }
}

#[test]
fn shutdown_settles_leader_and_same_group_descendant() {
    let root = tempfile::tempdir().unwrap();
    let mut scope = ProcessScope::spawn(fixture("leader", root.path())).unwrap();
    let cancellation = scope.cancellation();
    assert!(until(
        || root.path().join("descendant-ready").exists(),
        Duration::from_secs(5)
    ));

    scope.cancel().unwrap();
    let outcome = scope.wait().unwrap();

    assert!(cancellation.is_cancelled());
    assert!(outcome.settled);
    assert!(root.path().join("leader-stopped").exists());
    assert!(root.path().join("descendant-stopped").exists());
}

#[test]
fn shutdown_preserves_grace_before_forcing_unresponsive_scope() {
    let root = tempfile::tempdir().unwrap();
    let mut scope = ProcessScope::spawn(fixture("ignore-leader", root.path())).unwrap();
    assert!(until(
        || root.path().join("ignore-leader-ready").exists(),
        Duration::from_secs(5)
    ));

    let started = Instant::now();
    scope.cancel().unwrap();

    assert!(started.elapsed() >= Duration::from_secs(5));
    assert!(scope.wait().unwrap().settled);
}

#[test]
fn batch_shutdown_uses_one_shared_grace_deadline() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let mut scopes = vec![
        ProcessScope::spawn(fixture("ignore-leader", first.path())).unwrap(),
        ProcessScope::spawn(fixture("ignore-leader", second.path())).unwrap(),
    ];
    assert!(until(
        || first.path().join("ignore-leader-ready").exists(),
        Duration::from_secs(5)
    ));
    assert!(until(
        || second.path().join("ignore-leader-ready").exists(),
        Duration::from_secs(5)
    ));
    let started = Instant::now();
    cancel_all(&mut scopes).unwrap();
    assert!(started.elapsed() >= Duration::from_secs(5));
    assert!(started.elapsed() < Duration::from_secs(8));
}

#[test]
fn detached_session_is_documented_outside_the_settled_scope_and_self_cleans() {
    let root = tempfile::tempdir().unwrap();
    let _cleanup = DetachedCleanup(root.path().to_path_buf());
    let mut scope = ProcessScope::spawn(fixture("detached-leader", root.path())).unwrap();
    assert!(until(
        || root.path().join("detached-ready").exists(),
        Duration::from_secs(5)
    ));

    scope.cancel().unwrap();
    assert!(scope.wait().unwrap().settled);
    assert!(root.path().join("detached-ready").exists());
    fs::write(root.path().join("detached-halt"), b"").unwrap();
    assert!(until(
        || root.path().join("detached-stopped").exists(),
        Duration::from_secs(5)
    ));
}

#[test]
fn probe_capture_bounds_and_drains_both_streams() {
    let root = tempfile::tempdir().unwrap();
    let output = run_probe(
        fixture("probe", root.path()),
        128,
        Duration::from_secs(5),
        CancellationToken::default(),
    )
    .unwrap();

    assert!(output.status.success());
    assert_eq!(output.stdout.len(), 128);
    assert_eq!(output.stderr.len(), 128);
    assert_eq!(&output.stdout[output.stdout.len() - 32..], vec![b'o'; 32]);
    assert_eq!(&output.stderr[output.stderr.len() - 32..], vec![b'e'; 32]);
    assert!(output.stdout_truncated);
    assert!(output.stderr_truncated);
}

#[test]
fn probe_timeout_shuts_down_its_scope() {
    let root = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let error = run_probe(
        fixture("leader", root.path()),
        128,
        Duration::from_millis(100),
        CancellationToken::default(),
    )
    .unwrap_err();

    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(root.path().join("leader-stopped").exists());
    assert!(root.path().join("descendant-stopped").exists());
}

#[test]
fn probe_timeout_retains_scope_through_forced_settlement() {
    let root = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let error = run_probe(
        fixture("ignore-leader", root.path()),
        128,
        Duration::from_millis(100),
        CancellationToken::default(),
    )
    .unwrap_err();

    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    assert!(started.elapsed() >= Duration::from_secs(5));
    assert!(root.path().join("ignore-leader-ready").exists());
}

#[test]
fn probe_cancellation_shuts_down_its_scope() {
    let root = tempfile::tempdir().unwrap();
    let cancellation = CancellationToken::default();
    let cancellation_for_thread = cancellation.clone();
    let root_for_thread = root.path().to_path_buf();
    let probe = thread::spawn(move || {
        run_probe(
            fixture("leader", &root_for_thread),
            128,
            Duration::from_secs(30),
            cancellation_for_thread,
        )
    });
    assert!(until(
        || root.path().join("descendant-ready").exists(),
        Duration::from_secs(5)
    ));

    cancellation.cancel();
    let error = probe.join().unwrap().unwrap_err();

    assert_eq!(error.kind(), std::io::ErrorKind::Interrupted);
    assert!(root.path().join("leader-stopped").exists());
    assert!(root.path().join("descendant-stopped").exists());
}

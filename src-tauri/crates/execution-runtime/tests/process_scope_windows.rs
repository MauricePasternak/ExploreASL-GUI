#![cfg(windows)]

use easl_execution_runtime::process::ProcessScope;
use std::{
    fs,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::WAIT_OBJECT_0,
    System::{
        JobObjects::IsProcessInJob,
        Threading::{
            GetCurrentProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            WaitForSingleObject,
        },
    },
};

const ROLE: &str = "EASL_WINDOWS_JOB_FIXTURE";
const ROOT: &str = "EASL_WINDOWS_JOB_ROOT";
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.is_file() {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn open_process(pid: u32) -> OwnedHandle {
    let raw = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE_ACCESS,
            0,
            pid,
        )
    };
    assert!(
        !raw.is_null(),
        "failed to open process {pid}: {}",
        std::io::Error::last_os_error()
    );
    unsafe { OwnedHandle::from_raw_handle(raw) }
}

fn process_is_in_job(process: RawHandle) -> bool {
    let mut assigned = 0;
    assert_ne!(
        unsafe { IsProcessInJob(process, std::ptr::null_mut(), &mut assigned) },
        0,
        "IsProcessInJob failed: {}",
        std::io::Error::last_os_error()
    );
    assigned != 0
}

fn run_fixture(role: &std::ffi::OsStr) {
    let root = std::path::PathBuf::from(std::env::var_os(ROOT).unwrap());
    fs::write(
        root.join(format!("{}.pid", role.to_string_lossy())),
        unsafe { GetCurrentProcessId() }.to_string(),
    )
    .unwrap();
    if role == "leader" {
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cancellation_settles_leader_and_ordinary_descendant_in_windows_job",
            ])
            .env(ROLE, "descendant")
            .env(ROOT, &root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
    }
    thread::sleep(Duration::from_secs(60));
}

#[test]
fn cancellation_settles_leader_and_ordinary_descendant_in_windows_job() {
    if let Some(role) = std::env::var_os(ROLE) {
        run_fixture(&role);
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "cancellation_settles_leader_and_ordinary_descendant_in_windows_job",
        ])
        .env(ROLE, "leader")
        .env(ROOT, root.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut scope = ProcessScope::spawn(command).unwrap();

    let leader_path = root.path().join("leader.pid");
    let descendant_path = root.path().join("descendant.pid");
    wait_for(&leader_path);
    wait_for(&descendant_path);
    let leader = open_process(fs::read_to_string(leader_path).unwrap().parse().unwrap());
    let descendant = open_process(
        fs::read_to_string(descendant_path)
            .unwrap()
            .parse()
            .unwrap(),
    );
    assert!(process_is_in_job(leader.as_raw_handle()));
    assert!(process_is_in_job(descendant.as_raw_handle()));

    let cancellation = scope.cancel();
    let outcome = scope
        .poll_settled()
        .unwrap()
        .expect("scope must settle even when no console accepts CTRL_BREAK");
    assert!(outcome.settled);
    assert_eq!(
        unsafe { WaitForSingleObject(leader.as_raw_handle(), 0) },
        WAIT_OBJECT_0
    );
    assert_eq!(
        unsafe { WaitForSingleObject(descendant.as_raw_handle(), 0) },
        WAIT_OBJECT_0
    );
    if let Err(graceful_error) = cancellation {
        eprintln!("graceful Windows cancellation was unavailable: {graceful_error}");
    }
}

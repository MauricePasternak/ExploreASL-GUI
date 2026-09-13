//! Synchronous, in-memory ownership of one supported local process scope.

use std::{
    io,
    io::Read,
    process::{ChildStderr, ChildStdout, Command, ExitStatus},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use process_wrap::std::{ChildWrapper, CommandWrap};

pub const GRACE_PERIOD: Duration = Duration::from_secs(5);
pub const FORCE_SETTLEMENT_PERIOD: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Debug)]
pub struct ProcessOutcome {
    pub exit_status: ExitStatus,
    pub settled: bool,
}

#[derive(Debug)]
pub struct ProbeOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

/// Runs a bounded launch-related probe. Captured bytes never leave this result
/// and both pipes drain to EOF even after their retained prefix reaches `limit`.
pub fn run_probe(
    mut command: Command,
    limit: usize,
    timeout: Duration,
    cancellation: CancellationToken,
) -> io::Result<ProbeOutput> {
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    let mut scope = ProcessScope::spawn_with_cancellation(command, cancellation)?;
    let stdout = scope
        .child
        .stdout()
        .take()
        .ok_or_else(|| io::Error::other("probe stdout was not piped"))?;
    let stderr = scope
        .child
        .stderr()
        .take()
        .ok_or_else(|| io::Error::other("probe stderr was not piped"))?;
    let stdout = thread::spawn(move || read_bounded(stdout, limit));
    let stderr = thread::spawn(move || read_bounded(stderr, limit));
    let outcome = match scope.wait_for(timeout) {
        Ok(Some(outcome)) => Ok(outcome),
        Ok(None) => {
            // Do not return a timeout while a failed force/settlement attempt
            // could leave probe work alive. This stack frame remains the
            // in-process scope owner until settlement is confirmed.
            settle_cancelled_scope(&mut scope)?;
            Err(io::Error::new(io::ErrorKind::TimedOut, "probe timed out"))
        }
        Err(error) => {
            // `wait_for` can surface a cancellation/force/settlement failure.
            // Retain and retry the scope before exposing that error to the
            // caller; otherwise preparation could drop live probe work.
            settle_cancelled_scope(&mut scope)?;
            Err(error)
        }
    };
    let (stdout, stdout_truncated) = stdout
        .join()
        .map_err(|_| io::Error::other("probe stdout reader panicked"))??;
    let (stderr, stderr_truncated) = stderr
        .join()
        .map_err(|_| io::Error::other("probe stderr reader panicked"))??;
    let outcome = outcome?;
    Ok(ProbeOutput {
        status: outcome.exit_status,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

/// Retain cancellation ownership until the supported scope has actually
/// settled. A failed TERM/KILL/confirmation is actionable to the caller only
/// after this owner has retried it; it never causes a live scope to be dropped.
fn settle_cancelled_scope(scope: &mut ProcessScope) -> io::Result<ProcessOutcome> {
    scope.cancellation().cancel();
    loop {
        match scope.wait_for(Duration::from_millis(100)) {
            Ok(Some(outcome)) => return Ok(outcome),
            Ok(None) => continue,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => match scope.wait() {
                Ok(outcome) => return Ok(outcome),
                Err(_) => thread::sleep(Duration::from_millis(100)),
            },
            Err(_) => thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn read_bounded(mut stream: impl Read, limit: usize) -> io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(limit);
    let mut buffer = [0; 8192];
    let mut truncated = false;
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            return Ok((retained, truncated));
        }
        let remaining = limit.saturating_sub(retained.len());
        let retained_count = remaining.min(count);
        retained.extend_from_slice(&buffer[..retained_count]);
        truncated |= retained_count < count;
    }
}

pub struct ProcessScope {
    child: Box<dyn ChildWrapper>,
    platform: PlatformScope,
    cancellation: CancellationToken,
}

/// Cancels scopes as one scientific-worker cohort. Every scope receives its
/// graceful request before the shared five-second deadline starts; only scopes
/// still live at that deadline are forced.
pub fn cancel_all(scopes: &mut [ProcessScope]) -> io::Result<()> {
    let mut first_error = None;
    for scope in &mut *scopes {
        // A failed graceful signal remains reportable, but never prevents the
        // other scopes from receiving theirs or later forced settlement.
        if let Err(error) = scope.request_graceful_shutdown() {
            first_error.get_or_insert(error);
        }
    }
    let deadline = Instant::now() + GRACE_PERIOD;
    loop {
        let mut all_settled = true;
        for scope in &mut *scopes {
            match scope.settled() {
                Ok(Some(_)) => {}
                Ok(None) => all_settled = false,
                Err(error) => {
                    first_error.get_or_insert(error);
                    all_settled = false;
                }
            }
        }
        if all_settled {
            return first_error.map_or(Ok(()), Err);
        }
        if Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    for scope in &mut *scopes {
        // Polling failure is not evidence of settlement. Force every member;
        // no earlier scope may prevent later scientific scopes receiving it.
        if let Err(error) = scope.platform.force() {
            first_error.get_or_insert(error);
        }
    }
    // Force was attempted for every member. Keep polling/reaping all of them
    // before reporting the first platform failure to the owning supervisor.
    let deadline = Instant::now() + FORCE_SETTLEMENT_PERIOD;
    loop {
        let mut all_settled = true;
        for scope in &mut *scopes {
            match scope.settled() {
                Ok(Some(_)) => {}
                Ok(None) => all_settled = false,
                Err(error) => {
                    first_error.get_or_insert(error);
                    all_settled = false;
                }
            }
        }
        if all_settled {
            return first_error.map_or(Ok(()), Err);
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "process scopes did not settle after forced shutdown",
            ));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

impl ProcessScope {
    pub fn spawn(command: Command) -> io::Result<Self> {
        Self::spawn_with_cancellation(command, CancellationToken::default())
    }

    pub fn spawn_with_cancellation(
        command: Command,
        cancellation: CancellationToken,
    ) -> io::Result<Self> {
        let (child, platform) = PlatformScope::spawn(command)?;
        Ok(Self {
            child,
            platform,
            cancellation,
        })
    }

    pub fn cancellation(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    /// Transfers a piped stdout reader to the domain supervisor.  Domains must
    /// drain both pipes concurrently before waiting for a long-running child.
    pub fn take_stdout(&mut self) -> io::Result<ChildStdout> {
        self.child
            .stdout()
            .take()
            .ok_or_else(|| io::Error::other("process stdout was not piped"))
    }

    /// Transfers a piped stderr reader to the domain supervisor.
    pub fn take_stderr(&mut self) -> io::Result<ChildStderr> {
        self.child
            .stderr()
            .take()
            .ok_or_else(|| io::Error::other("process stderr was not piped"))
    }

    /// Requests graceful shutdown, preserves a full five-second interval, then
    /// forces the remaining supported scope and waits for settlement.
    pub fn cancel(&mut self) -> io::Result<()> {
        let graceful_error = self.request_graceful_shutdown().err();
        // CTRL_BREAK is best effort for GUI/no-console Windows workers. A
        // failed graceful request still receives the full grace interval and
        // successful forced settlement is a successful cancellation.
        if self.wait_until(Instant::now() + GRACE_PERIOD)?.is_some() {
            return graceful_error.map_or(Ok(()), Err);
        }
        let force_error = self.platform.force().err();
        if self
            .wait_until(Instant::now() + FORCE_SETTLEMENT_PERIOD)?
            .is_none()
        {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "process scope did not settle after forced shutdown",
            ));
        }
        graceful_error.or(force_error).map_or(Ok(()), Err)
    }

    pub fn request_graceful_shutdown(&mut self) -> io::Result<()> {
        self.cancellation.cancel();
        self.platform.graceful()
    }

    pub fn poll_settled(&mut self) -> io::Result<Option<ProcessOutcome>> {
        self.settled()
    }

    pub fn force_shutdown(&mut self) -> io::Result<()> {
        self.platform.force()
    }

    /// Waits until the direct child is reaped and its original supported scope
    /// has no remaining members.
    pub fn wait(&mut self) -> io::Result<ProcessOutcome> {
        loop {
            if let Some(outcome) = self.settled()? {
                return Ok(outcome);
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    /// Waits for normal completion up to `timeout`. A cancelled token shuts down
    /// the scope through the normal grace/force path before returning Interrupted.
    pub fn wait_for(&mut self, timeout: Duration) -> io::Result<Option<ProcessOutcome>> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(outcome) = self.settled()? {
                return Ok(Some(outcome));
            }
            if self.cancellation.is_cancelled() {
                self.cancel()?;
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "process scope cancelled",
                ));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_until(&mut self, deadline: Instant) -> io::Result<Option<ProcessOutcome>> {
        loop {
            if let Some(outcome) = self.settled()? {
                return Ok(Some(outcome));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    fn settled(&mut self) -> io::Result<Option<ProcessOutcome>> {
        let Some(exit_status) = self.child.try_wait()? else {
            return Ok(None);
        };
        if !self.platform.empty()? {
            return Ok(None);
        }
        Ok(Some(ProcessOutcome {
            exit_status,
            settled: true,
        }))
    }
}

#[cfg(unix)]
struct PlatformScope {
    group: i32,
}

#[cfg(unix)]
impl PlatformScope {
    fn spawn(command: Command) -> io::Result<(Box<dyn ChildWrapper>, Self)> {
        use process_wrap::std::ProcessGroup;

        let mut command = CommandWrap::from(command);
        command.wrap(ProcessGroup::leader());
        let child = command.spawn()?;
        let group =
            i32::try_from(child.id()).map_err(|_| io::Error::other("child ID exceeds pid_t"))?;
        Ok((child, Self { group }))
    }

    fn graceful(&self) -> io::Result<()> {
        self.signal(libc::SIGTERM)
    }

    fn force(&self) -> io::Result<()> {
        self.signal(libc::SIGKILL)
    }

    fn signal(&self, signal: i32) -> io::Result<()> {
        if unsafe { libc::kill(-self.group, signal) } == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(())
        } else {
            Err(error)
        }
    }

    fn empty(&self) -> io::Result<bool> {
        if unsafe { libc::kill(-self.group, 0) } == 0 {
            return Ok(false);
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(true)
        } else {
            Err(error)
        }
    }
}

#[cfg(windows)]
struct PlatformScope {
    job: std::sync::Arc<std::os::windows::io::OwnedHandle>,
    group: u32,
}

#[cfg(windows)]
impl PlatformScope {
    fn spawn(command: Command) -> io::Result<(Box<dyn ChildWrapper>, Self)> {
        use process_wrap::std::{CommandWrapper, CreationFlags, JobObject};
        use std::{
            os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
            sync::Arc,
        };
        use windows_sys::Win32::System::{JobObjects::*, Threading::CREATE_NEW_PROCESS_GROUP};

        #[derive(Debug)]
        struct AssignJob(Arc<OwnedHandle>);
        impl CommandWrapper for AssignJob {
            fn wrap_child(
                &mut self,
                mut child: Box<dyn ChildWrapper>,
                _: &CommandWrap,
            ) -> io::Result<Box<dyn ChildWrapper>> {
                let process = child
                    .process_handle()
                    .ok_or_else(|| io::Error::other("child lacks process handle"))?;
                if unsafe {
                    AssignProcessToJobObject(self.0.as_raw_handle(), process.as_raw_handle())
                } == 0
                {
                    let error = io::Error::last_os_error();
                    // JobObject keeps the child suspended until assignment. Do
                    // not return an error while leaving that inaccessible child
                    // alive and permanently suspended.
                    let _ = child.start_kill();
                    let _ = child.wait();
                    return Err(error);
                }
                Ok(child)
            }
        }

        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Arc::new(unsafe { OwnedHandle::from_raw_handle(raw) });
        let mut command = CommandWrap::from(command);
        let mut flags = CreationFlags(Default::default());
        flags.0.0 = CREATE_NEW_PROCESS_GROUP;
        // JobObject temporarily suspends the child. AssignJob runs before it
        // resumes that child, retaining an independently controllable handle.
        command
            .wrap(flags)
            .wrap(AssignJob(job.clone()))
            .wrap(JobObject);
        let child = command.spawn()?;
        let group = child.id();
        Ok((child, Self { job, group }))
    }

    fn graceful(&self) -> io::Result<()> {
        use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, GenerateConsoleCtrlEvent};
        if unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, self.group) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn force(&self) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        if unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn empty(&self) -> io::Result<bool> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        if unsafe {
            QueryInformationJobObject(
                self.job.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(info.ActiveProcesses == 0)
    }
}

use super::*;

#[test]
fn pid_zero_is_rejected_by_pure_validation() {
    assert_eq!(
        validate_process_id(0).unwrap_err(),
        "PID 0 is not a valid child process ID"
    );
}

#[cfg(unix)]
#[test]
fn unsigned_max_is_rejected_by_pure_validation() {
    let error = validate_process_id(u32::MAX).unwrap_err();
    assert!(error.contains("exceeds the Unix positive PID range"));
}

#[cfg(unix)]
#[test]
fn first_value_above_unix_pid_range_is_rejected() {
    let pid = i32::MAX as u32 + 1;
    let error = checked_unix_pid(pid).unwrap_err();
    assert!(error.contains("exceeds the Unix positive PID range"));
}

#[cfg(unix)]
#[test]
fn valid_positive_pid_converts_exactly() {
    let pid = i32::MAX as u32;
    assert_eq!(checked_unix_pid(pid).unwrap().as_raw(), i32::MAX);
}

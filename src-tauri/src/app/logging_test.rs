use super::*;

#[cfg(target_os = "linux")]
#[test]
fn repeated_disk_full_discards_bounded_records_and_recovers_without_replay() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.log");
    std::os::unix::fs::symlink("/dev/full", &path).unwrap();
    let mut sink = BoundedFile::new(path.clone());
    let record = vec![b'x'; RECORD_LIMIT * 2];
    for _ in 0..1000 {
        sink.write_all(&record).unwrap();
        assert_eq!(sink.buffer.len(), RECORD_LIMIT);
        sink.flush().unwrap();
        assert!(sink.buffer.is_empty());
        assert!(sink.file.is_none());
        assert!(sink.failure_reported);
        assert!(sink.buffer.capacity() <= RECORD_LIMIT);
    }
    fs::remove_file(&path).unwrap();
    sink.write_all(b"recovered\n").unwrap();
    sink.flush().unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"recovered\n");
    sink.write_all("é".repeat(RECORD_LIMIT).as_bytes()).unwrap();
    sink.flush().unwrap();
    let recovered = fs::read(&path).unwrap();
    assert!(
        std::str::from_utf8(&recovered)
            .unwrap()
            .ends_with(std::str::from_utf8(TRUNCATED).unwrap())
    );
    assert!(recovered.len() <= RECORD_LIMIT + b"recovered\n".len());

    // A failed rotation must discard its pending record too, not append past
    // the file limit or retain it for the next diagnostic call.
    let file = OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(FILE_LIMIT).unwrap();
    sink.file = None;
    fs::create_dir(sink.archive(ARCHIVES)).unwrap();
    sink.write_all(b"rotation must fail\n").unwrap();
    sink.flush().unwrap();
    assert!(sink.buffer.is_empty());
    assert!(sink.file.is_none());
    assert_eq!(fs::metadata(&path).unwrap().len(), FILE_LIMIT);
}

#[test]
fn rapid_rotations_keep_five_numbered_archives_and_active_file() {
    use std::io::Read;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.log");
    let mut sink = BoundedFile::new(path.clone());
    // No sleeps or timestamp naming: many rotations in the same clock interval
    // cannot collide, and the retained generations must remain newest-first.
    for generation in 0..12_u8 {
        let record = vec![generation; RECORD_LIMIT];
        for _ in 0..FILE_LIMIT as usize / RECORD_LIMIT {
            sink.write_all(&record).unwrap();
            sink.flush().unwrap();
        }
    }
    assert_eq!(
        fs::read_dir(directory.path()).unwrap().count(),
        ARCHIVES + 1
    );
    for number in 0..=ARCHIVES {
        let file = if number == 0 {
            path.clone()
        } else {
            sink.archive(number)
        };
        assert_eq!(fs::metadata(&file).unwrap().len(), FILE_LIMIT);
        let mut first = [0];
        File::open(file).unwrap().read_exact(&mut first).unwrap();
        assert_eq!(first[0], 11 - number as u8);
    }
    drop(sink);
    let mut reopened = BoundedFile::new(path.clone());
    reopened.write_all(b"new record\n").unwrap();
    reopened.flush().unwrap();
    assert_eq!(fs::read(path).unwrap(), b"new record\n");
    assert_eq!(
        fs::read_dir(directory.path()).unwrap().count(),
        ARCHIVES + 1
    );
}

#[cfg(windows)]
use cap_fs_ext::OsMetadataExt;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
#[cfg(not(any(unix, windows)))]
use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[cfg(windows)]
const WINDOWS_NO_REPLACE_MOVE_FLAGS: u32 =
    windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH;
#[cfg(windows)]
const _: () = assert!(
    WINDOWS_NO_REPLACE_MOVE_FLAGS & windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH
        != 0
);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRelativePath(PathBuf);

impl ProjectRelativePath {
    pub fn new(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        if path.as_os_str().is_empty()
            || path.is_absolute()
            || path.as_os_str().as_encoded_bytes().contains(&0)
        {
            return Err(invalid_path(path));
        }
        if path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(invalid_path(path));
        }
        Ok(Self(path.to_path_buf()))
    }

    pub fn as_path(&self) -> &Path {
        &self.0
    }
}

fn invalid_path(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!(
            "Project path must be nonempty, relative, and NUL-free: {}",
            path.display()
        ),
    )
}

/// Capability for paths below one canonical, real project directory.
///
/// Every operation accepts a `ProjectRelativePath`; callers cannot pass an
/// unrestricted absolute path after obtaining this capability.
pub struct ProjectDirectory {
    directory: Dir,
}

impl ProjectDirectory {
    pub fn open(root: impl AsRef<Path>) -> io::Result<Self> {
        let root = root.as_ref();
        let metadata = fs::symlink_metadata(root)?;
        if is_root_link_or_reparse(&metadata) || !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Project root must be a real directory",
            ));
        }
        let directory = open_project_root_nofollow(root)?;
        Ok(Self { directory })
    }

    /// Check the current pathname against the retained directory identity.
    /// This detects rename/replacement before native pathname-based admission.
    pub fn matches_root(&self, root: &Path) -> io::Result<bool> {
        use cap_fs_ext::MetadataExt;
        let current = Self::open(root)?;
        let held = self.directory.dir_metadata()?;
        let current = current.directory.dir_metadata()?;
        Ok(held.dev() == current.dev() && held.ino() == current.ino())
    }

    /// Identity read from the retained capability, never a later pathname lookup.
    pub fn directory_identity(&self) -> io::Result<(u64, u64)> {
        use cap_fs_ext::MetadataExt;
        let metadata = self.directory.dir_metadata()?;
        Ok((metadata.dev(), metadata.ino()))
    }

    pub fn create_dir_all(&self, path: &ProjectRelativePath) -> io::Result<()> {
        let mut current = self.directory.try_clone()?;
        for component in path.as_path().components() {
            let Component::Normal(name) = component else {
                return Err(invalid_path(path.as_path()));
            };
            current = match current.open_dir_nofollow(name) {
                Ok(directory) => directory,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    match current.create_dir(name) {
                        Ok(()) => {}
                        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(error),
                    }
                    current.open_dir_nofollow(name)?
                }
                Err(error) => return Err(error),
            };
            require_safe_directory(&current)?;
        }
        Ok(())
    }

    /// Bootstrap authority ancestors and synchronize every parent entry, even
    /// when another process created the directory immediately before us.
    pub fn create_dir_all_durable(&self, path: &ProjectRelativePath) -> io::Result<DirectorySync> {
        let mut current = self.directory.try_clone()?;
        for component in path.as_path().components() {
            let Component::Normal(name) = component else {
                return Err(invalid_path(path.as_path()));
            };
            match current.create_dir(name) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
            let child = current.open_dir_nofollow(name)?;
            require_safe_directory(&child)?;
            #[cfg(unix)]
            current.open(".")?.sync_all()?;
            current = child;
        }
        #[cfg(unix)]
        {
            Ok(DirectorySync::Supported)
        }
        #[cfg(not(unix))]
        {
            Ok(DirectorySync::Unsupported)
        }
    }

    pub fn open_regular(&self, path: &ProjectRelativePath) -> io::Result<cap_std::fs::File> {
        let (parent, name) = self.open_parent(path)?;
        let mut options = OpenOptions::new();
        // Opening a FIFO for reading blocks before metadata can reject it.
        // Nonblocking mode has no effect on regular-file reads.
        options.read(true).nonblock(true).follow(FollowSymlinks::No);
        let file = parent.open_with(name, &options)?;
        require_safe_regular_file(&file.metadata()?, path.as_path())?;
        Ok(file)
    }

    pub fn read_regular(&self, path: &ProjectRelativePath) -> io::Result<Vec<u8>> {
        use std::io::Read;

        let mut file = self.open_regular(path)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    pub fn create_new_file(&self, path: &ProjectRelativePath) -> io::Result<cap_std::fs::File> {
        let (parent, name) = self.open_parent(path)?;
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        parent.open_with(name, &options)
    }

    pub fn cleanup_owned_candidate(&self, path: &ProjectRelativePath) -> io::Result<bool> {
        let (parent, name) = self.open_parent(path)?;
        match parent.symlink_metadata(&name) {
            Ok(metadata) => {
                require_safe_regular_file(&metadata, path.as_path())?;
                parent.remove_file(name)?;
                Ok(true)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn replace_regular_file(
        &self,
        source: &ProjectRelativePath,
        destination: &ProjectRelativePath,
    ) -> io::Result<()> {
        let (source_parent, source_name) = self.open_parent(source)?;
        let (destination_parent, destination_name) = self.open_parent(destination)?;
        require_regular_entry(&source_parent, &source_name, source.as_path())?;
        match destination_parent.symlink_metadata(&destination_name) {
            Ok(metadata) => require_safe_regular_file(&metadata, destination.as_path())?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        source_parent.rename(source_name, &destination_parent, destination_name)
    }

    pub fn rename_regular_file_no_replace(
        &self,
        source: &ProjectRelativePath,
        destination: &ProjectRelativePath,
    ) -> io::Result<()> {
        let (source_parent, source_name) = self.open_parent(source)?;
        let (destination_parent, destination_name) = self.open_parent(destination)?;
        require_regular_entry(&source_parent, &source_name, source.as_path())?;
        rename_no_replace_in(
            &source_parent,
            &source_name,
            &destination_parent,
            &destination_name,
        )
    }

    /// No-follow identity for a regular file or directory. Domain callers combine
    /// this identity with content evidence before compensating a journal entry.
    pub fn entry_identity(&self, path: &ProjectRelativePath) -> io::Result<(bool, u64, u64)> {
        use cap_fs_ext::MetadataExt;
        let (parent, name) = self.open_parent(path)?;
        let metadata = parent.symlink_metadata(name)?;
        if is_link_or_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
            return Err(io::Error::other("Project entry has unsupported type"));
        }
        Ok((metadata.is_dir(), metadata.dev(), metadata.ino()))
    }

    pub fn directory_names(&self, path: &ProjectRelativePath) -> io::Result<Vec<OsString>> {
        let (parent, name) = self.open_parent(path)?;
        let directory = parent.open_dir_nofollow(name)?;
        require_safe_directory(&directory)?;
        directory
            .entries()?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect()
    }

    /// Rename an already validated regular file or directory without replacing
    /// a destination. Unsupported entries and all linked components fail closed.
    pub fn rename_entry_no_replace(
        &self,
        source: &ProjectRelativePath,
        destination: &ProjectRelativePath,
    ) -> io::Result<()> {
        self.entry_identity(source)?;
        let (source_parent, source_name) = self.open_parent(source)?;
        let (destination_parent, destination_name) = self.open_parent(destination)?;
        rename_no_replace_in(
            &source_parent,
            &source_name,
            &destination_parent,
            &destination_name,
        )
    }

    /// Remove only an empty directory. Domain ownership must be checked first.
    pub fn remove_empty_directory(&self, path: &ProjectRelativePath) -> io::Result<()> {
        if !self.entry_identity(path)?.0 {
            return Err(io::Error::other("Project entry is not a directory"));
        }
        let (parent, name) = self.open_parent(path)?;
        parent.remove_dir(name)
    }

    /// Retain a private inode witness while installing a file. Existing
    /// destinations are never replaced, including dangling symlinks.
    pub fn hard_link_regular_no_replace(
        &self,
        source: &ProjectRelativePath,
        destination: &ProjectRelativePath,
    ) -> io::Result<()> {
        let (source_parent, source_name) = self.open_parent(source)?;
        let (destination_parent, destination_name) = self.open_parent(destination)?;
        require_regular_entry(&source_parent, &source_name, source.as_path())?;
        source_parent.hard_link(source_name, &destination_parent, destination_name)
    }

    pub fn sync_parent(&self, path: &ProjectRelativePath) -> io::Result<DirectorySync> {
        let (parent, _) = self.open_parent(path)?;
        #[cfg(unix)]
        {
            parent.open(".")?.sync_all()?;
            Ok(DirectorySync::Supported)
        }
        #[cfg(not(unix))]
        {
            let _ = parent;
            Ok(DirectorySync::Unsupported)
        }
    }

    fn open_parent(&self, path: &ProjectRelativePath) -> io::Result<(Dir, OsString)> {
        let mut components = path.as_path().components().collect::<Vec<_>>();
        let leaf = components.pop().and_then(|component| match component {
            Component::Normal(name) => Some(name.to_os_string()),
            _ => None,
        });
        let leaf = leaf.ok_or_else(|| invalid_path(path.as_path()))?;
        let mut parent = self.directory.try_clone()?;
        for component in components {
            let Component::Normal(name) = component else {
                return Err(invalid_path(path.as_path()));
            };
            parent = parent.open_dir_nofollow(name)?;
            require_safe_directory(&parent)?;
        }
        Ok((parent, leaf))
    }
}

fn require_regular_entry(parent: &Dir, name: &OsString, path: &Path) -> io::Result<()> {
    require_safe_regular_file(&parent.symlink_metadata(name)?, path)
}

fn require_safe_directory(directory: &Dir) -> io::Result<()> {
    let metadata = directory.symlink_metadata(".")?;
    if !metadata.is_dir() || is_link_or_reparse(&metadata) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Project authority component is not a real directory",
        ));
    }
    Ok(())
}

fn require_safe_regular_file(metadata: &cap_std::fs::Metadata, path: &Path) -> io::Result<()> {
    if is_link_or_reparse(metadata) || !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Project entry must be a regular file: {}", path.display()),
        ));
    }
    Ok(())
}

fn is_link_or_reparse(metadata: &cap_std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
fn is_root_link_or_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as StdMetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_root_link_or_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(unix)]
fn open_project_root_nofollow(root: &Path) -> io::Result<Dir> {
    use std::os::unix::fs::OpenOptionsExt;

    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
        .open(root)?;
    Ok(Dir::from_std_file(file))
}

#[cfg(windows)]
fn open_project_root_nofollow(root: &Path) -> io::Result<Dir> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        // Match cap-primitives' directory handles: pin the root against
        // rename/delete while handle-derived path operations are in flight.
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(root)?;
    let metadata = file.metadata()?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Project root must be a real directory",
        ));
    }
    Ok(Dir::from_std_file(file))
}

#[cfg(not(any(unix, windows)))]
fn open_project_root_nofollow(root: &Path) -> io::Result<Dir> {
    Dir::open_ambient_dir(root, ambient_authority())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectorySync {
    Supported,
    Unsupported,
}

impl DirectorySync {
    pub fn is_supported(self) -> bool {
        matches!(self, Self::Supported)
    }
}

/// Synchronize a directory after a visible rename. Errors leave visibility
/// unchanged and therefore mean durability is uncertain; callers decide any
/// domain-specific compensation policy.
pub fn sync_directory(path: &Path) -> io::Result<DirectorySync> {
    #[cfg(unix)]
    {
        fs::File::open(path)?.sync_all()?;
        Ok(DirectorySync::Supported)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(DirectorySync::Unsupported)
    }
}

#[cfg(target_os = "linux")]
fn rename_no_replace_in(
    source_directory: &Dir,
    source: &OsString,
    destination_directory: &Dir,
    destination: &OsString,
) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    let source_directory = source_directory.try_clone()?.into_std_file();
    let destination_directory = destination_directory.try_clone()?.into_std_file();
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            source_directory.as_raw_fd(),
            source.as_ptr(),
            destination_directory.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn rename_no_replace_in(
    source_directory: &Dir,
    source: &OsString,
    destination_directory: &Dir,
    destination: &OsString,
) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn renameatx_np(fromfd: i32, from: *const i8, tofd: i32, to: *const i8, flags: u32) -> i32;
    }
    const RENAME_EXCL: u32 = 0x0000_0004;
    let source = CString::new(source.as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    let source_directory = source_directory.try_clone()?.into_std_file();
    let destination_directory = destination_directory.try_clone()?.into_std_file();
    if unsafe {
        renameatx_np(
            source_directory.as_raw_fd(),
            source.as_ptr(),
            destination_directory.as_raw_fd(),
            destination.as_ptr(),
            RENAME_EXCL,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_no_replace_in(
    source_directory: &Dir,
    source: &OsString,
    destination_directory: &Dir,
    destination: &OsString,
) -> io::Result<()> {
    // cap-primitives implements Windows directory operations with paths
    // obtained from handles. Its directory opens (and our root open) deny
    // FILE_SHARE_DELETE, keeping both parents pinned through MoveFileExW.
    // Only validated single-component names reach this private helper.
    let source = pinned_directory_path(source_directory)?.join(source);
    let destination = pinned_directory_path(destination_directory)?.join(destination);
    rename_no_replace(&source, &destination)
}

#[cfg(windows)]
fn pinned_directory_path(directory: &Dir) -> io::Result<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;

    let mut buffer = vec![0u16; 256];
    loop {
        let length = unsafe {
            GetFinalPathNameByHandleW(
                directory.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        if (length as usize) < buffer.len() {
            return Ok(PathBuf::from(OsString::from_wide(
                &buffer[..length as usize],
            )));
        }
        // A short-buffer result includes space for the terminating NUL.
        buffer.resize(length as usize, 0);
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn rename_no_replace_in(
    _source_directory: &Dir,
    _source: &OsString,
    _destination_directory: &Dir,
    _destination: &OsString,
) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Atomic capability-relative no-replace rename is unsupported on this platform",
    ))
}

#[cfg(target_os = "linux")]
pub fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
pub fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn renameatx_np(fromfd: i32, from: *const i8, tofd: i32, to: *const i8, flags: u32) -> i32;
    }
    const RENAME_EXCL: u32 = 0x0000_0004;
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    if unsafe {
        renameatx_np(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            RENAME_EXCL,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
pub fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let source = wide(source);
    let destination = wide(destination);
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            WINDOWS_NO_REPLACE_MOVE_FLAGS,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination)?;
    fs::remove_file(source)
}

pub fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };

        let wide = |path: &Path| {
            path.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        let source = wide(source);
        let destination = wide(destination);
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)
    }
}

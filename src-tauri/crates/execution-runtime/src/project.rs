//! Capability-only ownership of one canonical project in the single app process.

use crate::fs_safety::{DirectorySync, ProjectDirectory, ProjectRelativePath};
use std::{
    io,
    path::{Path, PathBuf},
};

const AUTHORITY_DIRECTORY: &str = "derivatives/ExploreASL_GUI/execution";

pub struct ActiveProject {
    root: PathBuf,
    directory: ProjectDirectory,
    pub directory_sync: DirectorySync,
}

impl std::fmt::Debug for ActiveProject {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ActiveProject")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl ActiveProject {
    pub fn open(root: impl AsRef<Path>) -> io::Result<Self> {
        let root = root.as_ref().canonicalize()?;
        let directory = ProjectDirectory::open(&root)?;
        let directory_sync =
            directory.create_dir_all_durable(&ProjectRelativePath::new(AUTHORITY_DIRECTORY)?)?;
        Ok(Self {
            root,
            directory,
            directory_sync,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn verify_root_identity(&self) -> io::Result<()> {
        if !self.directory.matches_root(&self.root)? {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Project directory identity changed while active",
            ));
        }
        Ok(())
    }
}

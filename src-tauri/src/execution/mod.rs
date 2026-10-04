//! Shared MATLAB and Apptainer discovery, profile validation, and command preparation
//! used by both import and processing. Scientific run workflows belong to those
//! domains, not this module.

pub(crate) mod apptainer;
pub(crate) mod command;
pub(crate) mod executables;
pub(crate) mod launch;
pub mod matlab;
pub mod profile;

//! Project activation, native ownership, saving, and setup.
//! Lifecycle coordinates recovery order; import and processing own recovery policy.
pub(crate) mod lifecycle;
pub(crate) mod ownership;
pub(crate) mod persistence;
pub mod setup;
pub(crate) mod source_paths;
pub(crate) mod validation;

#[cfg(test)]
pub(crate) mod ownership_tests;
#[cfg(test)]
mod persistence_tests;

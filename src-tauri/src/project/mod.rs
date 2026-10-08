//! Project activation, native ownership, saving, and setup.
//! Lifecycle coordinates recovery order; import and processing own recovery policy.
pub mod bindings;
pub(crate) mod config;
pub(crate) mod lifecycle;
pub mod model;
pub(crate) mod ownership;
pub(crate) mod persistence;
pub mod setup;
pub(crate) mod source_paths;
pub(crate) mod validation;

#[cfg(test)]
mod tests;

//! Desktop startup, application state, and single-instance activation.
pub(crate) mod bootstrap;
mod close_fallback;
mod logging;
mod single_instance;
pub(crate) mod state;

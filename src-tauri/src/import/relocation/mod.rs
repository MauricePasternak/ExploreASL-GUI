//! Native-owned import output replacement. All paths persisted in the journal
//! are relative to the canonical project root.
mod candidate;
mod cleanup;
mod commit;
mod error;
mod fault_injection;
mod filesystem;
mod inventory;
mod journal;
mod paths;
mod planning;
mod prepare;
mod recovery;
mod rollback;
mod transaction;
mod types;

#[cfg(test)]
pub use fault_injection::{
    FaultPoint as RelocationFailurePoint, RelocationFailureGuard, inject_relocation_failure,
};
#[cfg(test)]
pub use filesystem::transaction_test_fingerprint;
pub use inventory::{
    bind_plan, create_plan, inventory_subject, plan_relocation, validate_plan_scope,
};
pub use journal::JOURNAL_FILE;
pub use paths::{canonical_project_root, validate_relative_path};
pub use recovery::recover;
pub use transaction::relocate;
pub use types::{
    RelocationEntry, RelocationEntryKind, RelocationJournal, RelocationOutcome, RelocationPlan,
    RelocationRecoverySummary, RelocationSubjectStatus, SubjectInventory, SubjectRelocationOutcome,
};

#[cfg(test)]
mod tests;

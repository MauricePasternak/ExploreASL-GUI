//! Visualization data loading, metadata joins, and Niivue volume requests.

pub(crate) mod data;
pub(crate) mod external;
pub(crate) mod join;
pub(crate) mod niivue_protocol;
pub(crate) mod stats;

pub use data::{
    ActiveData, ColumnMetadata, ColumnSource, DataInspection, read_data_columns,
    read_data_columns_impl,
};
pub use external::{
    ExternalColumnMetadata, ExternalDataInspection, FileStats, inspect_external_data,
    inspect_external_data_impl, stat_file,
};
pub use join::{
    JoinKeyPair, SanityCheckResult, check_join_sanity, check_join_sanity_impl, execute_join,
    execute_join_impl,
};
pub use stats::{
    StatsFileInfo, list_stats_files, list_stats_files_impl, load_qcbf_data, load_qcbf_data_impl,
};

#[cfg(test)]
mod tests;

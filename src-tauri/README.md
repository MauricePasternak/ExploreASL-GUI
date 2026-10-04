# Backend map

Start at `src/lib.rs`. Tauri plugin setup, command registration, startup recovery,
and app exit live in `src/app/bootstrap.rs`.

| Module | Owns |
| --- | --- |
| `app/` | Desktop startup, shared native state, single-instance activation |
| `project/` | Activation, close, ownership checks, `project.easl` saving and validation |
| `project/setup/` | Reviewed DICOM/BIDS project creation and BIDS compatibility repair, including transaction recovery |
| `execution/` | MATLAB/Apptainer discovery, profiles, executable checks, host commands, launch checks and cache warmup |
| `import/` | DICOM discovery, staging, import runs, output parsing, verification and finalization |
| `import/relocation/` | Replacement of subject rawdata with verified import output, rollback and recovery |
| `bids/` | Dataset inspection, sidecar reading, metadata grouping and vendor interpretation |
| `processing/` | Scientific run requests, preparation, worker supervision, monitoring and recovery |
| `visualization/` | Population statistics, external tables, joins and NIfTI delivery |
| `qc.rs` | QC measure extraction |
| `manifest.rs` | Prior-module completion evidence used by the manifest workflow |
| `system.rs` | Host CPU and memory information |
| `crates/execution-runtime/` | OS process scopes and confined filesystem operations |

## Execution versus processing

`execution/` answers how to prepare MATLAB or Apptainer commands. Both import and
processing use it. `processing/` answers which scientific work to run, on which
subjects, and how to track and recover that run. OS-level process supervision
mechanisms live in `crates/execution-runtime/`.

## Finding logic

- Project activation and recovery ordering: `project/lifecycle.rs`.
- Import launch, process observation, output installation: `import/pipeline.rs`,
  `import/supervisor.rs`, `import/finalization.rs`.
- Processing completion evidence: `processing/completion.rs`. Log and lock
  parsing live with `processing/logs.rs` and `processing/locks.rs`.
- Table loading and joining: `visualization/stats.rs`, `external.rs`, `join.rs`.

Feature modules own their recovery policy. Project lifecycle coordinates order.
Module interfaces expose commands and shared types; implementation helpers stay
private where possible. Tests live beside their owning module.

GUI/BIDS Subject/Session/Run/Modality correspond to ExploreASL
Subject/Visit/Session/Scan. In particular, ExploreASL Session means GUI/BIDS Run.

Behavioral contracts remain in `../openspec/specs/`.

# Master Specification: ExploreASL GUI

## Overview

A Tauri v2 desktop application providing a graphical interface for ExploreASL, a MATLAB-based pipeline for processing arterial spin labeling (ASL) MRI data. Target users: clinicians and researchers with minimal command-line experience.

The application wraps the full ExploreASL workflow: DICOM import to BIDS → processing parameter configuration → MATLAB pipeline execution → progress monitoring with rollback support.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React Frontend (TypeScript)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Mantine  │ │ Zustand  │ │ React Hook Form  │ │
│  │ UI       │ │ State    │ │ + Zod Validation │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────────┐│
│  │ React Router v7 (multi-route, background)    ││
│  └──────────────────────────────────────────────┘│
├─────────────────────────────────────────────────┤
│  Tauri Bridge (IPC: invoke / events)              │
│  ┌──────────────────────────────────────────┐     │
│  │ Plugin APIs: dialog, fs, opener           │     │
│  ├──────────────────────────────────────────┤     │
│  │ Custom Rust Commands (minimal)            │     │
│  └──────────────────────────────────────────┘     │
├─────────────────────────────────────────────────┤
│  Rust Backend (custom commands only when needed)  │
│  ┌──────────────┐ ┌────────────────────────────┐ │
│  │ Subprocess    │ │ File Watcher (notify)      │ │
│  │ (MATLAB, N×)  │ │ (lock/*.status files)      │ │
│  │              │ │ + walk_directory            │ │
│  └──────────────┘ └────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Key principle:** Rust is thin. React drives all logic. Prefer Tauri built-in plugin APIs (`@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`) over custom Rust commands. Only write custom Rust commands when a built-in plugin cannot perform the operation (e.g., `walk_directory` for recursive DICOM scanning, `watch_lock_dir` for file system events, MATLAB subprocess management). File read/write, folder selection, and basic path operations should use the plugin APIs from the frontend.

## Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | Tauri v2 | Native performance, small binary, direct filesystem access |
| Frontend | React 19 + TypeScript 6 | Component model, type safety |
| UI components | Mantine | Built-in Stepper, DataTable, Dropzone, Select — matches wizard/data-grid heavy workflow |
| State management | Zustand | Lightweight, supports slices, integrates with React Hook Form |
| Form handling | React Hook Form + Zod | Complex nested configs, BIDS validation |
| Routing | React Router v7 | Multi-route support, background navigation during processing |
| Styling | Mantine (CSS-in-JS via Emotion) | Ships with Mantine, no additional CSS framework needed |
| Rust deps | tauri, tauri-plugin-opener, serde, serde_json, notify | Minimal — no DICOM parsing, no heavy computation |

## Routing

```
/                              → LandingPage (project list, new/open)
/project/:id/import             → Phase2Import (DICOM ingestion wizard)
/project/:id/parameters         → Phase3DataParams (dataPar.json config)
/project/:id/processing         → Phase4Processing (execution dashboard)
/project/:id/viewer             → (future) WebGL CBF volume viewer
```

Routes are non-blocking. Processing runs asynchronously via Rust backend; user can navigate away and return. A global status bar (in `Layout`) shows active processing state across routes.

## Project Lifecycle

1. **Create:** User selects a `<project_root>` directory via native folder dialog. Frontend initializes `derivatives/ExploreASL_GUI/` with an empty `.easl` state file.
2. **Open:** Native file dialog or detection of existing `.easl` in recent projects list.
3. **Phases:** Each phase builds on the previous. Phases can be revisited (state preserved). The `.easl` file tracks `currentPhase` and is auto-saved on Zustand state changes (debounced).
4. **Save/Export:** Auto-save to `.easl`. "Save as Template" strips paths and subject data, exports only structural config.

## Persistence Strategy

| Storage | Path | Contents |
|---|---|---|
| Global settings | Platform app data dir (via `@tauri-apps/plugin-store`, `settings.json`) | MATLAB paths, ExploreASL path, theme, recent projects list |
| Project state | `<root>/derivatives/ExploreASL_GUI/` | `.easl` JSON (uiState, mappingState, exploreAslConfig) + export artifacts |

The `.easl` file is pure JSON, human-readable, version-controlled in project repos if desired. Structure:

```json
{
  "version": "0.1.0",
  "projectMeta": { "name": "...", "rootPath": "...", "createdAt": "...", "currentPhase": "import" },
  "uiState": { "activeStep": 2, "sidebarCollapsed": false },
  "mappingState": { /* Phase 2 tokenizer/mapping results */ },
  "exploreAslConfig": {
    "sourcestructure": { /* JSON */ },
    "studyPar": { /* JSON */ },
    "dataPar": { /* JSON */ }
  }
}
```

Global settings are never included in the `.easl` file (prevents environment-specific paths from polluting shared projects).

## Data Flow

```
User drops DICOM folders
  → Rust walk_directory() returns paths
  → React tokenizer discovers path patterns, presents path blocks (split by /, _, -)
  → User assigns semantic tags (Subject/Session/Run/Modality/Ignore)
  → React generates folderHierarchy regex, tokenOrdering, aliases
  → User maps raw modality strings to ExploreASL names
  → User orders sessions/runs, optionally renames subjects
  → User creates metadata groups (BIDS params) via DataTable selection
  → React generates sourcestructure.json + studyPar.json
  → Rust creates .easl_staging/ BIDS symlink tree, writes configs
  → Rust spawns MATLAB: ExploreASL(stagingRoot, [1 1 0], 0)
  → Rust streams stdout/stderr to React (import uses stdout for progress/errors, NOT lock files)
  → On success: atomic mv to rawdata/, cleanup staging
     On failure: error extracted from stdout pattern matching

User configures dataPar.json
  → React forms grouped by parameter category (per docs)
  → Zod validates, writes to derivatives/ExploreASL/dataPar.json

User runs processing
  → Selects subjects/sessions, modules, MATLAB version, workers
  → Rust spawns MATLAB: ExploreASL(root, 0, processModules)
  → Lock file watcher drives progress UI (processing modules have fine-grained .status files)
  → Rollback: delete status files + derivative artifacts
```

## Cross-Cutting Concerns

### Error Handling

- **Validation:** Zod schemas validate at every user input boundary. Invalid state never reaches the filesystem.
- **Import module failures:** Derive errors from MATLAB stdout/stderr parsing. Import module lock files (`010_DCM2NII.status`, `020_NII2BIDS.status`, `999_ready.status`) are too coarse for per-subject error granularity. **ExploreASL creates all 3 status files even when a subject fails** — the GUI must delete them post-failure so the subject can be retried. Parse for failure patterns: `NII2BIDS failed for`, `DCM2NII failed for`. `TODO: collect comprehensive import failure pattern list.`
- **Processing module failures (Structural/ASL/Population):** Errors derived from missing lock/status files. These modules produce fine-grained per-step status files. `TODO: obtain complete listing of status files per module to map missing files to human-readable error messages.`
- **File system errors:** Rust returns typed errors (permission denied, disk full, path not found) surfaced as Mantine notifications.
- **Crash recovery:** `.easl` auto-save ensures state survives GUI crashes. `.easl_staging/` persists on import crash for debugging. Processing can be resumed from failure point.

### Platform Support

- Linux: primary target. `/tmp/` is typically `tmpfs`, hence staging in project root.
- Windows/Mac: supported via Tauri bundling. Path handling uses Rust's `std::path` (cross-platform). Global settings use `@tauri-apps/plugin-store` which resolves to the platform-appropriate app data directory automatically.

### File System Safety

- No mutation of original DICOM data (symlinks only during import).
- Atomic `mv` operations for completed import subjects.
- Lock file directory is append-only from GUI perspective (only deletes during rollback).
- Stale project entries in recent projects list: if a project root no longer exists or `.easl` is missing, prompt "Project [name] was moved or deleted. Remove from recent list?" instead of showing an error.

### ExploreASL Version Detection

ExploreASL stores a `VERSION_x.y.z` file at its root directory. On settings save, verify the ExploreASL path by checking for this file. The version is displayed in the settings UI for reference but no compatibility enforcement in V0.

## Package Map

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.11.0",
    "@tauri-apps/plugin-opener": "^2.5.4",
    "@tauri-apps/plugin-dialog": "^2.7.1",
    "@tauri-apps/plugin-fs": "^2.5.1",
    "@tauri-apps/plugin-os": "^2.3.2",
    "@tauri-apps/plugin-store": "^2.4.3",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router": "^7.x",
    "@mantine/core": "^9.x",
    "@mantine/notifications": "^9.x",
    "@mantine/hooks": "^9.x",
    "@tabler/icons-react": "^3.x",
    "zustand": "^5.x",
    "react-hook-form": "^7.x",
    "@hookform/resolvers": "^4.x",
    "zod": "^4.x"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.0",
    "@types/react": "^19.x",
    "@types/react-dom": "^19.x",
    "@vitejs/plugin-react": "^4.7.0",
    "typescript": "~6.0.3",
    "vite": "^7.3.2",
    "vitest": "^4.x",
    "jsdom": "^29.x",
    "@testing-library/react": "^16.x",
    "@testing-library/jest-dom": "^6.x"
  }
}
```

## Out of Scope (V0)

- DICOM header parsing (modality derived from folder names only)
- Docker execution of ExploreASL
- WebGL CBF volume viewer (`/project/:id/viewer` route reserved)
- Multi-language support / i18n
- Automated ExploreASL updates
- Cloud/remote project sync
- Custom preset authoring for dataPar.json
- Partial re-execution of failed import subjects (full re-import only)
- Auto-resume after crash (manual resume via button)
- Population module statistical result display

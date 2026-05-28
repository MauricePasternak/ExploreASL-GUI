# Phase 1: Project Setup & Application Shell

## Overview

Establishes the application skeleton: landing page for project management, global settings, and the persistent shell layout (navigation, status bar) used across all phases.

## User Flow

### 1.1 First Launch
1. User opens ExploreASL GUI.
2. If no global settings exist, auto-created via `@tauri-apps/plugin-store` in the platform-appropriate app data directory with defaults.
3. Landing page shows empty recent projects list and "New Project" button:

#### Landing Page Rough UI Draft

```md
================================================================================
  ExploreASL GUI                                                             ⚙️ 
================================================================================
                                                                             
                                                                             
                         ExploreASL GUI                                      
                                                                             
       A graphical interface for ExploreASL — arterial spin labeling         
                       MRI processing pipeline.                              

                        [Logo Image Here]                                            
                                                                             
      +---------------------------------------------------------------+      
      |                                                               |      
      |    [ + New Project ]         [ 📂 Open Project ]              |      
      |                                                               |      
      +---------------------------------------------------------------+      
                                                                             
                                                                             
   --------------------------- Recent Projects ---------------------------   
                                                                             
    Project                 Status                Actions                    
   -----------------------------------------------------------------------   
    📂 OASIS_3_ASL          Available             [ Open ]  [ 🗑️ Remove ]    
                                                                             
    📂 ADNI_Pilot           Available             [ Open ]  [ 🗑️ Remove ]    
                                                                             
    📂 old_study            [Moved or deleted]    [ Open ]  [ 🗑️ Remove ]    
                                                                             
                                                                             
================================================================================
```

### 1.2 Create New Project
1. User clicks "New Project".
2. Native folder dialog opens (Tauri `dialog` API). User selects a directory as `<project_root>`.
3. Frontend validates: directory is writable, not already a project (no existing `.easl`).
4. Frontend creates `<project_root>/derivatives/ExploreASL_GUI/` directory.
5. Initial `.easl` state file written with `currentPhase: "import"`.
6. Project added to recent projects list in global settings.
7. Router navigates to `/project/:id/import`.

### 1.3 Open Existing Project
1. User clicks "Open Project" on landing page.
2. Native file dialog opens, filtered to `.easl` files.
3. Alternatively: click a recent project from the list.
   - If the project root or `.easl` file no longer exists: "Project [name] was moved or deleted. Remove from recent projects?" Prompt with Remove / Cancel.
4. Frontend reads `.easl`, hydrates Zustand store.
5. Router navigates to `/project/:id/<currentPhase>`.

### 1.4 Global Settings
1. Accessible via gear icon in shell layout header.
2. Modal with fields:
   - **MATLAB Paths:** Add/remove MATLAB installations. "Detect" button runs `which matlab` (Linux) or equivalent. Multiple paths supported; user labels them (e.g., "R2023b", "R2024a").
   - **ExploreASL Path:** Path to ExploreASL installation directory (contains the `ExploreASL.m` entry point).
   - **Theme:** Toggle between Mantine light/dark themes.
3. Persisted via `@tauri-apps/plugin-store` to `<app-data-dir>/settings.json`. Never embedded in `.easl`.

### 1.5 Application Shell (Layout)
Persistent across all routes. Consists of:
- **Header:** Project name (if project loaded), settings gear icon.
- **Sidebar (when project loaded):** Phase navigation links (Import, Parameters, Processing), with current phase highlighted. Locked phases shown as disabled.
- **Main content area:** Route-specific content.
- **Status bar (bottom):** Processing indicator (idle/running/completed/failed), active project name, subject count.

## Component Tree

```
App
├── MantineProvider (theme)
├── Router
│   ├── Layout
│   │   ├── Header (project name, settings gear)
│   │   ├── Sidebar (phase nav) [conditional: shown when project loaded]
│   │   ├── StatusBar (processing state, project info)
│   │   └── <Outlet /> (route content)
│   └── LandingPage
│       ├── RecentProjectsList (Mantine Table or Card list)
│       ├── NewProjectButton
│       └── OpenProjectButton
├── SettingsModal
│   ├── MatlabPathList (add/remove/detect/detect-all)
│   ├── ExploreAslPathInput
│   └── ThemeToggle
└── ErrorBoundary (catches unhandled React errors, displays Mantine Alert)
```

## Data Model (Zod Schemas)

```typescript
// Global settings — persisted via @tauri-apps/plugin-store (platform app data dir)
const MatlabInstallation = z.object({
  id: z.string(),       // unique ID for this installation
  label: z.string(),    // user-facing name, e.g. "MATLAB R2024a"
  path: z.string(),     // absolute path to matlab executable
});

const GlobalSettings = z.object({
  matlabInstallations: z.array(MatlabInstallation).default([]),
  exploreAslPath: z.string().optional(),
  theme: z.enum(["light", "dark"]).default("light"),
  recentProjects: z.array(z.string()).default([]),  // paths to recent .easl files
});

// Project metadata — embedded in .easl
const ProjectMeta = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  lastOpened: z.string(),
  currentPhase: z.enum(["import", "parameters", "processing"]),
});
```

## State Shape (Zustand Slices)

```typescript
// globalSlice
interface GlobalState {
  settings: GlobalSettings;
  setMatlabInstallations: (installations: MatlabInstallation[]) => void;
  setExploreAslPath: (path: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  addRecentProject: (path: string) => void;
  removeRecentProject: (path: string) => void;
  loadSettings: () => Promise<void>;      // reads via plugin-store
  saveSettings: () => Promise<void>;      // writes via plugin-store
  detectMatlab: () => Promise<MatlabInstallation[]>;  // runs which matlab
}

// projectSlice
interface ProjectState {
  meta: ProjectMeta | null;       // null when no project loaded
  isDirty: boolean;               // unsaved changes exist
  loadProject: (easlPath: string) => Promise<void>;
  createProject: (rootPath: string) => Promise<void>;
  saveProject: () => Promise<void>;
  setPhase: (phase: string) => void;
}
```

## Frontend ↔ Backend API

### Custom Rust Commands

```
which_matlab() -> Vec<(String, String)>
  Runs `which matlab` (or `where matlab` on Windows). Returns list of (path, label) pairs.
  On Linux: also checks common install locations (/usr/local/MATLAB/R*/bin/matlab).

is_writable(path: String) -> bool
  Checks write permission on directory.
```

### Tauri Plugin APIs (used from frontend)

| Plugin | Used for |
|---|---|
| `@tauri-apps/plugin-dialog` | `open()` — folder selection (project root), file selection (`.easl` opening) |
| `@tauri-apps/plugin-fs` | `readTextFile`, `writeTextFile`, `exists`, `mkdir` — project `.easl` I/O |
| `@tauri-apps/plugin-store` | `Store.load("settings.json")` — global settings persistence (key-value store in platform app data dir) |

## Validation Rules

| Rule | Context |
|---|---|
| Project root must be an empty or non-project directory | New project creation |
| Directory must exist and be writable | Any path input |
| MATLAB path must point to executable `matlab` | Settings save |
| ExploreASL path must contain `ExploreASL.m` | Settings save |
| `.easl` file must be valid JSON with matching schema version | Project open |

## Error Handling

- **Directory not writable:** Mantine notification: "Cannot create project in [path]. Check permissions."
- **Invalid .easl file:** "Failed to open project. The file may be corrupted or from a newer version."
- **MATLAB not found:** Warning notification on settings save: "No MATLAB installations detected. Processing will not be available until configured."
- **ExploreASL not found:** Warning notification: "ExploreASL not detected at [path]. Import and processing will be unavailable."

## Out of Scope

- Auto-detection of ExploreASL installation (manual path entry only)
- Cloud project storage or sync
- Project templates beyond the empty skeleton
- Workspace trust / security prompts for external projects
- In-app ExploreASL version checking / update notifications

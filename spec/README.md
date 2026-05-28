# Spec Directory — Agent Instructions

**Read this first.** These files define the ExploreASL GUI. Load only what you need for the current phase — do NOT load all files at once. Context is limited.

## File Map

```
spec/
├── README.md                  ← YOU ARE HERE. Read first, always.
├── master.md                  ← Architecture, stack, routing, data flow, error strategy.
├── phase1-setup.md            ← Phase 1 spec: landing page, project CRUD, global settings, shell.
├── plan-phase1-setup.md       ← Phase 1 IMPLEMENTATION PLAN. Code, tasks, commits.
├── phase2-import.md           ← Phase 2 spec: DICOM→BIDS tokenizer, aliases, metadata, staging.
├── phase3-dataparams.md       ← Phase 3 spec: dataPar.json parameter forms.
├── phase4-processing.md       ← Phase 4 spec: execution dashboard, lock watcher, rollback.
```

## Reading Order

### Phase 1 (current)
```
1. README.md          ← You are here
2. master.md          ← Global architecture (load always, it's short)
3. phase1-setup.md    ← What to build
4. plan-phase1-setup.md ← HOW to build (exact code, step-by-step)
```
Do NOT load phase2-import.md, phase3-dataparams.md, or phase4-processing.md during Phase 1.

### Phase 2 (after Phase 1 complete)
```
1. README.md
2. master.md           ← Reload for cross-cutting concerns
3. phase2-import.md    ← The spec for this phase
```
A `plan-phase2-import.md` will be written when Phase 2 begins.

### Phase 3 & 4
Same pattern: master.md + the specific phase spec + its plan.

## Key Rules (from master.md)

- Rust is thin. Prefer Tauri built-in plugins (dialog, fs, os, store). Custom Rust only: subprocess, file watcher, `which_matlab`, `is_writable`.
- Project state: `.easl` JSON in `<root>/derivatives/ExploreASL_GUI/`. Global settings: Tauri plugin-store (auto-persisted).
- Import errors: stdout parsing. Processing errors: lock file watcher.
- Symlink tree always 4-level: Subject/Session/Run/Modality. Session/Run default to `01`.
- ExploreASL invoked as MATLAB subprocess: `ExploreASL(root, importModules, processModules, ...)`.
- Test data: `test/test_project_root/sourcedata/`

## Implementation Notes

- Dev: `pnpm tauri dev` → `http://localhost:1420`
- Test: `pnpm test` (Vitest + jsdom)
- Tauri APIs mocked in `src/test/setup.ts`

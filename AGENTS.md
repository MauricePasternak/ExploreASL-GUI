# AGENTS.md — ExploreASL GUI

Tauri v2 desktop GUI wrapping ExploreASL (MATLAB ASL MRI pipeline).

**Stack:** Tauri v2 + React 19 + TS 7 + Mantine 9 + Zustand 5 + Zod 4 + React Router 7
**Dev (Frontend):** `pnpm dev` → `http://localhost:1420`
**Specs:** `openspec/specs/` (authoritative), `openspec/changes/` (in-progress)

**Architecture:**

- Rust thin. Prefer Tauri plugins (dialog, fs) over custom commands. Custom: subprocess, file watcher, debug logs.
- Project state: `.easl` JSON in `<root>/project.easl`. Global settings: `@tauri-apps/plugin-store` (`settings.json` in app data dir).
- Import: MATLAB stdout parsing. Processing: lock file watcher (`.status` files).
- Staging tree: 4-level `Subject/Session/Run/Modality`. Session/Run default to `01`.
- ExploreASL invoked: `ExploreASL(root, importModules, processModules, ...)`.

**Terminology (GUI ↔ ExploreASL):**

| GUI/BIDS | ExploreASL | `tokenOrdering` |
| -------- | ---------- | --------------- |
| Subject  | Subject    | 1               |
| Session  | Visit      | 2               |
| Run      | Session    | 3               |
| Modality | Scan       | 4               |

GUI uses BIDS terms. ExploreASL docs use `[Subject, Visit, Session, Scan]`. Agents MUST translate.

**Test data:** `test/test_project_root/sourcedata/`. GENFI ASL dataset at `test/test_GENFI/` — see its `README.md` for subject details, ASL parameters, and M0 handling quirks.
**Testing:** `pnpm test` (Vitest + jsdom). Mock Tauri APIs in `src/test/setup.tsx`. UNIT TEST schemas, stores, utilities. Component tests for critical paths. Note: Frontend tests currently take around 20 seconds to complete, so do not assume the test runner has hung.
**Test isolation:** No global autounmount. Mount tests need local `afterEach(cleanup)` to prevent stale Zustand subscriptions/render loops.

---

## Rules

- `pnpm test` for testing
  - focus on running specific test files and test cases, not the entire test suite UNLESS it is to finish up a task set or the bug likely affects multiple test files.
- `pnpm lint` for linting
- `pnpm typecheck` for type-checking
- `pnpm format` for formatting
- All components should have a `data-testid` attribute for testing and easier referencing for agents.
- Git commits cannot be made without explicit user confirmation and must follow conventional commit message format.
- No sync `setState` in `useEffect`. Sync state in render or use component `key`.
- No ref update/access in render. Use `useEffect` to update refs.
- Complete hook dependencies. Use Ref Sync pattern for non-reactive reads.
- Never hardcode `"/tmp/"` or other filepaths. Make use of the correct tauri/rust filesystem functions.

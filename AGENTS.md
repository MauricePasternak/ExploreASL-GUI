# AGENTS.md — ExploreASL GUI

Tauri v2 desktop GUI wrapping ExploreASL (MATLAB ASL MRI pipeline).

**Stack:** Tauri v2 + React 19 + TS 6 + Mantine 9 + Zustand 5 + Zod 4 + React Router 7
**Dev:** `pnpm tauri dev` → `http://localhost:1420`
**Specs:** `spec/master.md`, `spec/phase{1..4}-*.md`, `spec/plan-phase1-setup.md`

**Architecture:**
- Rust thin. Prefer Tauri plugins (dialog, fs) over custom commands. Custom: subprocess, file watcher, debug logs.
- Project state: `.easl` JSON in `<root>/derivatives/ExploreASL_GUI/`. Global settings: `@tauri-apps/plugin-store` (`settings.json` in app data dir).
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
**Testing:** `pnpm test` (Vitest + jsdom). Mock Tauri APIs in `src/test/setup.ts`. UNIT TEST schemas, stores, utilities. Component tests for critical paths.

---

## Debug

**Frontend (`src/lib/debug.ts`):**
- Console bridge → Tauri log plugin
- Action replay log (500 entries)
- `Ctrl+Shift+D` → copies store snapshot JSON
- `window.__DEBUG__` → stores, log, route, `snapshot()`

**Rust (`src-tauri/src/tracing.rs`):**
- `CommandTrace` wraps every command: name, args, result/error, duration

**Logs:**
| Mode    | Location                                    |
| ------- | ------------------------------------------- |
| Dev     | `/tmp/opencode/exploreasl-gui-logs/dev.log` |
| Release | OS app data dir                             |

**Error Boundary:** Catches React errors. "Copy error report" → clipboard JSON.

---

## Agent Can / Cannot

**Can:**
1. Read dev logs (predictable path)
2. Run `pnpm test`
3. `cargo check`
4. Screenshot `localhost:1420` in `pnpm dev` (no Tauri APIs)
5. Read/write source files

**Cannot:**
1. Start `pnpm tauri dev` (needs desktop window)
2. Screenshot real Tauri window chrome
3. Trigger OS ops (fs writes, MATLAB subprocess)
4. Access persistent app data
5. Interact with native dialogs via Puppeteer (use E2E for that)

**Puppeteer:** Landing page CSS + `window.__DEBUG__` reading only. Full app needs Tauri APIs.

**E2E (WebdriverIO + tauri-driver):** `e2e-tests/` directory. Uses `tauri-driver` → `WebKitWebDriver` to automate the native Tauri window. Can click buttons, read native elements, interact with native dialogs. Run: `cd e2e-tests && pnpm test` (or `pnpm test:e2e` from root). Requires a debug build at `src-tauri/target/debug/exploreasl_gui`.

---

## Debugging Flow

| Issue         | User action                                          | Agent action                                     |
| ------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Crash         | Click "Copy error report" → paste JSON               | Read error + component stack                     |
| UI wrong      | Screenshot Tauri window → describe                   | Read component code                              |
| Rust cmd fail | Paste relevant `[COMMAND]` lines, or agent reads log | Read `/tmp/opencode/exploreasl-gui-logs/dev.log` |
| State bug     | `Ctrl+Shift+D` → paste JSON snapshot                 | Reconstruct from stores + action log             |
| Visual verify | User confirms in real app                            | Fix → `pnpm test` → optional Puppeteer           |

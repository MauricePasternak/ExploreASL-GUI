# AGENTS.md — ExploreASL GUI

Tauri v2 desktop GUI wrapping ExploreASL (MATLAB ASL MRI pipeline).

**Stack:** Tauri v2 + React 19 + TS 6 + Mantine 9 + Zustand 5 + Zod 4 + React Router 7
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
| Subject | Subject | 1 |
| Session | Visit | 2 |
| Run | Session | 3 |
| Modality | Scan | 4 |

GUI uses BIDS terms. ExploreASL docs use `[Subject, Visit, Session, Scan]`. Agents MUST translate.

**Test data:** `test/test_project_root/sourcedata/`. GENFI ASL dataset at `test/test_GENFI/` — see its `README.md` for subject details, ASL parameters, and M0 handling quirks.
**Testing:** `pnpm test` (Vitest + jsdom). Mock Tauri APIs in `src/test/setup.tsx`. UNIT TEST schemas, stores, utilities. Component tests for critical paths.
**Known test artefact:** React 19 + jsdom teardown race causes `ReferenceError: window is not defined` in 0–7 unhandled exceptions per run. These are NOT test failures — they fire when React's scheduler accesses `window` after jsdom teardown between parallel test files. Ignore.
**Test isolation:** No global autounmount. Mount tests need local `afterEach(cleanup)` to prevent stale Zustand subscriptions/render loops.

---

## Rules

- Use `pnpm` to run commands (test, lint, format, etc.)
- All components should have a `data-testid` attribute for testing and easier referencing for agents.
- Git commits cannot be made without explicit user confirmation and must follow conventional commit message format.
- Always format the code after making changes. Run `pnpm format` for frontend files (TS, TSX, CSS, JSON, Markdown) and `pnpm lint:rust` to lint and format backend Rust files.
- No sync `setState` in `useEffect`. Sync state in render or use component `key`.
- No ref update/access in render. Use `useEffect` to update refs.
- Complete hook dependencies. Use Ref Sync pattern for non-reactive reads.

---

## Debug

Refer to [DEBUGGING.md](file:///mnt/Samsung_NVME_4TB/ExploreASL_GUI/notes/DEBUGGING.md) for full flow and tools.

**Frontend (`src/lib/debug.ts`):**

- Console bridge → Tauri log plugin
- Action replay log (500 entries)
- `window.__DEBUG__` → stores, log, route, `snapshot()`

**Rust (`src-tauri/src/tracing.rs`):**

- `CommandTrace` wraps every command: name, args, result/error, duration

**Logs:**
| Mode | Location |
| ------- | ------------------------------------------- |
| Dev | `<OS temp dir>/exploreasl-gui-logs/dev.log` |
| Release | OS app data dir |

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

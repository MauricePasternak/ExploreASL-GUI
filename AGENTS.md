# AGENTS.md — ExploreASL GUI

Tauri v2 + React 19 + TS 7 + Mantine 9 + Zustand 5 + Zod 4 + React Router 7.
GUI wrapping ExploreASL (MATLAB ASL MRI pipeline). Specs in `openspec/specs/` are authoritative.

## Commands & Quality Checks

- Dev: `pnpm dev` (`http://localhost:1420`)
- Test: `pnpm test:frontend <file>` (Vitest; run targeted tests, not full suite unless finishing). Backend: `pnpm test:backend` (or `cargo test --manifest-path src-tauri/Cargo.toml`). Full suite: `pnpm test`.
- Lint/Type/Format: `pnpm lint` (`lint:frontend` | `lint:backend`) | `pnpm typecheck` | `pnpm format` (`format:frontend` | `format:backend`)
- Git: Conventional commits; require explicit user confirmation before committing.

## Architecture & Domain

- State: `.easl` in `<root>/project.easl`. App settings: `@tauri-apps/plugin-store`.
- Staging: 4-level `Subject/Session/Run/Modality` (Session/Run default to `01`).
- Prefer Tauri plugins (dialog, fs) over custom Rust commands.
- Never hardcode filepaths like `"/tmp/"`; use Tauri filesystem APIs.

| GUI/BIDS | ExploreASL | tokenOrdering |
| -------- | ---------- | ------------- |
| Subject  | Subject    | 1             |
| Session  | Visit      | 2             |
| Run      | Session    | 3             |
| Modality | Scan       | 4             |

_Agents MUST translate between BIDS and ExploreASL terms._

## Rules

### Core

- Evidence-based decision-making; **back up your claims with code references**.
- Never add implied complexity (i.e. atomic operations, provenance tracking) without explicit user confirmation.
- This codebase currently suffers from over-engineering, excessive complexity, and unnecessary indirection. Seek to simplify and streamline wherever possible.

### Frontend & Testing

- Add `data-testid` on all components. Dynamic imports forbidden.
- No sync `setState` in `useEffect` (sync in render or use component `key`).
- No ref access/mutation in render; complete hook dependencies (Ref Sync pattern for non-reactive reads).
- Test isolation: Mount tests require local `afterEach(cleanup)` (no global autounmount; prevents Zustand loops).
- Test data: `test/test_project_root/sourcedata/` and GENFI at `test/test_GENFI/`.

### Backend

- See `openspec/specs/` before altering runtime execution, capability operations, or process handling.
- Rust tests: `<module>_test.rs` for small modules, `<crate>/tests/<module>.rs` for packages. No large test suites in production files.

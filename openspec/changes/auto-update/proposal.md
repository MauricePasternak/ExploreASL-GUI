# Auto-update proposal

## Why

Public releases need a safe path from installed builds to newer signed releases without exposing projects to interrupted work or unsigned artifacts.

## What changes

- Add Tauri updater and process plugins with signed GitHub Release metadata.
- Check once after production settings startup; skip development and E2E.
- Present a ten-second lower-right update notification and guarded install flow.
- Build signed updater artifacts for Linux x64, Windows x64, macOS arm64, and macOS Intel.

## Impact

- Affected code: app startup, project/import/processing coordination, Tauri config/capabilities, release workflow, tests.
- Affected security boundary: updater verification requires Tauri signing keys; no unsigned updater fallback.

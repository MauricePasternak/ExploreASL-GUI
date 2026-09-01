## 1. Version Boundary

- [x] 1.1 RED: Add focused schema tests for valid v1, supported `0.1.0`, malformed JSON/envelopes, malformed supported payloads, and future schema versions; verify the new cases fail for the expected missing distinctions.
- [x] 1.2 GREEN: Implement minimal envelope classification, typed unsupported/malformed errors, and separate legacy and v1 schemas; verify the focused version-boundary tests pass.

## 2. Pure Migration and Serialization

- [x] 2.1 RED: Add migration tests proving preservation of mapping state, `dataPar`, import/processing/visualization state, reviewer registry, verdicts, and module metadata, plus rejection of invalid valuable mapping fields; verify the new cases fail before migration exists.
- [x] 2.2 GREEN: Implement ordered legacy-to-v1 migration and full-result v1 validation without fallback-on-invalid mapping values; verify migration preservation and failure tests pass.
- [x] 2.3 RED: Add tests proving v1 output uses `schemaVersion: 1`, omits legacy `version` and persisted `rootPath`, excludes runtime-only fields, and produces byte-identical canonical output across repeated migrations; verify the new cases fail before the DTO serializer exists.
- [x] 2.4 GREEN: Implement the explicit persisted v1 DTO and deterministic canonical serializer; verify schema shape and byte-determinism tests pass.

## 3. Import Snapshot Migration

- [x] 3.1 RED: Add tests for valid compressed snapshots, valid legacy object snapshots, invalid base64/gzip/JSON/snapshot shapes, and canonical compressed output; verify invalid data is currently dropped and object data is not preserved.
- [x] 3.2 GREEN: Implement validated snapshot decoding, legacy object preservation, and deterministic compressed serialization; verify all snapshot migration tests pass without null fallback for malformed persisted values.

## 4. Read-Only Project Opening

- [x] 4.1 RED: Add project-store tests proving successful v1 and legacy opens derive runtime root from the selected `project.easl` parent, preserve deterministic state, and never call a write API; add equivalent no-write assertions for malformed and future files and verify they fail against current `loadProject`.
- [x] 4.2 GREEN: Route project creation and loading through the v1 parser, migration, hydration, and serializer boundaries; remove open-time `lastOpened` rewriting and verify focused project-store tests pass.
- [x] 4.3 GREEN: Update affected test factories and fixtures to distinguish legacy and v1 project files; verify existing project, import, processing, visualization, and manifest persistence tests remain green without weakening production validation.

## 5. Verification

- [x] 5.1 Run focused schema, snapshot, and project-store tests, then run `pnpm typecheck`; verify all commands pass.
- [x] 5.2 Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm spec:validate:all`; verify the complete frontend and OpenSpec gates pass.
- [x] 5.3 Perform an independent review against every `project-store` and `import-rerun` delta scenario, fix identified defects, and verify the review has no unresolved correctness or data-loss findings.

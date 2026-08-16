# Native E2E tests

Native E2E tests use WebdriverIO, `tauri-driver`, and a compiled Tauri window. Run commands from
repository root. Do not embed machine-specific paths; use the overrides below.

## Prerequisites

- Node 22 and pnpm 11.11.0.
- Rust/Cargo, Tauri platform dependencies, and `tauri-driver` available on `PATH` or through
  `E2E_TAURI_DRIVER`.
- Linux: WebKitGTK WebDriver and a display. CI supplies `webkit2gtk-driver` and runs under Xvfb.

Install dependencies:

```sh
pnpm install
pnpm --dir e2e-tests install
```

## Run

```sh
pnpm test:e2e:unit
pnpm typecheck:e2e
pnpm test:e2e
```

`pnpm test:e2e` builds a debug, non-bundled native app first. To build once and reuse it:

```sh
VITE_E2E=1 pnpm tauri build --debug --no-bundle
E2E_SKIP_BUILD=1 pnpm test:e2e
```

`E2E_SKIP_BUILD=1` skips only the WebdriverIO `onPrepare` build and requires an existing E2E
build. The build helper always sets `VITE_E2E=1`.

## E2E gate and production check

The bridge is installed and dynamically loaded only when `VITE_E2E === "1"`. Normal builds must
not enable it. Check the production bundle with:

```sh
pnpm build && pnpm check:e2e-bundle
```

The bundle check rejects E2E bridge, scenario, and fixture markers.

## Bridge, routing, and scenarios

The enabled app exposes `window.__E2E__`:

- `ready()` waits until the app reports its current route.
- `reset()` clears stores and returns to `/`.
- `seed("manifest-disagreements")` loads the current named fixture.
- `navigate(path)` uses the app router.
- `currentRoute` and `currentScenario` expose readiness diagnostics.

WDIO support functions wrap this API: `resetToLanding()` and
`resetAndLoadScenario(scenario, route)`. Pass router paths with a leading `/`, not a hash. The
app uses `createHashRouter`, so navigating to `/overview` produces a browser URL ending in
`#/overview`; `currentRoute` reports the logical router location. Do not manipulate the URL as a
history-router path or add duplicate routes.

To add a named scenario, add its literal and seed implementation in `src/e2e/bridge.ts`, extend
the typed support helper in `test/support/application.ts`, then add a descriptive
`test/specs/<name>.e2e.ts` test using the reset/seed helper. Add bridge unit coverage in
`src/e2e/bridge.test.ts`.

## Artifacts and path overrides

Failed tests write sanitized test-title artifacts (`.png`, `.html`, `.json`) to
`e2e-tests/artifacts/` by default. Override the directory with
`E2E_ARTIFACT_DIR=<artifact-dir>`.

- `E2E_APP_PATH=<native-app>` overrides the debug application path.
- `E2E_TAURI_DRIVER=<driver>` overrides `tauri-driver`.
- Without overrides, application and driver names/suffixes resolve for the current platform;
  driver lookup checks `PATH`, then `CARGO_HOME`, then the user Cargo bin directory.

## CI

CI installs native dependencies, Rust, `tauri-driver`, and both lockfiles; runs helper tests and
E2E typecheck; builds with `VITE_E2E=1`; then runs
`xvfb-run -a env E2E_SKIP_BUILD=1 pnpm test:e2e`. Failure artifacts upload from the default
artifact directory.

Browser Playwright tests and a platform IPC shim are intentionally deferred: production has broad
direct Tauri IPC dependencies. Native WDIO is authoritative now.

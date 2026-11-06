# Native E2E tests

Native E2E tests use WebdriverIO, `tauri-driver`, and a compiled Tauri window. Run commands from
repository root. Do not embed machine-specific paths; use the overrides below.

## Prerequisites

- Node 22 and pnpm 12.16.1.
- Rust/Cargo, Tauri platform dependencies, and `tauri-driver` available on `PATH` or through
  `E2E_TAURI_DRIVER`.
- Linux: WebKitGTK WebDriver and a display. CI supplies `webkit2gtk-driver` and runs under Xvfb.
  The harness selects X11 explicitly, including when launched from a Wayland desktop.

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

On headless Linux, use `xvfb-run -a dbus-run-session -- pnpm test:e2e`. A private D-Bus
session also avoids single-instance collisions with an already-running desktop app.

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
WebdriverIO logs and `tauri-driver-<worker-pid>.log` are saved there even when session creation
fails, before screenshots or page diagnostics are available. Unix teardown stops the driver's
own process group so failed startup cannot leave its native app running.
Startup rejects an already-occupied driver port rather than attaching to another driver's app
and inheriting its settings environment.

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

## Opt-in real analysis (slow, Linux only)

Fast `test:e2e` never discovers the real-analysis spec or downloads its inputs. Explicit run:

```sh
E2E_SIF_PATH=/absolute/path/to/compiled-exploreasl.sif \
E2E_SIF_SHA256=<64-character-sha256> \
E2E_ANALYSIS_DATASET=/optional/read-only/local/ds003151 \
xvfb-run -a dbus-run-session -- pnpm test:e2e:full-analysis
```

Requires working host Apptainer (`E2E_APPTAINER_PATH` optionally overrides the GUI profile's
executable), enough free RAM/disk for MATLAB Runtime and processing, and network access for
missing fixture files. No licensed MATLAB or compiler is launched. Supplied SIF must contain
`/opt/xasl/xASL_latest/run_xASL_latest.sh`, `VERSION_*`, and runtime `/opt/mcr/v97/`.
Beta SIF checksum used by the successful local integration run (see qualification status below):
`ca88e7a7bf1eef259f05f5ed9894f7b7b9a03329217e499c486fdbaa24de6bf4`.
No public download URL currently exists for that custom image; obtain it separately.

Runner verifies the SIF before launch, builds unless `E2E_SKIP_BUILD=1`, then creates a fresh
disposable project and isolated HOME/XDG settings/cache/runtime/temp/MCR paths **before** starting
WDIO, its driver, or the app. Settings are configured through the real GUI. No bridge seed, IPC
shim, fake executor, ready marker, or historical derivative is used. Do not run this inside the
`native_gui` Bubblewrap sandbox or relax host/sandbox security to make Apptainer work.
Driver/app working directory is isolated temp, not the repository; Apptainer's automatic CWD
bind must not accidentally expose the checkout or original dataset to scientific workers.
`APPTAINER_HOME` explicitly binds the isolated home at its own path inside the container;
changing host `HOME` alone does not replace Apptainer's passwd-derived home mount. Container
`TMPDIR` also points inside that bound home. Runtime paths use short OS-temp directories to
avoid Unix socket path-length limits; settings/native logs copy into the artifact directory
after WDIO exits. Runtime/home caches remain at their separately printed path for diagnosis.

Fixture: OpenNeuro `ds003151`, CC0, release 2.0.1, metadata commit
`8e9c27bfceeedbd9ab814a08272d5ed1782f221d`. Only `sub-170/ses-hormoneabsent` and
`sub-172/ses-hormoneabsent`: one T1w, PASL timeseries with included M0, and exact JSON/context
per BIDS session (= ExploreASL Visit), plus root description/README. Each timeseries contains
one M0 volume followed by 44 label/control pairs. Four images total (~31 MiB), fetched from public
OpenNeuro S3; metadata fetched at the pinned Git commit. Images were verified against pinned
git-annex MD5E keys; every file now has a fixed size/SHA256, including local reuse. A present but
altered local file fails rather than silently replacing it. Originals remain read-only; no
symlinks or hardlinks to scientific inputs. Participants metadata is not copied from the full
cohort; the GUI generates derivative participants for the selected subset.
The two source slice-timing arrays differ, so metadata review retains two acquisition groups.

Workflow: onboarding → valid Apptainer profile → manual folder path → reviewed BIDS setup →
metadata/subject review → Parameters (explicit low-quality try-out, extracted M0, Total atlas) →
Structural + ASL (one worker) → Population independently, as required by product eligibility.
Source `M0Type: Included` is preserved; the engine's BIDS2Legacy step extracts derivative `M0.nii`
before ASL processing, which uses the `separate_scan` calibration option.
The test waits for settled/acknowledged successful native results, GUI completion indicators,
fresh module locks, readable CBF NIfTI data and QC JSON, Population mean template and ROI tables.
Read-only durable result inspection supplements GUI status; it never starts or changes work.
Each run is bounded at 90 minutes; the whole Mocha case at 95 minutes. Failure teardown requests
GUI Stop and project close. Project/settings/log artifacts stay under the printed
`e2e-tests/artifacts/full-analysis-*` directory, on success too. Never delete that directory
until scientific workers have settled; interrupted WebDriver/app termination may require manual
inspection. No global process kill or automatic project cleanup is performed.

**Scientific limit:** this is integration/execution/output-readability coverage, not scientific
qualification or numerical equivalence. Acquisition metadata is unchanged: `RepetitionTime` and
`RepetitionTimePreparation` both equal 4 s, but matching values alone do not validate timing or
calibration. The successful run inferred the readout from `PulseSequenceType: "ASL"`, warned about
inconsistent slice timings, assumed zero background-suppression pulses for 2D despite the source
suppression flag, and applied the Siemens factor-10 M0 correction. Visual QC also warned about high
intensities in sub-172's SNR image. These observations and PASL bolus timing require separate
scientific assessment. Quantification is not disabled, no acquisition values are patched, and no
CBF range/golden is asserted. Low-quality mode does not qualify a clinical/research protocol.

CI: manually dispatch **CI** with `full_analysis=true`, an accessible HTTPS `sif_url`, and its
`sif_sha256`. Missing/invalid inputs fail; no invented URL or silent skip. PR/push jobs stay fast.
The existing native E2E job installs Apptainer only for this opt-in, checks the SIF download,
runs the same isolated command, and uploads diagnostics plus project output (excluding large
runtime caches). Hosted runner capacity and image compatibility remain prerequisites.

### Qualification status

**Local native GUI integration passed on 2026-11-06:** both subjects completed Structural + ASL,
then the separate Population run completed. WDIO reported one passing test in 16m 42.8s (16m 44s
including startup/teardown). Both native results were acknowledged `completed`, with zero failed
workers and expected target counts of four and one. Fresh module locks, readable CBF and Population
NIfTIs, QC JSON, Population mean template, and Total ROI statistics passed their assertions.
All ten fixture inputs remained byte-identical after processing; persisted metadata retained
`BolusCutOffTechnique: "PICORE"` in both groups. Scientific qualification remains separate.

Successful artifacts: `e2e-tests/artifacts/full-analysis-lMdunL/`, including
`full-analysis-completed.png`, the `ds003151/` project and outputs, and native log
`data/com.mpasternak.exploreasl-gui-v0/logs/exploreasl_gui.log`. The log records worker exit zero
and completed settlement at lines 3382–3385 and 3668–3671; project closure succeeded at line 3687.
Hosted full-analysis CI has not been exercised; it still needs an accessible pinned SIF URL.

Dashboard status retention is now verified: after Population, the test and inspected final
screenshot show all four Structural/ASL cells still Complete, 2 of 2 sessions ready, and Population
Complete. The bounded fix preserves subject-module presentation through Population-only snapshots
without retaining historical Population target progress or changing subject-module rerun invalidation.

[BIDS defines BolusCutOffTechnique as a string](https://github.com/bids-standard/bids-specification/blob/master/src/schema/objects/metadata.yaml),
not an exclusive enum. The native project model, frontend schema, and editor now preserve free
strings; regression checks cover scan, editing, save/reopen, and studyPar preservation. The test
also waits for expanded metadata values to be displayed/stable and fails promptly on scan errors.
Native processing derives `subjectFolder` in the executor namespace (host root for MATLAB,
existing `/data` binding for Apptainer), without extra binds or duplicated rawdata.

The former Penn LEAD fixture remains blocked by the compiled engine's separate-M0
`path_intended_for` parser bug (`e2e-tests/artifacts/full-analysis-axYR0V/`). ds003151's included M0
avoids that branch without a container rebuild or acquisition changes. Do not patch acquisition
metadata, seed completion, disable quantification, or weaken the test to bypass failures.

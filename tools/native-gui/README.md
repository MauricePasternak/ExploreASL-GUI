# Native GUI agent tools

Project-local MCP server for interactive **Linux Tauri/WebKit** viewing and input.
Reuses WebdriverIO and native driver helpers from `e2e-tests/`; no app runtime changes,
browser IPC shim, or automatic app builds. Own package/lockfile isolates installation
from concurrent feature work.

## Setup

Requirements: Node/pnpm, `tauri-driver`, `WebKitWebDriver`, `bwrap`, `dbus-run-session`,
`xvfb-run`, `Xvfb`, and `xauth` (Debian/Ubuntu: `sudo apt install xvfb xauth`).
Launches use their own authenticated 1920×1080 virtual display by default; no desktop
login, `DISPLAY`, or `XAUTHORITY` configuration is needed. These are real native
Tauri/WebKit windows, viewed through `inspect` and `screenshot`, not browser substitutes.
Server-side GLX is disabled to avoid probing host GPU drivers from the private device
namespace; WebKit's EGL-based WebGL rendering remains available.

```sh
pnpm --dir tools/native-gui install --frozen-lockfile
pnpm --dir tools/native-gui test
pnpm --dir tools/native-gui typecheck
pnpm --dir tools/native-gui smoke
```

Uses existing `src-tauri/target/debug/exploreasl_gui`, or `E2E_APP_PATH` override.
If no suitable binary exists, coordinate with the feature agent before building:

```sh
VITE_E2E=1 pnpm tauri build --debug --no-bundle
```

Build embeds the current frontend. After feature changes, rebuild then close/relaunch
the controller window to view them. Controller never rebuilds shared `dist/` or Cargo
output itself. Close/relaunch reuses this OpenCode session's workspace and saved settings.
E2E bridge is optional; when available, navigation reuses its readiness API and controller
restores its own saved settings after E2E bootstrap defaults. `app-ready` is startup gate.

Local OpenCode configuration: `.opencode/opencode.jsonc`, MCP server `native_gui`
(this config file is ignored by Git). Add this entry on other checkouts:

```jsonc
{
  "mcp": {
    "servers": {
      "native_gui": {
        "type": "local",
        "cwd": "tools/native-gui",
        "command": ["node", "--import", "tsx", "server.ts"],
      },
    },
  },
}
```

Reload/reconnect through `/mcps` if tools do not appear. Native tools use Code Mode;
inspect discovered signatures before calling, for example `tools.native_gui.launch()`.
MCP command uses `node --import tsx`, not package-manager script banners, to keep stdout
protocol-only.

Do not hardcode `DISPLAY` or GNOME's temporary `.mutter-Xwaylandauth.*` filenames in
MCP configuration. Remove old overrides; virtual mode ignores inherited desktop values.

For a window visible on your desktop, explicitly call `launch({ display: "desktop" })`.
This mode needs the current graphical session's `DISPLAY` and `XAUTHORITY` (or host
`~/.Xauthority` if unset). The authority file is exposed read-only inside the sandbox,
including when its host path is under a hidden temporary directory. A long-running
OpenCode service can retain stale session variables; opening a new terminal client
does not refresh that service's environment. Use virtual mode for unattended checks.
Neither mode changes desktop access permissions or disables X authentication.

## Agent workflow

1. `launch`: starts a private virtual display/window; returns isolated workspace and application path.
2. `inspect`: visible text, labels, values, disabled/checked state, CSS selectors.
3. `click`, `fill`, `select`, `keys`, `wait`: real WebDriver input and bounded waits.
4. `screenshot`: PNG image plus saved artifact path.
5. `close`: normal project shutdown, then window/driver disposal.

### Sizing and read-only evidence

```ts
await tools.native_gui.launch({
  screen_size: { width: 3840, height: 3840 }, // Virtual framebuffer capacity, selected once.
  window_size: { width: 800, height: 1200 }, // Native window request, not CSS viewport.
});
await tools.native_gui.resize({ width: 3840, height: 2160 });
await tools.native_gui.inspect({
  selector: '[data-testid="settings-modal"]',
  styles: ["display", "overflow", "color"],
  include_hidden: true,
  limit: 100,
});
await tools.native_gui.diagnostics();
```

Window and screen dimensions must be integers from 1–4096 per axis (at most
4096² framebuffer pixels). Defaults remain unchanged: 1920×1080 virtual screen,
app-selected window size. `screen_size` is virtual-only; desktop mode changes only
the app window, never the user's display. Live resize exceeding virtual capacity
fails with explicit close/relaunch guidance; it never recreates the window or resets
state. Portrait/large windows are layout checks, **not tablet, touch, or device emulation**.

Launch/resize return observed native window rect, CSS viewport/screen, device pixel
ratio and visual-viewport scale, plus requested size and virtual capacity. WebDriver
window units are reported separately from image pixels; do not infer screenshot size
from the request. OS constraints, scaling and docked devtools affect the result.
The current debug build opens devtools automatically: tested 800×1200 native window
produced 800×900 CSS viewport; 3840×2160 produced 3840×1860, DPR 1. App bootstrap is
unchanged. `screenshot` text is JSON containing `path`, actual PNG `image` dimensions
(image pixels), and best-effort live `metrics`; image content remains PNG.

Inspection adds CSS-pixel bounds, focus, per-element/document scroll offsets,
`visible`, `inViewport` and `center_hit`. Hidden, offscreen and covered are distinct;
center-point sampling **does not guarantee clickability** or detect every overlap.
Default inspection excludes hidden elements but includes offscreen ones; `include_hidden`
includes hidden controls without exposing arbitrary HTML. `styles` accepts at most 12
CSS property names, each value capped at 500 characters. Existing 500-element/8000-text
limits remain; control values cap at 2000 characters, labels/text at 200. Password
values remain redacted. Numeric DOM values (such as list-item ordinals) remain numeric.
Inspection validates a unique root and never scrolls/focuses.
Selectors cap at 4096 characters (`null` if structural fallback exceeds that bound).

Diagnostics report workspace, observed driver process status, and live route/metrics
only when short read-only protocol probes succeed (1.5 s per probe). A cached connection
is not proof of browser liveness. Before launch, workspace/logs are empty; after
close/crash/failed launch, existing workspace logs remain readable. Fixed allowlist:

- `driver.log` (driver/Xvfb output; **not a reliable app console log**)
- `exploreasl-gui-logs/dev.log` (existing debug native logger)
- `data/<Tauri identifier>/logs/<product name>.log` (existing application logger)

Each tail reads at most 16 KiB from source and returns at most 100 lines. Byte-capped
tails retain partial-record suffixes, skipping any initial split UTF-8 codepoint.
No arbitrary file input, archive/host-log traversal, environment or Xauthority inspection. Missing,
non-regular or symlink-escaping files report unavailable independently. Logging paths
follow `src-tauri/src/app/logging.rs`; older binaries may lack one or both native logs.

Failed tool execution preserves its original error and `isError=true`, returning
`evidence` with bounded diagnostics, artifact paths and capture errors. Best-effort
PNG, 40-element password-redacted DOM, and diagnostics JSON save under owned workspace
`failures/`; no successful-action tracing. Startup errors capture evidence before driver
cleanup; tool dispatch reuses that evidence rather than recapturing a closed window.
Capture never scrolls, navigates, closes,
or mutates app/project state. Unreachable browser probes time out; capture/write failure
cannot replace the action error. MCP schema-validation errors occur before tool execution
and do not capture evidence. Read-only probes use fixed loopback WebDriver endpoints,
not a general JS/IPC interface. Responses cap at 1 MiB (96 MiB for PNG protocol payloads).
Aborting a read-only HTTP probe does not cancel work already accepted by the driver.
Artifact files/logs can contain displayed study text or console content; password-value
redaction is not general secret scrubbing. Keep disposable artifacts private.

Prefer unique `[data-testid="..."]` selectors from inspection. CSS only; no arbitrary
JavaScript evaluation or XPath input. `select` handles native HTML selects; Mantine
comboboxes require clicking trigger, inspecting options, then clicking desired option.
`wait` text uses DOM `textContent`, matching native E2E tests; WebKit can return empty
`getText()` for rendered buttons. `navigate` accepts logical routes such as `/overview`,
not full URLs or hash-prefixed paths, and does not bypass project-access checks.

`copy_project` copies a directory containing `project.easl` into writable workspace,
preserves dataset directory name, and adds the copy to isolated **Recent Projects**.
Open it using its Recent Projects button; normal validation/access checks still apply.
For repository datasets, call it with `test/ds000240`, `test/ds007116` or `test/test_GENFI`
(absolute source paths also work). Copies may be several GB; filesystem reflinks are
attempted when supported, otherwise normal copies are made. Native choosers still need
manual help or existing native E2E setup. Settings start empty unless a profile template
is explicitly supplied; personal settings are never imported automatically.

### Vanilla or pre-seeded launch

```ts
await tools.native_gui.launch(); // Empty settings on first launch; saved sandbox settings on relaunch.
// Close the window before any subsequent launch.
await tools.native_gui.close();
await tools.native_gui.launch({ fresh: true }); // New vanilla workspace, including first-run onboarding.
await tools.native_gui.close();
await tools.native_gui.launch({ profile_template: "/path/to/settings.json" }); // New workspace with saved profiles.
```

`profile_template` accepts an absolute or repository-relative JSON file path. Reuse
an existing app/sandbox `settings.json`, or create a file containing only:

```json
{
  "executionProfiles": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "matlab",
      "label": "Local MATLAB",
      "matlabPath": "/path/to/MATLAB/bin/matlab",
      "exploreAslPath": "/path/to/ExploreASL"
    }
  ]
}
```

Configure these paths once, then reuse the same template for different agents.
Both MATLAB and Apptainer profiles use the app's existing profile schema. Templates
must contain at least one profile; malformed templates fail launch. Only
`executionProfiles` is copied, never recent projects, other preferences, or cached
validation. Normal native profile validation still runs; unavailable installations
remain invalid and project actions stay gated. Installations must be visible inside
the sandbox (host temporary directories are hidden).

`fresh: true` and any `profile_template` launch create a **new** workspace without
deleting or changing the previous one. Supplying both starts fresh **with** the
template. Plain `launch()` after `close()` reuses the latest workspace and its saved
settings. An invalid profile template leaves that reusable workspace unchanged.
Profile seeding requires no app rebuild; reconnect the MCP server via
`/mcps` after controller changes so agents see the updated launch arguments.

Existing repository sample `.easl` files may be schema version 1, while current native
model requires version 2. Copier deliberately preserves metadata; it does not migrate
or reset projects. Use compatible app build or initialize **copied** metadata using
current native/test setup before opening. Original datasets remain untouched.

## Isolation and limits

- Each OpenCode session metadata ID owns its own window, driver ports and workspace.
  Calls on one window serialize; different agents can operate simultaneously. Non-OpenCode
  stdio clients without metadata share one window per connection. Session IDs route
  requests, not authenticate users.
- Bubblewrap mounts host filesystem read-only, with writable disposable workspace and
  private temporary files. Workspace is app `$TEMP`, matching existing Tauri filesystem
  permissions. Private D-Bus avoids app single-instance collision. No unsafe
  unsandboxed fallback. Home, settings, cache and runtime directories are session-local.
- Host filesystem reads remain possible outside private temporary mounts, subject to
  app's existing Tauri permission scopes; direct writes are rejected. Symlinks in copied
  projects remain symlinks; external targets stay read-only.
  Host temporary directory is hidden by a private mount, so builds/data located there
  are not visible. Xvfb and its authority file start inside this sandbox; the existing
  PID namespace disposes the virtual display with the window. Desktop mode uses X11
  and needs a running X server, such as XWayland on a Wayland desktop.
- Screenshots cover webview, not OS chooser/decorations. Inspection is DOM-based, not full
  OS accessibility tree. No native-dialog automation. DOM selector fallback uses structure
  when unique test ID/id is unavailable; inspect again after substantial DOM changes.
- Filesystem protection is not a hostile-code sandbox: network, display, and host sockets
  remain accessible. Use trusted app builds; scientific/container execution beyond ordinary
  GUI checks may not work under read-only mounts.
- Close refuses failed normal project shutdown. Transport disconnect attempts normal
  shutdown, then disposes isolated test processes if necessary. Abrupt controller death
  disposes its PID namespace; treat unfinished disposable project runs as interrupted.
- Artifacts/copies remain after close. `NATIVE_GUI_TMPDIR` overrides workspace base;
  default uses `os.tmpdir()/opencode`. Remove only returned, no-longer-active workspace
  directories when finished. `E2E_TAURI_DRIVER` overrides driver executable.

Smoke check exercises native launch, click, text entry, state update, inspection, image
capture, waits, navigation, keyboard, two concurrent session-isolated windows, close and
relaunch with retained sandbox settings, explicit vanilla reset, and profile-template
seeding without importing personal recent projects or bypassing native validation.
It deliberately supplies invalid desktop display/authority values to verify that the
default virtual displays are independent of desktop-session credentials.
It also checks that WebGL 1 and 2 render pixels with server-side GLX disabled.
Sizing smoke covers portrait and 4K native-window requests, reports actual CSS/PNG
dimensions, validates inspection styles/geometry, native console-log capture, failure
evidence, and offline diagnostics after close.
No project data or personal settings are touched.

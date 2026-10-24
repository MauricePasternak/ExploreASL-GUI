# Native GUI agent tools

Project-local MCP server for interactive **Linux Tauri/WebKit** viewing and input.
Reuses WebdriverIO and native driver helpers from `e2e-tests/`; no app runtime changes,
browser IPC shim, or automatic app builds. Own package/lockfile isolates installation
from concurrent feature work.

## Setup

Requirements: Node/pnpm, `tauri-driver`, `WebKitWebDriver`, `bwrap`, `dbus-run-session`,
and an X11 display (`DISPLAY`). For headless work, start OpenCode under Xvfb.

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

## Agent workflow

1. `launch`: returns isolated workspace and application path.
2. `inspect`: visible text, labels, values, disabled/checked state, CSS selectors.
3. `click`, `fill`, `select`, `keys`, `wait`: real WebDriver input and bounded waits.
4. `screenshot`: PNG image plus saved artifact path.
5. `close`: normal project shutdown, then window/driver disposal.

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
settings. Profile seeding requires no app rebuild; reconnect the MCP server via
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
  are not visible. X11 is used; Wayland-only desktops need XWayland or Xvfb.
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
No project data or personal settings are touched.

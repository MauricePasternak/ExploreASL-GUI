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
manual help or existing native E2E setup. Settings start empty: configure profiles
inside this test instance; personal profiles/recent-project settings are not imported.

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
relaunch with retained sandbox settings.
No project data or personal settings are touched.

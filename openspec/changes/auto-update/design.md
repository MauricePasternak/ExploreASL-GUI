# Auto-update design

## Startup and availability

`UpdateManager` renders beside routes, after the global settings loading gate. A module-lifetime guard permits one check per production process. Development builds and `VITE_E2E=1` skip it. `check({ timeout: 30000 })` failures only log through the existing console-to-plugin-log bridge.

An available release creates one Mantine notification with a stable ID, `bottom-right` position, and `autoClose: 10000`. The message only displays the release version; release notes are not rendered.

## Safe update transition

Clean idle state hides availability and starts installation. Dirty state, processing `preparing`/`running`, or import `preparing`/`running`/`importRunning` opens a confirmation modal. Confirmation performs this order: `killProcessing`, `stop_active_import`, save dirty project, then install. Any abort or save failure leaves installation unstarted and shows a ten-second actionable error.

Download events maintain one persistent Mantine progress notification. Download/install failures never relaunch. Linux/macOS call process relaunch after a successful install; Windows returns because its updater exits and restarts the app itself.

## Release and signing

Source config retains an empty updater public key and disabled updater artifacts so local development builds deserialize and do not check. The release workflow rejects missing private key, password, or public key before creating a draft. It injects public key and artifact generation only in CI, then `tauri-action@v1` uploads signed artifacts and `latest.json` to the draft release. Publishing makes GitHub's public `releases/latest/download/latest.json` endpoint available.

macOS uses ad-hoc signing identity `-`; this is separate from updater signatures and does not provide Gatekeeper notarization. Windows Authenticode is intentionally absent.

## OpenSpec 1.11 reconciliation

The canonical `auto-update` specification was synchronized and normalized during the OpenSpec 1.11 migration while this change remained active for platform smoke testing. Archive this change with `--skip-specs` after smoke testing succeeds to preserve the existing canonical specification without applying its delta twice.

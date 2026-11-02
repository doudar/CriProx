# Install and run Skarix

Installers are available from [Skarix releases](https://github.com/doudar/Skarix/releases). The signing workflow described below applies to releases built after it is merged; it does not repair existing unsigned installers.

## Development

Install Node.js 22 or newer, clone [doudar/Skarix](https://github.com/doudar/Skarix), and run `npm ci` followed by `npm run desktop`. Use `npm run dev` for the browser preview. Desktop printing and device integrations require Electron.

## Packaging

Use `npm run package:windows`, `npm run package:mac`, or `npm run package:linux` on a suitable build host. Builds do not publish automatically. Local Mac builds and installer previews remain unsigned and are not suitable for validating Bluetooth permission or Keychain persistence across updates.

### Signed macOS releases

The signing step must print `Verified the signed, notarized universal app inside the release DMG.` before it can succeed. If a signing dependency exits early or abandons asynchronous work, the release wrapper fails the step rather than proceeding to upload a missing installer. A log naming `Apple Development` indicates the wrong certificate was selected; export the **Developer ID Application** certificate and its private key instead.

The Release workflow uses `npm run package:mac:release` for macOS. It requires a Developer ID Application certificate, enables hardened runtime, signs the app and its nested components, notarizes and staples the app, and signs the DMG. Before upload it mounts the finished DMG read-only and checks the contained app's signature across both architectures, bundle identifier, Apple team, Developer ID authority, hardened runtime, stapled notarization ticket and Gatekeeper acceptance. Missing credentials or a failed check blocks publication; there is no unsigned release fallback. Windows and Linux packaging are unchanged.

In **doudar/Skarix → Settings → Secrets and variables → Actions → Repository secrets**, configure:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64 encoding of a password-protected `.p12` export containing the Developer ID Application certificate **and its private key**. Use a Developer ID Application certificate, not Apple Development or a Mac App Store distribution certificate. |
| `MAC_CSC_KEY_PASSWORD` | Password used for that `.p12` export. |
| `APPLE_ID` | Apple account email authorized to notarize for the team. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that account, not its regular login password. |
| `APPLE_TEAM_ID` | Ten-character Apple Developer team identifier matching the signing certificate. |

Export the certificate and private key from Keychain Access, then encode the `.p12` as one line before storing it as the secret. Keep the export and password out of Git and chat. GitHub maps `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` to electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD`; credentials are exposed only to the Mac release step, never preview or pull-request builds. Use the same team and app identifier (`com.skarix.studio`) across releases so macOS can recognize updates. See [electron-builder signing](https://www.electron.build/v26/docs/mac/) and [notarization](https://www.electron.build/v26/docs/features/code-signing/notarization/).

After configuring secrets, merge the signing change through normal CI. Release Please prepares the version; Release builds and verifies all installers before publishing. Do not manually edit version files or the changelog. If Apple rejects notarization or is unavailable, fix the reported issue and retry the failed workflow; do not bypass verification.

Release packaging pins electron-builder 26.16.1, which fixes temporary signing-keychain password handling. Earlier 26.15.3 builds could import the certificate successfully and then fail at `security set-key-partition-list` with `SecKeychainUnlock`: they incorrectly supplied the certificate export password instead of the temporary keychain password. For that failure, build the updated revision rather than changing the certificate or notarization secrets. Rerunning a workflow on the old revision retains its old lockfile.

For an upgrade from an unsigned build with a stale Bluetooth permission, quit Skarix, install the signed app in `/Applications`, then, if necessary, run `tccutil reset BluetoothAlways com.skarix.studio`. Reopen Skarix and allow Bluetooth when prompted. This resets only Skarix's Bluetooth permission. Validate a real BLE connection, Keychain save/reload, and a subsequent signed update before claiming hardware or permission persistence is verified.

## First launch and existing data

Fresh profiles show Home and an editable Skarix sticker. An existing draft takes precedence, including a blank draft. **Meet Skarix** is also available as an explicit new-project action.

The app reuses an existing Skarix, CriProx, or criprox user-data directory, in that order. Existing drafts, recent projects, and settings are migrated automatically when read. New exports and MCP configuration use Skarix names. Windows keeps its existing installer upgrade identity. The macOS app identifier is now `com.skarix.studio`; macOS may request Bluetooth permission again after this upgrade. User project files are not moved or deleted.

Open prior sticker/design JSON files normally. Expand **Preserved legacy projects** on Home to export legacy card project copies or open their original folder. **Export last autosaved card draft** recovers the latest card edits from the old workspace even when they were never saved in Recents or the library; exporting does not alter that stored draft. Use CriProx to edit that legacy format. Reopening **Meet Skarix** creates a distinct starter and preserves your customized starter in Recents.

## Updates and offline work

Update checks target [Skarix releases](https://github.com/doudar/Skarix/releases). Local artwork, editing and exports work without a cloud account. Release checks and external device integrations may need network access. Save portable files regularly; drafts are not backups.

## Test installers from a branch

After the workflow reaches main, use **Actions → Skarix installer previews → Run workflow** and select the branch to build. Download the platform artifact after the run completes. Each artifact includes SHA256SUMS.txt and SOURCE.txt identifying the exact commit. Previews expire after 14 days and are not published releases.

## Simulate an update locally

Run `npm run desktop:updates` in a development checkout. The isolated simulation uses an 8 MB fixture and verifies download progress, cancellation, checksums and installer handoff without launching an installer. Add `-- --scenario=checksum-failure`, `network-failure`, or `up-to-date` to exercise those cases.

## macOS cutter connection

Install Design Space 10.8.81 in /Applications or your user Applications folder. Skarix resolves its app archive and native DeviceIO helper and verifies runtime component hashes. Quit Design Space and other apps using the cutter, then select Explore 5 and Bluetooth LE inside Skarix. Do not pair Explore 5 through system Bluetooth settings. Allow Bluetooth access when macOS requests it. Initialization waits up to five seconds for the controller; Cancel connection releases the attempt. The helper exposes a ready flag but cannot reliably distinguish disabled Bluetooth from denied permission.

Skarix includes a Bluetooth usage description. Signed releases use hardened runtime without App Sandbox; adopting App Sandbox would also require a Bluetooth entitlement. The saved-key store uses Electron safeStorage with macOS Keychain. The release checks verify signing and notarization, but permission attribution to the packaged app/helper, Keychain denial and update behavior still need hardware testing. Explore 5 Bluetooth connection and cutting have been physically tested on macOS.

The installed application uses the Aurora rounded-square icon with mint and coral chevrons. **Meet Skarix** opens the matching editable logo project.

The desktop app checks GitHub for newer stable releases at startup and every 15 minutes, and refreshes its cached check when you return to the app. When an update is available, an **Update [version]** button appears in the header and opens **Settings → Updates** for release notes and download options. You can also use **Check now** there. Downloads and installation remain manual.

The MCP server identifies itself as **skarix-design**. Copy the updated **skarix** configuration from Settings → AI access into your MCP client and remove the previous server entry to avoid duplicates.

# Install and run Skarix

Published v0.17.1 installers predate this rebrand. This change does not publish a release.

## Development

Install Node.js 22 or newer, clone [doudar/Skarix](https://github.com/doudar/Skarix), and run `npm ci` followed by `npm run desktop`. Use `npm run dev` for the browser preview. Desktop printing and device integrations require Electron.

## Packaging

Use `npm run package:windows`, `npm run package:mac`, or `npm run package:linux` on a suitable build host. Builds do not publish automatically. Signing/notarization requires maintainer configuration.

## First launch and existing data

Fresh profiles show Home and an editable Skarix sticker. An existing draft takes precedence, including a blank draft. **Meet Skarix** is also available as an explicit new-project action.

The app reuses an existing Skarix, CriProx, or criprox user-data directory, in that order. Installation ID and storage keys remain compatible. User project files are not moved or deleted.

Open prior sticker/design JSON files normally. Expand **Preserved CriProx projects** on Home to export legacy card project copies or open their original folder. **Export last autosaved card draft** recovers the latest card edits from the old workspace even when they were never saved in Recents or the library; exporting does not alter that stored draft. Use CriProx to edit that legacy format. Reopening **Meet Skarix** creates a distinct starter and preserves your customized starter in Recents.

## Updates and offline work

Update checks target [Skarix releases](https://github.com/doudar/Skarix/releases). Local artwork, editing and exports work without a cloud account. Release checks and external device integrations may need network access. Save portable files regularly; drafts are not backups.

## Test installers from a branch

After the workflow reaches main, use **Actions → Skarix installer previews → Run workflow** and select the branch to build. Download the platform artifact after the run completes. Each artifact includes SHA256SUMS.txt and SOURCE.txt identifying the exact commit. Previews expire after 14 days and are not published releases.

## Simulate an update locally

Run `npm run desktop:updates` in a development checkout. The isolated simulation uses an 8 MB fixture and verifies download progress, cancellation, checksums and installer handoff without launching an installer. Add `-- --scenario=checksum-failure`, `network-failure`, or `up-to-date` to exercise those cases.

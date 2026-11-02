# Install and run Skarix

Published v0.17.1 installers predate this rebrand. This change does not publish a release.

## Development

Install Node.js 22 or newer, clone [doudar/Skarix](https://github.com/doudar/Skarix), and run `npm ci` followed by `npm run desktop`. Use `npm run dev` for the browser preview. Desktop printing and device integrations require Electron.

## Packaging

Use `npm run package:windows`, `npm run package:mac`, or `npm run package:linux` on a suitable build host. Builds do not publish automatically. Signing/notarization requires maintainer configuration.

## First launch and existing data

Fresh profiles show Home and an editable Skarix sticker. An existing draft takes precedence, including a blank draft. **Meet Skarix** is also available as an explicit new-project action.

The app reuses an existing Skarix, CriProx, or criprox user-data directory, in that order. Installation ID and storage keys remain compatible. User project files are not moved or deleted.

Open prior sticker/design JSON files normally. Expand **Preserved CriProx projects** on Home to export legacy card project copies or open their original folder. Use CriProx to edit that legacy format.

## Updates and offline work

Update checks target [Skarix releases](https://github.com/doudar/Skarix/releases). Local artwork, editing and exports work without a cloud account. Release checks and external device integrations may need network access. Save portable files regularly; drafts are not backups.

## Test installers from a branch

Use **Actions → Test installers → Run workflow**, leave the workflow branch on main, and enter the feature branch in `build_branch`. Download the platform artifact after the run completes. These are test builds of the recorded commit, not stable releases.

## Simulate an update locally

Run `npm run desktop:updates` in a development checkout. The isolated simulation uses an 8 MB fixture and verifies download progress, cancellation, checksums and installer handoff without launching an installer. Add `-- --scenario=checksum-failure`, `network-failure`, or `up-to-date` to exercise those cases.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const SCENARIOS = ['success', 'checksum-failure', 'network-failure', 'up-to-date'];

function createDemoRelease({
  currentVersion,
  platform,
  arch,
  scenario = 'success',
  chunkDelay = 250,
}) {
  if (!SCENARIOS.includes(scenario))
    throw new Error(`Unknown update scenario. Choose ${SCENARIOS.join(', ')}.`);
  const [major, minor] = currentVersion.split('.').map(Number);
  const version = scenario === 'up-to-date' ? currentVersion : `${major}.${minor + 1}.0`;
  const suffix =
    platform === 'darwin'
      ? 'mac-universal.dmg'
      : platform === 'win32'
        ? `win-${arch}.exe`
        : `linux-${arch}.AppImage`;
  const name = `Skarix-${version}-${suffix}`;
  const payload = Buffer.alloc(8 * 1024 ** 2, 0x43);
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const checksums = `${hash}  ${name}\n`;
  const base = `https://github.com/doudar/Skarix/releases/download/v${version}/`;
  const release = {
    tag_name: `v${version}`,
    name: `v${version}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/doudar/Skarix/releases/tag/v${version}`,
    published_at: new Date().toISOString(),
    body: `## [${version}](https://github.com/doudar/Skarix/compare/v${currentVersion}...v${version})\n\n### Features\n\n* **updates:** download and verify desktop updates ([#98](https://github.com/doudar/Skarix/issues/98)) ([72a3a52](https://github.com/doudar/Skarix/commit/72a3a5281252b1d9805241b68db6551f63525117))\n* **settings:** review release notes without leaving Skarix\n\n### Performance Improvements\n\n* Download in the background while you keep working.\n\n### Bug Fixes\n\n* Retry interrupted downloads without leaving partial installers.\n\nThis is a **local simulation**, using an 8 MB test file. [Read the update guide](docs/INSTALLATION.md).`,
    assets: [
      { name, size: payload.length, browser_download_url: base + name },
      {
        name: 'SHA256SUMS.txt',
        size: Buffer.byteLength(checksums),
        browser_download_url: base + 'SHA256SUMS.txt',
      },
    ],
  };
  let checks = 0,
    checksumRequests = 0;
  async function fetchRelease(input, options = {}) {
    const url = String(input);
    options.signal?.throwIfAborted();
    if (url === 'https://api.github.com/repos/doudar/Skarix/releases/latest') {
      checks++;
      if (scenario === 'network-failure' && checks === 1) return new Response('', { status: 503 });
      return new Response(JSON.stringify(release), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://api.github.com/repos/doudar/Skarix/releases?per_page=100') {
      return new Response(JSON.stringify([release]), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === base + 'SHA256SUMS.txt') {
      checksumRequests++;
      const mismatch = scenario === 'checksum-failure' && checksumRequests === 1;
      return new Response(mismatch ? `${'0'.repeat(64)}  ${name}\n` : checksums);
    }
    if (url === base + name) {
      let offset = 0;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (chunkDelay) await delay(chunkDelay, undefined, { signal: options.signal });
            options.signal?.throwIfAborted();
            const end = Math.min(offset + 256 * 1024, payload.length);
            controller.enqueue(payload.subarray(offset, end));
            offset = end;
            if (offset === payload.length) controller.close();
          },
        }),
      );
    }
    throw new Error('The update simulation does not make network requests.');
  }
  return { fetchRelease, release, scenario };
}

function startUpdateDemo(app, dialog) {
  if (app.isPackaged)
    throw new Error('Update simulation is only available in a development checkout.');
  const scenario =
    process.argv.find((arg) => arg.startsWith('--scenario='))?.slice('--scenario='.length) ||
    'success';
  const fixture = createDemoRelease({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    scenario,
  });
  const requestedProfile = process.env.SKARIX_UPDATE_DEMO_PROFILE;
  const profile = requestedProfile
    ? fs.realpathSync(requestedProfile)
    : fs.mkdtempSync(path.join(app.getPath('temp'), 'skarix-update-demo-'));
  if (
    path.dirname(fs.realpathSync(profile)) !== fs.realpathSync(app.getPath('temp')) ||
    !path.basename(profile).startsWith('skarix-update-demo-')
  ) {
    throw new Error('The simulation requires its own temporary profile.');
  }
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setName('Skarix update simulation');
  console.log(`Update simulation: ${scenario}. Temporary profile: ${profile}`);
  async function showCompletion() {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Update simulation',
      message: 'The simulated update completed.',
      detail:
        'Skarix downloaded and verified the test file. A normal build would now launch the update and close Skarix. This test keeps Skarix open and does not install anything or replace your app.',
      buttons: ['Done'],
    });
    return '';
  }
  async function showRelease() {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Simulated release',
      message: 'This release exists only in the local simulation.',
      detail:
        'Its formatted notes are shown in Settings → Updates. Nothing has been published to GitHub.',
      buttons: ['Done'],
    });
  }
  return {
    managerOptions: {
      fetchRelease: fixture.fetchRelease,
      openInstaller: showCompletion,
      onInstallerOpened: () => {},
      simulation: scenario,
    },
    showRelease,
  };
}

module.exports = { createDemoRelease, startUpdateDemo, SCENARIOS };

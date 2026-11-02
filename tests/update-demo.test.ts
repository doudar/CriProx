import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDemoRelease, startUpdateDemo } = require('../electron/update-demo.cjs');
const { createUpdateManager } = require('../electron/update-manager.cjs');

for (const scenario of ['success', 'checksum-failure', 'network-failure', 'up-to-date']) {
  test(`local simulation exercises the real update manager: ${scenario}`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'criprox-demo-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const fixture = createDemoRelease({
      currentVersion: '0.13.0',
      platform: 'darwin',
      arch: 'arm64',
      scenario,
      chunkDelay: 0,
    });
    let opened = false;
    const manager = createUpdateManager({
      currentVersion: '0.13.0',
      platform: 'darwin',
      arch: 'arm64',
      directory,
      fetchRelease: fixture.fetchRelease,
      simulation: scenario,
      openInstaller: async () => {
        opened = true;
        return '';
      },
    });
    let checked = await manager.check();
    assert.equal(checked.simulation, scenario);
    if (scenario === 'network-failure') {
      assert.equal(checked.status, 'error');
      checked = await manager.check(true);
    }
    if (scenario === 'up-to-date') {
      assert.equal(checked.status, 'up-to-date');
      assert.equal(checked.update, null);
      assert.equal(checked.changelog[0].isInstalled, true);
      assert.equal(checked.changelog[0].isNew, false);
      return;
    }
    assert.equal(checked.status, 'available');
    assert.equal(checked.changelog[0].isNew, true);
    assert.match(checked.update.releaseNotesHtml, /<ul>/);
    let downloaded = await manager.download();
    if (scenario === 'checksum-failure') {
      assert.equal(downloaded.status, 'error');
      assert.equal(opened, false);
      downloaded = await manager.download();
    }
    assert.equal(downloaded.status, 'ready');
    assert.equal(opened, false);
    await manager.open();
    assert.equal(opened, true);
  });
}

test('simulation never falls back to network access and refuses packaged builds', async () => {
  const fixture = createDemoRelease({ currentVersion: '0.13.0', platform: 'win32', arch: 'x64' });
  await assert.rejects(fixture.fetchRelease('https://example.com'), /does not make network/);
  assert.throws(() => startUpdateDemo({ isPackaged: true }, {}), /development checkout/);
  assert.throws(
    () => createDemoRelease({ currentVersion: '0.13.0', scenario: 'unknown' }),
    /Unknown update scenario/,
  );
});

test('simulation overrides the production quit callback and explains its safe handoff', async (t) => {
  const paths = new Map<string, string>();
  let quits = 0;
  const app = {
    isPackaged: false,
    getVersion: () => '0.13.0',
    getPath: () => tmpdir(),
    setPath: (name: string, value: string) => paths.set(name, value),
    setName: () => {},
    quit: () => quits++,
  };
  let detail = '';
  const demo = startUpdateDemo(app, {
    showMessageBox: async (options: { detail: string }) => {
      detail = options.detail;
    },
  });
  t.after(() => rm(paths.get('userData')!, { recursive: true, force: true }));
  const options = { onInstallerOpened: () => app.quit(), ...demo.managerOptions };
  assert.equal(await options.openInstaller('/unused/test-file'), '');
  options.onInstallerOpened();
  assert.equal(quits, 0);
  assert.match(detail, /keeps Skarix open/);
  assert.equal(paths.get('sessionData'), paths.get('userData'));
});

test('the simulation launcher cleans the temporary profile after the child exits', async (t) => {
  const fs = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'criprox-demo-launch-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'child.cjs');
  await fs.writeFile(
    fixture,
    'require("node:fs").writeFileSync(require("node:path").join(process.env.CRIPROX_UPDATE_DEMO_PROFILE,"session"),"test")',
  );
  const { launchUpdateDemo } = require('../scripts/update-demo.cjs');
  const { child, profile } = launchUpdateDemo({
    appPath: fixture,
    electronPath: process.execPath,
    args: [],
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code: number) =>
      code === 0 ? resolve() : reject(new Error('Fixture process failed')),
    );
  });
  await assert.rejects(fs.access(profile));
});

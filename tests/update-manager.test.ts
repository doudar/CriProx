import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

const require = createRequire(import.meta.url);
const { selectReleaseAssets } = require('../electron/release-check.cjs');
const { createUpdateManager, checksumFor } = require('../electron/update-manager.cjs') as {
  checksumFor: (text: string, name: string) => string;
  createUpdateManager: (options: {
    currentVersion: string;
    platform: string;
    arch: string;
    directory: string;
    fetchRelease: typeof fetch;
    openInstaller: (file: string) => Promise<string | null>;
    onInstallerOpened?: () => void;
    notify?: (state: UpdateState) => void;
  }) => {
    snapshot: () => UpdateState;
    check: (force?: boolean) => Promise<UpdateState>;
    download: () => Promise<UpdateState>;
    cancel: () => Promise<UpdateState>;
    open: () => Promise<UpdateState>;
  };
};
const bytes = Buffer.from('test installer');
const hash = createHash('sha256').update(bytes).digest('hex');
const name = 'Skarix-0.14.0-win-x64.exe';
const base = 'https://github.com/doudar/Skarix/releases/download/v0.14.0/';
const asset = (name: string, size = bytes.length) => ({
  name,
  size,
  browser_download_url: base + name,
});
const release = {
  tag_name: 'v0.14.0',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/doudar/Skarix/releases/tag/v0.14.0',
  body: 'New features\n<script>untrusted notes</script>',
  assets: [asset(name), asset('SHA256SUMS.txt', 150)],
};
async function fixture(
  t: TestContext,
  options: {
    checksum?: string;
    data?: Buffer;
    request?: typeof fetch;
    history?: unknown[];
    openInstaller?: (file: string) => Promise<string | null>;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'skarix-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'downloads');
  let opened = '',
    checks = 0,
    handoffs = 0;
  const states: UpdateState[] = [];
  const manager = createUpdateManager({
    currentVersion: '0.13.0',
    platform: 'win32',
    arch: 'x64',
    directory,
    notify: (state) => states.push(state),
    fetchRelease: (async (input, init) => {
      if (String(input).includes('/releases?')) {
        return options.history
          ? new Response(JSON.stringify(options.history))
          : new Response('', { status: 503 });
      }
      if (options.request) return options.request(input, init);
      const url = String(input);
      if (url.includes('/releases/latest')) {
        checks++;
        return new Response(JSON.stringify(release));
      }
      if (url.endsWith('SHA256SUMS.txt'))
        return new Response(`${options.checksum || hash}  ${name}\n`);
      if (url === base + name) return new Response(new Uint8Array(options.data || bytes));
      throw new Error('Unexpected URL');
    }) as typeof fetch,
    onInstallerOpened: () => handoffs++,
    openInstaller:
      options.openInstaller ||
      (async (file) => {
        opened = file;
        return '';
      }),
  });
  return {
    manager,
    directory,
    states,
    opened: () => opened,
    checks: () => checks,
    handoffs: () => handoffs,
  };
}

test('select only the published platform and architecture from trusted release assets', () => {
  const multi = {
    ...release,
    assets: [
      ...release.assets,
      asset('Skarix-0.14.0-mac-universal.dmg'),
      asset('Skarix-0.14.0-linux-x64.AppImage'),
    ],
  };
  assert.equal(
    selectReleaseAssets(multi, 'darwin', 'arm64').installer.name,
    'Skarix-0.14.0-mac-universal.dmg',
  );
  assert.equal(
    selectReleaseAssets(multi, 'darwin', 'x64').installer.name,
    'Skarix-0.14.0-mac-universal.dmg',
  );
  assert.equal(
    selectReleaseAssets(multi, 'linux', 'x64').installer.name,
    'Skarix-0.14.0-linux-x64.AppImage',
  );
  assert.equal(selectReleaseAssets(multi, 'win32', 'arm64'), null);
  assert.equal(selectReleaseAssets({ ...release, assets: [asset(name)] }, 'win32', 'x64'), null);
  assert.equal(
    selectReleaseAssets({ ...release, assets: [...release.assets, asset(name)] }, 'win32', 'x64'),
    null,
  );
  for (const url of [
    'https://evil.example/' + name,
    base.replace('Skarix', 'Other') + name,
    base + name + '?x=1',
  ]) {
    assert.equal(
      selectReleaseAssets(
        {
          ...release,
          assets: [{ ...asset(name), browser_download_url: url }, asset('SHA256SUMS.txt')],
        },
        'win32',
        'x64',
      ),
      null,
    );
  }
});

test('checksums require one exact filename entry', () => {
  assert.equal(checksumFor(`${hash} *${name}\r\n`, name), hash);
  assert.throws(() => checksumFor(`${hash}  other.exe`, name));
  assert.throws(() => checksumFor(`${hash}  ${name}\n${hash}  ${name}`, name));
  assert.throws(() => checksumFor(`not-a-hash  ${name}`, name));
});

test('download verifies bytes, publishes progress, and requires explicit opening', async (t) => {
  const f = await fixture(t);
  const checked = await f.manager.check();
  assert.equal(checked.update?.canDownload, true);
  assert.equal(checked.update?.releaseNotes, release.body);
  assert.equal('installer' in checked.update!, false);
  await f.manager.check();
  assert.equal(f.checks(), 1);
  await f.manager.check(true);
  assert.equal(f.checks(), 2);
  await Promise.all([f.manager.download(), f.manager.download()]);
  assert.equal(f.manager.snapshot().status, 'ready');
  assert.equal(f.opened(), '');
  assert.deepEqual(await readFile(path.join(f.directory, name)), bytes);
  assert.ok(f.states.some((s) => s.status === 'downloading' && s.transferred > 0));
  assert.ok(f.states.some((s) => s.status === 'verifying'));
  await f.manager.check(true);
  assert.equal(f.manager.snapshot().status, 'ready');
  await f.manager.open();
  assert.equal(f.opened(), path.join(f.directory, name));
  assert.equal(f.handoffs(), 1);
});

test('a bad checksum or truncated download is removed and never opened', async (t) => {
  for (const options of [
    { checksum: '0'.repeat(64) },
    { data: Buffer.from('short') },
    { data: Buffer.alloc(bytes.length + 1) },
  ]) {
    const f = await fixture(t, options);
    await f.manager.check();
    assert.equal((await f.manager.download()).status, 'error');
    await assert.rejects(readdir(f.directory));
    await assert.rejects(f.manager.open());
    assert.equal(f.opened(), '');
  }
});

test('modified installers are rejected when opened', async (t) => {
  const f = await fixture(t);
  await f.manager.check();
  await f.manager.download();
  await writeFile(path.join(f.directory, name), 'tampered');
  assert.equal((await f.manager.open()).status, 'error');
  assert.equal(f.opened(), '');
  assert.equal(f.handoffs(), 0);
  await assert.rejects(readdir(f.directory));
});

test('only a successful installer handoff requests closing the application', async (t) => {
  for (const result of [null, 'Launch failed', '']) {
    const f = await fixture(t, { openInstaller: async () => result });
    await f.manager.check();
    await f.manager.download();
    await Promise.all([f.manager.open(), f.manager.open()]);
    assert.equal(f.handoffs(), result === '' ? 1 : 0);
    assert.equal(f.manager.snapshot().status, 'ready');
    assert.equal(Boolean(f.manager.snapshot().error), result === 'Launch failed');
    assert.deepEqual(await readFile(path.join(f.directory, name)), bytes);
  }
  let fail = true;
  const f = await fixture(t, {
    openInstaller: async () => {
      if (fail) throw new Error('Cannot launch');
      return '';
    },
  });
  await f.manager.check();
  await f.manager.download();
  await f.manager.open();
  assert.equal(f.handoffs(), 0);
  fail = false;
  await f.manager.open();
  assert.equal(f.handoffs(), 1);
  assert.equal(f.manager.snapshot().error, '');
});

test('failed checks report errors and can be retried', async (t) => {
  let fail = true;
  const f = await fixture(t, {
    request: (async () =>
      fail
        ? new Response('', { status: 503 })
        : new Response(JSON.stringify(release))) as typeof fetch,
  });
  assert.equal((await f.manager.check()).status, 'error');
  assert.equal(f.manager.snapshot().lastChecked, null);
  assert.equal(f.manager.snapshot().changelog[0].version, '0.13.0');
  assert.equal(f.manager.snapshot().changelog[0].isInstalled, true);
  fail = false;
  assert.equal((await f.manager.check()).status, 'available');
});

test('cancellation removes partial downloads and allows retry', async (t) => {
  let slow = true;
  let started!: () => void;
  const downloading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await fixture(t, {
    request: (async (input, init) => {
      if (String(input).includes('/releases/latest')) return new Response(JSON.stringify(release));
      if (String(input).endsWith('SHA256SUMS.txt')) return new Response(`${hash}  ${name}\n`);
      if (!slow) return new Response(bytes);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 2));
            init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason));
            started();
          },
        }),
      );
    }) as typeof fetch,
  });
  await f.manager.check();
  const job = f.manager.download();
  await downloading;
  await f.manager.cancel();
  await job;
  assert.equal(f.manager.snapshot().status, 'cancelled');
  await assert.rejects(readdir(f.directory));
  slow = false;
  assert.equal((await f.manager.download()).status, 'ready');
});

test('up-to-date and incomplete releases keep the correct check result', async (t) => {
  const current = await fixture(t, {
    request: (async () =>
      new Response(JSON.stringify({ ...release, tag_name: 'v0.13.0' }))) as typeof fetch,
  });
  assert.equal((await current.manager.check()).status, 'up-to-date');
  assert.equal(current.manager.snapshot().update, null);
  assert.ok(current.manager.snapshot().changelog.some((release) => release.isInstalled));
  const incomplete = await fixture(t, {
    request: (async () => new Response(JSON.stringify({ ...release, assets: [] }))) as typeof fetch,
  });
  assert.equal((await incomplete.manager.check()).update?.canDownload, false);
  await assert.rejects(incomplete.manager.download());
});

test('changelog remains available before checks and after download and connection failures', async (t) => {
  let offline = false;
  const f = await fixture(t, {
    history: [
      { ...release, tag_name: 'v0.13.0', body: '* Installed notes' },
      { ...release, tag_name: 'v0.13.1', body: '* Intermediate notes' },
    ],
    request: (async (input) => {
      if (offline) throw new Error('Offline');
      if (String(input).includes('/releases/latest')) return new Response(JSON.stringify(release));
      return new Response(String(input).endsWith('SHA256SUMS.txt') ? `${hash}  ${name}` : bytes);
    }) as typeof fetch,
  });
  assert.equal(f.manager.snapshot().changelog[0].isInstalled, true);
  const state = await f.manager.check();
  assert.deepEqual(
    state.changelog
      .slice(0, 3)
      .map((release) => [release.version, release.isNew, release.isInstalled]),
    [
      ['0.14.0', true, false],
      ['0.13.1', true, false],
      ['0.13.0', false, true],
    ],
  );
  assert.match(state.changelog[2].releaseNotesHtml, /Installed notes/);
  const ready = await f.manager.download();
  assert.deepEqual(ready.changelog, state.changelog);
  assert.equal(ready.changelog[0].isNew, true);
  offline = true;
  const failed = await f.manager.check(true);
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.changelog, state.changelog);
  const snapshot = f.manager.snapshot();
  snapshot.changelog[0].releaseHeading = 'Changed outside the manager';
  assert.notEqual(
    f.manager.snapshot().changelog[0].releaseHeading,
    snapshot.changelog[0].releaseHeading,
  );
});

test('streamed chunks produce the complete installer', async (t) => {
  const f = await fixture(t, {
    request: (async (input) => {
      if (String(input).includes('/releases/latest')) return new Response(JSON.stringify(release));
      if (String(input).endsWith('SHA256SUMS.txt')) return new Response(`${hash}  ${name}`);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 3));
            controller.enqueue(bytes.subarray(3, 7));
            controller.enqueue(bytes.subarray(7));
            controller.close();
          },
        }),
      );
    }) as typeof fetch,
  });
  await f.manager.check();
  assert.equal((await f.manager.download()).status, 'ready');
  assert.deepEqual(await readFile(path.join(f.directory, name)), bytes);
});

test('checksum service failure removes the download and leaves a retryable error', async (t) => {
  const f = await fixture(t, {
    request: (async (input) =>
      String(input).includes('/releases/latest')
        ? new Response(JSON.stringify(release))
        : new Response('', { status: 503 })) as typeof fetch,
  });
  await f.manager.check();
  assert.equal((await f.manager.download()).status, 'error');
  assert.match(f.manager.snapshot().error, /checksums/);
  assert.equal(f.opened(), '');
  await assert.rejects(readdir(f.directory));
});

test('concurrent checks share one request, while a forced check discovers a newer release', async (t) => {
  let count = 0,
    newer = false;
  const f = await fixture(t, {
    request: (async (input) => {
      if (String(input).includes('/releases/latest')) {
        count++;
        return new Response(
          JSON.stringify(
            newer
              ? {
                  ...release,
                  tag_name: 'v0.15.0',
                  html_url: 'https://github.com/doudar/Skarix/releases/tag/v0.15.0',
                  assets: [],
                }
              : release,
          ),
        );
      }
      return new Response(
        String(input).endsWith('SHA256SUMS.txt') ? `${hash}  ${name}` : new Uint8Array(bytes),
      );
    }) as typeof fetch,
  });
  await Promise.all([f.manager.check(), f.manager.check()]);
  assert.equal(count, 1);
  await f.manager.download();
  newer = true;
  const state = await f.manager.check(true);
  assert.equal(state.status, 'available');
  assert.equal(state.update?.latestVersion, '0.15.0');
  await assert.rejects(f.manager.open());
  assert.equal(f.opened(), '');
});

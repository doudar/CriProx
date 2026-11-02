import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createInstallerHandoff,
  createMacUpdateHelp,
  MAC_UNBLOCK_COMMAND,
} = require('../electron/update-install.cjs');

test('macOS and Windows hand the verified package to the OS and propagate launch failures', async () => {
  for (const platform of ['darwin', 'win32']) {
    const opened: string[] = [];
    let error = '';
    const handoff = createInstallerHandoff({
      platform,
      openPath: async (file: string) => {
        opened.push(file);
        return error;
      },
      chooseDestination: () => {
        throw new Error('Not a Linux handoff');
      },
    });
    assert.equal(await handoff('/verified/installer'), '');
    error = 'OS refused the launch';
    assert.equal(await handoff('/verified/installer'), error);
    assert.deepEqual(opened, ['/verified/installer', '/verified/installer']);
  }
});

test('Linux saves an executable AppImage, launches the saved path, and supports cancellation and retry', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'criprox-handoff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  await mkdir(cache);
  const installer = path.join(cache, 'update.AppImage');
  await writeFile(installer, 'verified app');
  const destination = path.join(root, 'new.AppImage');
  let canceled = true,
    fail = false;
  const launched: string[] = [];
  const handoff = createInstallerHandoff({
    platform: 'linux',
    downloads: root,
    chooseDestination: async (options: { defaultPath: string }) => {
      assert.equal(options.defaultPath, path.join(root, 'update.AppImage'));
      return { canceled, filePath: destination };
    },
    launch: async (file: string) => {
      if (fail) throw new Error('Launch refused');
      launched.push(file);
    },
  });
  assert.equal(await handoff(installer), null);
  assert.deepEqual(launched, []);
  canceled = false;
  // Exclusive creation also proves cancellation did not leave a destination behind.
  await writeFile(destination, 'previous app', { flag: 'wx' });
  assert.equal(await handoff(installer), '');
  const saved = await open(destination, 'r');
  try {
    assert.equal(await saved.readFile('utf8'), 'verified app');
    // Windows does not implement POSIX execute bits; the Linux/macOS runners check them.
    if (process.platform !== 'win32') assert.equal((await saved.stat()).mode & 0o777, 0o700);
  } finally {
    await saved.close();
  }
  assert.deepEqual(launched, [destination]);
  assert.deepEqual((await readdir(root)).sort(), ['cache', 'new.AppImage']);
  fail = true;
  await assert.rejects(handoff(installer), /Launch refused/);
  fail = false;
  assert.equal(await handoff(installer), '');
});

test('Linux refuses destinations in the private cache, including a symlinked directory', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'criprox-handoff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  await mkdir(cache);
  const installer = path.join(cache, 'update.AppImage');
  await writeFile(installer, 'verified app');
  const alias = path.join(root, 'alias');
  await symlink(cache, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const filePath of [installer, path.join(alias, 'new.AppImage')]) {
    const handoff = createInstallerHandoff({
      platform: 'linux',
      downloads: root,
      chooseDestination: async () => ({ filePath, canceled: false }),
      launch: () => {
        throw new Error('Must not launch');
      },
    });
    await assert.rejects(handoff(installer), /outside the update cache/);
    assert.equal(await readFile(installer, 'utf8'), 'verified app');
  }
});

test('macOS help copies only the fixed command and opens Terminal without executing it', async () => {
  const copied: string[] = [],
    opened: string[] = [];
  let error = '';
  const dependencies = {
    clipboard: { writeText: (text: string) => copied.push(text) },
    openPath: async (file: string) => {
      opened.push(file);
      return error;
    },
  };
  const help = createMacUpdateHelp({ platform: 'darwin', ...dependencies });
  help.copyCommand();
  assert.deepEqual(copied, ['xattr -dr com.apple.quarantine "/Applications/Skarix.app"']);
  assert.equal(copied[0], MAC_UNBLOCK_COMMAND);
  await help.openTerminal();
  assert.deepEqual(opened, ['/System/Applications/Utilities/Terminal.app']);
  error = 'Cannot open Terminal';
  await assert.rejects(help.openTerminal(), /Cannot open Terminal/);
  for (const platform of ['win32', 'linux']) {
    const other = createMacUpdateHelp({ platform, ...dependencies });
    assert.throws(() => other.copyCommand(), /only available on macOS/);
    await assert.rejects(other.openTerminal(), /only available on macOS/);
  }
  assert.equal(copied.length, 1);
  assert.equal(opened.length, 2);
});

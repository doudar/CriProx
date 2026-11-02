import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const { findCricutInstallation } = createRequire(import.meta.url)(
  '../electron/cricut-installation.cjs',
);

test('installation discovery reports files only, without treating an installed bridge as a connected machine', async () => {
  const root = path.join('C:\\User\\Local', 'Programs', 'Cricut Design Space');
  const files = new Set([
    path.join(root, 'Cricut Design Space.exe'),
    path.join(root, 'resources', 'plugins', 'cricut-device-io', 'CricutDeviceIO.exe'),
  ]);
  const io = {
    stat: async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return { isFile: () => true };
    },
    readFile: async () => '43.2.0\n',
  };
  assert.deepEqual(
    await findCricutInstallation({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\User\\Local' },
      io,
    }),
    {
      executable: path.join(root, 'Cricut Design Space.exe'),
      launchPath: path.join(root, 'Cricut Design Space.exe'),
      applicationVersion: null,
      platform: 'win32',
      archivePath: path.join(root, 'resources', 'app.asar'),
      bridgeExecutable: path.join(
        root,
        'resources',
        'plugins/cricut-device-io',
        'CricutDeviceIO.exe',
      ),
      version: '43.2.0',
      bridgeInstalled: true,
    },
  );
  assert.equal(await findCricutInstallation({ platform: 'linux', env: {}, io }), null);
  assert.equal(await findCricutInstallation({ platform: 'win32', env: {}, io }), null);
  files.delete(path.join(root, 'resources', 'plugins', 'cricut-device-io', 'CricutDeviceIO.exe'));
  const partial = await findCricutInstallation({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\User\\Local' },
    io: { ...io, readFile: async () => '<bad metadata>' },
  });
  assert.equal(partial.version, null);
  assert.equal(partial.bridgeInstalled, false);
});

test('Mac discovery resolves system and user bundles with explicit native paths', async () => {
  for (const root of [
    '/Applications/Cricut Design Space.app',
    '/Users/test/Applications/Cricut Design Space.app',
  ]) {
    const files = new Set([
      root + '/Contents/MacOS/Cricut Design Space',
      root + '/Contents/Resources/plugins/cricut-device-io/CricutDeviceIO',
    ]);
    const result = await findCricutInstallation({
      platform: 'darwin',
      home: '/Users/test',
      env: {},
      io: {
        stat: async (p: string) => {
          if (!files.has(p)) throw Error('ENOENT');
          return { isFile: () => true };
        },
        readFile: async () =>
          Buffer.from(
            '<plist><key>CFBundleShortVersionString</key><string>10.8.81</string></plist>',
          ),
      },
    });
    assert.equal(result.applicationVersion, '10.8.81');
    assert.equal(result.launchPath, root);
    assert.equal(result.archivePath, root + '/Contents/Resources/app.asar');
    assert.equal(
      result.bridgeExecutable,
      root + '/Contents/Resources/plugins/cricut-device-io/CricutDeviceIO',
    );
    assert.equal(result.bridgeInstalled, true);
  }
});

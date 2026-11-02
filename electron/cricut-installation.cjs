const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function bundleVersion(plist, io) {
  const bytes = await io.readFile(plist);
  const xml = bytes.toString('utf8');
  const match = xml.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([0-9.]+)<\/string>/);
  if (match) return match[1];
  if (bytes.subarray(0, 8).toString() !== 'bplist00') return null;
  const { stdout } = await promisify(execFile)(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist],
    { timeout: 3000, maxBuffer: 1024 },
  );
  return stdout.trim();
}
// Finding installed files does not establish device connectivity.
async function findCricutInstallation({
  platform = process.platform,
  env = process.env,
  io = fs,
  home = env.HOME || env.USERPROFILE || os.homedir(),
  readBundleVersion = bundleVersion,
} = {}) {
  if (!['win32', 'darwin'].includes(platform)) return null;
  const paths = platform === 'darwin' ? path.posix : path;
  const roots =
    platform === 'darwin'
      ? [
          '/Applications/Cricut Design Space.app',
          paths.join(home, 'Applications/Cricut Design Space.app'),
        ]
      : [
          env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, 'Programs', 'Cricut Design Space'),
          env.USERPROFILE &&
            paths.join(env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Cricut Design Space'),
          env.ProgramFiles && paths.join(env.ProgramFiles, 'Cricut Design Space'),
        ].filter(Boolean);
  for (const root of roots) {
    const executable =
      platform === 'darwin'
        ? paths.join(root, 'Contents/MacOS/Cricut Design Space')
        : paths.join(root, 'Cricut Design Space.exe');
    try {
      if (!(await io.stat(executable)).isFile()) continue;
    } catch {
      continue;
    }
    const resources =
      platform === 'darwin'
        ? paths.join(root, 'Contents/Resources')
        : paths.join(root, 'resources');
    const archivePath = paths.join(resources, 'app.asar');
    const bridgeExecutable = paths.join(
      resources,
      'plugins/cricut-device-io',
      platform === 'darwin' ? 'CricutDeviceIO' : 'CricutDeviceIO.exe',
    );
    let version = null,
      applicationVersion = null,
      bridgeInstalled = false;
    try {
      const text =
        platform === 'darwin'
          ? await readBundleVersion(paths.join(root, 'Contents/Info.plist'), io)
          : (await io.readFile(paths.join(root, 'version'), 'utf8')).trim();
      if (/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(text)) version = text;
      if (platform === 'darwin') applicationVersion = version;
    } catch {
      /* Optional metadata; the runtime loader rejects unverified versions. */
    }
    try {
      bridgeInstalled = (await io.stat(bridgeExecutable)).isFile();
    } catch {}
    return {
      executable,
      launchPath: platform === 'darwin' ? root : executable,
      version,
      applicationVersion,
      platform,
      archivePath,
      bridgeExecutable,
      bridgeInstalled,
    };
  }
  return null;
}
module.exports = { findCricutInstallation };

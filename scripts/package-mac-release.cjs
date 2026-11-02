// Release-only entry point. Ordinary local and preview builds remain unsigned.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');

function checkCredentials(env) {
  const required = [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw Error(`Missing macOS release credentials: ${missing.join(', ')}`);
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw Error('Invalid APPLE_TEAM_ID.');
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false')
    throw Error('Signing must be enabled for a macOS release.');
}

function releaseConfig() {
  return structuredClone(require('../build/mac-release.cjs'));
}

function run(command, args) {
  const result = require('node:child_process').spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.error || result.status !== 0)
    throw Error(
      `${command} verification failed: ${result.error?.message || result.stderr || result.stdout}`,
    );
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function verifyApp(app, team, execute = run) {
  execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', app]);
  for (const arch of ['arm64', 'x86_64']) {
    const details = execute('/usr/bin/codesign', ['--display', '--verbose=4', '--arch', arch, app]);
    if (
      !details.includes(`Identifier=${pkg.build.appId}\n`) ||
      !details.includes(`TeamIdentifier=${team}\n`) ||
      !/^Authority=Developer ID Application:/m.test(details) ||
      !/\bflags=[^\n]*\bruntime\b/.test(details) ||
      /Info.plist=not bound|Signature=adhoc/.test(details)
    )
      throw Error(`Release app has an unexpected signing identity or runtime flags (${arch}).`);
  }
  execute('/usr/bin/xcrun', ['stapler', 'validate', app]);
  execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
}

function verifyInstaller(dmg, team) {
  run('/usr/bin/codesign', ['--verify', '--strict', dmg]);
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'skarix-release-verify-'));
  let mounted = false;
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    mounted = true;
    verifyApp(path.join(mount, `${pkg.build.productName}.app`), team);
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
    // Never recursively remove a mount point, including on failed detach.
    fs.rmdirSync(mount);
  }
}

async function main() {
  checkCredentials(process.env);
  if (process.platform !== 'darwin') throw Error('Signed macOS releases require a Mac build host.');
  const { build, Platform, Arch } = require('electron-builder');
  const artifacts = await build({
    targets: Platform.MAC.createTarget(['dmg'], Arch.universal),
    config: path.join(__dirname, '../build/mac-release.cjs'),
    publish: 'never',
  });
  const installers = artifacts.filter((file) => file.endsWith('.dmg'));
  if (installers.length !== 1)
    throw Error('Expected exactly one universal macOS release installer.');
  verifyInstaller(installers[0], process.env.APPLE_TEAM_ID);
  console.log('Verified the signed, notarized universal app inside the release DMG.');
}

function runRelease(task = main) {
  // An unresolved Promise does not keep Node alive. Require explicit completion
  // even if a signing dependency abandons its work or calls process.exit(0).
  let completed = false;
  process.once('exit', () => {
    if (!completed) {
      console.error(
        'macOS release exited before installer verification completed. No verified installer was produced.',
      );
      process.exitCode = 1;
    }
  });
  return Promise.resolve()
    .then(task)
    .then(
      () => {
        completed = true;
      },
      (error) => {
        completed = true;
        console.error(error.message);
        process.exitCode = 1;
      },
    );
}

module.exports = { checkCredentials, releaseConfig, verifyApp, runRelease };
if (require.main === module) runRelease();

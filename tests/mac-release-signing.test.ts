import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require = createRequire(import.meta.url);
const {
  checkCredentials,
  releaseConfig,
  verifyApp,
} = require('../scripts/package-mac-release.cjs');
const credentials = {
  CSC_LINK: 'test-certificate',
  CSC_KEY_PASSWORD: 'test-password',
  APPLE_ID: 'test@example.invalid',
  APPLE_APP_SPECIFIC_PASSWORD: 'test-notarization-password',
  APPLE_TEAM_ID: 'ABCDE12345',
};

test('release fails closed for missing credentials or disabled signing without exposing values', () => {
  checkCredentials(credentials);
  for (const name of Object.keys(credentials)) {
    const env = { ...credentials, [name]: '' };
    assert.throws(() => checkCredentials(env), new RegExp(name));
  }
  assert.throws(
    () => checkCredentials({ ...credentials, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }),
    /Signing must/,
  );
  assert.throws(
    () => checkCredentials({ ...credentials, APPLE_TEAM_ID: 'invalid' }),
    /Invalid APPLE_TEAM_ID/,
  );
});

test('release config overrides unsigned previews without changing their configuration', () => {
  const pkg = require('../package.json');
  const config = releaseConfig();
  assert.equal(config.extends, null);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(Object.hasOwn(config.mac, 'identity'), false);
  assert.equal(config.mac.notarize, true);
  assert.equal(config.mac.hardenedRuntime, true);
  assert.equal(config.dmg.sign, true);
  assert.equal(config.appId, 'com.criprox.studio');
  assert.equal(pkg.build.mac.identity, null);
});

test('electron-builder loads the release config without inheriting identity:null', async () => {
  const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = await getConfig(
    root,
    fileURLToPath(new URL('../build/mac-release.cjs', import.meta.url)),
    null,
  );
  assert.equal(config.mac.identity, undefined);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mac.notarize, true);
  await validateConfiguration(config);
});

const signed =
  'Identifier=com.criprox.studio\nTeamIdentifier=ABCDE12345\nAuthority=Developer ID Application: Test\nCodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=12\n';
test('verification checks both slices, notarization ticket, and Gatekeeper', () => {
  const calls: string[][] = [];
  verifyApp('/mount/Skarix.app', credentials.APPLE_TEAM_ID, (command: string, args: string[]) => {
    calls.push([command, ...args]);
    return args.includes('--display') ? signed : '';
  });
  assert.equal(calls.length, 5);
  assert.ok(calls[0].includes('--all-architectures'));
  assert.ok(calls[1].includes('arm64'));
  assert.ok(calls[2].includes('x86_64'));
  assert.deepEqual(calls[3].slice(0, 3), ['/usr/bin/xcrun', 'stapler', 'validate']);
  assert.equal(calls[4][0], '/usr/sbin/spctl');
});

test('verification rejects the observed Electron signature and wrong or incomplete release identities', () => {
  for (const bad of [
    signed.replace('Identifier=com.criprox.studio', 'Identifier=Electron'),
    signed.replace('TeamIdentifier=ABCDE12345', 'TeamIdentifier=OTHER12345'),
    signed.replace('Authority=Developer ID Application:', 'Authority=Apple Development:'),
    signed.replace('0x10000(runtime)', '0x0(none)'),
    signed + 'Info.plist=not bound\n',
    signed + 'Signature=adhoc\n',
  ]) {
    assert.throws(
      () =>
        verifyApp('/mount/Skarix.app', credentials.APPLE_TEAM_ID, (_: string, args: string[]) =>
          args.includes('--display') ? bad : '',
        ),
      /unexpected signing identity/,
    );
  }
});

test('signature, ticket, and Gatekeeper failures stop release verification', () => {
  for (const failure of ['--verify', 'stapler', '--assess']) {
    assert.throws(
      () =>
        verifyApp('/mount/Skarix.app', credentials.APPLE_TEAM_ID, (_: string, args: string[]) => {
          if (args.includes(failure)) throw Error('verification rejected');
          return signed;
        }),
      /verification rejected/,
    );
  }
});

test('release workflow scopes Apple secrets to the Mac signing step and gates publication', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /name: Build unsigned installer\s+if: matrix.platform != 'macos'/);
  assert.match(
    workflow,
    /name: Sign, notarize, and verify macOS release installer\s+if: matrix.platform == 'macos'\s+run: npm run package:mac:release/,
  );
  for (const name of [
    'MAC_CSC_LINK',
    'MAC_CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ])
    assert.ok(workflow.includes(`secrets.${name}`));
  assert.match(workflow, /needs: \[prepare, installers\]/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});

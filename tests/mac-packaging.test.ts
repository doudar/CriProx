import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('macOS installer previews remain unsigned and do not receive signing secrets', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const releaseWorkflow = await readFile(
    new URL('../.github/workflows/installer-previews.yml', import.meta.url),
    'utf8',
  );
  const mac = packageJson.build.mac;

  assert.equal(mac.identity, null);
  assert.equal(mac.hardenedRuntime, true);
  assert.equal(mac.notarize, undefined);
  assert.match(mac.extendInfo.NSDocumentsFolderUsageDescription, /folders you choose/);
  assert.doesNotMatch(packageJson.scripts['package:mac'], /forceCodeSigning/);
  for (const secret of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ]) {
    assert.doesNotMatch(
      releaseWorkflow,
      new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`),
    );
  }
});

test('installer previews build the selected revision without publishing or changing releases', async () => {
  const releaseWorkflow = await readFile(
    new URL('../.github/workflows/installer-previews.yml', import.meta.url),
    'utf8',
  );

  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(releaseWorkflow, /^\s+(push|pull_request|pull_request_target|release):/m);
  assert.match(releaseWorkflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(releaseWorkflow, /persist-credentials: false/);
  assert.match(releaseWorkflow, /contents: read/);
  assert.doesNotMatch(releaseWorkflow, /contents: write|secrets\.|gh release|git (push|tag)/);
  assert.match(releaseWorkflow, /CSC_IDENTITY_AUTO_DISCOVERY: ['"]false['"]/);
  assert.match(releaseWorkflow, /scripts\/installer-manifest\.cjs/);
  assert.match(releaseWorkflow, /release\/SHA256SUMS\.txt/);
  assert.match(releaseWorkflow, /release\/SOURCE\.txt/);
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const platform of ['mac', 'windows', 'linux']) {
    assert.match(releaseWorkflow, new RegExp(`script: package:${platform}`));
    assert.match(packageJson.scripts[`package:${platform}`], /--publish never/);
  }
});

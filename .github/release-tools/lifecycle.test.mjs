import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installerNames } from './lib.mjs';

test('publication waits for complete installers, resumes a draft, and leaves a published release intact', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'skarix-release-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  run('init');
  run('config', 'user.name', 'Release test');
  run('config', 'user.email', 'test@example.com');
  for (const file of ['package.json', 'package-lock.json'])
    writeFileSync(path.join(directory, file), JSON.stringify({ version: '1.2.2' }));
  writeFileSync(
    path.join(directory, '.release-please-manifest.json'),
    JSON.stringify({ '.': '1.2.2' }),
  );
  writeFileSync(path.join(directory, 'CHANGELOG.md'), 'old notes');
  run('add', '.');
  run('commit', '-m', 'fix: preserve projects');
  const base = run('rev-parse', 'HEAD');
  for (const file of ['package.json', 'package-lock.json'])
    writeFileSync(path.join(directory, file), JSON.stringify({ version: '1.2.3' }));
  writeFileSync(
    path.join(directory, '.release-please-manifest.json'),
    JSON.stringify({ '.': '1.2.3' }),
  );
  writeFileSync(path.join(directory, 'CHANGELOG.md'), 'new notes');
  run('add', '.');
  run('commit', '-m', 'chore(main): release 1.2.3');
  const metadata = { base, sha: run('rev-parse', 'HEAD'), version: '1.2.3', tag: 'v1.2.3' };
  const prepared = path.join(directory, 'prepared');
  const assets = path.join(directory, 'assets');
  mkdirSync(prepared);
  mkdirSync(assets);
  writeFileSync(path.join(prepared, 'metadata.json'), JSON.stringify(metadata));
  writeFileSync(path.join(prepared, 'notes.md'), 'Release notes');
  const stateFile = path.join(directory, 'state.json');
  writeFileSync(stateFile, JSON.stringify({ head: base, tagged: false, release: null, calls: [] }));
  const preload = path.join(directory, 'mock-github.mjs');
  // Run the production entry point with real Git/file operations. Only GitHub
  // requests and commands that contact GitHub are replaced; no credentials or
  // network access are used by this test.
  writeFileSync(
    preload,
    `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const metadata = ${JSON.stringify(metadata)};
const stateFile = ${JSON.stringify(stateFile)};
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const original = childProcess.execFileSync;
childProcess.execFileSync = (command, args, options) => {
  if (command === 'git' && args.includes('push')) {
    assert.ok(args.includes('--atomic'));
    assert.ok(args.includes(metadata.sha + ':refs/heads/main'));
    state.calls.push('push'); state.head = metadata.sha; state.tagged = true; save();
    return '';
  }
  if (command === 'gh') {
    assert.deepEqual(args.slice(0, 3), ['release', 'upload', metadata.tag]);
    assert.equal(state.release.draft, true);
    state.calls.push('upload'); save();
    if (process.env.FAIL_UPLOAD === 'true') throw new Error('Simulated upload interruption');
    return '';
  }
  return original(command, args, options);
};
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  const route = new URL(url).pathname.replace('/repos/doudar/Skarix/', '') + new URL(url).search;
  state.calls.push((options.method || 'GET') + ' ' + route); save();
  let value;
  if (route === 'git/ref/tags/' + metadata.tag) value = state.tagged ? { object: { sha: metadata.sha } } : null;
  else if (route === 'git/ref/heads/main') value = { object: { sha: state.head } };
  else if (route === 'releases/tags/' + metadata.tag) value = state.release;
  else if (route === 'releases' && options.method === 'POST') {
    assert.ok(state.tagged, 'tag must be pushed before creating a release');
    value = state.release = { id: 1, ...JSON.parse(options.body) };
    assert.equal(value.draft, true); assert.equal(value.name, metadata.tag); save();
  } else if (route === 'releases/1/assets?per_page=100') {
    value = readdirSync(process.env.ASSETS_DIR).map(name => ({ name, state: 'uploaded', size: readFileSync(path.join(process.env.ASSETS_DIR, name)).length }));
  } else if (route === 'releases/1' && options.method === 'PATCH') {
    assert.ok(state.calls.includes('upload'));
    Object.assign(state.release, JSON.parse(options.body)); value = state.release; save();
  } else throw new Error('Unexpected GitHub request: ' + route);
  return new Response(JSON.stringify(value), { status: value === null ? 404 : 200 });
};
`,
  );
  const publish = fileURLToPath(new URL('./publish.mjs', import.meta.url));
  const execute = (extra = {}) =>
    execFileSync(process.execPath, ['--import', pathToFileURL(preload).href, publish], {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_REPOSITORY: 'doudar/Skarix',
        PREPARED_DIR: prepared,
        ASSETS_DIR: assets,
        ...extra,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  assert.throws(() => execute(), /exactly the three/);
  assert.deepEqual(
    JSON.parse(readFileSync(stateFile)).calls,
    [],
    'incomplete installers must not contact GitHub',
  );
  for (const name of installerNames(metadata.version)) writeFileSync(path.join(assets, name), name);
  assert.throws(() => execute({ FAIL_UPLOAD: 'true' }), /Simulated upload interruption/);
  let state = JSON.parse(readFileSync(stateFile));
  assert.equal(state.tagged, true);
  assert.equal(state.release.draft, true, 'an interrupted upload must remain unpublished');
  // A retry downloads fresh installer artifacts, without generated manifests.
  for (const name of ['SHA256SUMS.txt', 'SOURCE.txt']) rmSync(path.join(assets, name));
  execute();
  state = JSON.parse(readFileSync(stateFile));
  assert.equal(state.release.draft, false);
  assert.equal(state.release.name, metadata.tag);
  assert.equal(
    state.calls.filter((call) => call === 'push').length,
    1,
    'a retry must reuse the existing tag',
  );
  for (const name of ['SHA256SUMS.txt', 'SOURCE.txt']) rmSync(path.join(assets, name));
  const uploads = state.calls.filter((call) => call === 'upload').length;
  execute();
  state = JSON.parse(readFileSync(stateFile));
  assert.equal(
    state.calls.filter((call) => call === 'upload').length,
    uploads,
    'published assets must never be overwritten',
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { findUpscayl, runUpscayl } = require('../electron/upscayl.cjs');

test('detects a desktop installation only when its engine and Ultramix model are present', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-detect-test-'));
  try {
    await fs.mkdir(path.join(root, 'bin'));
    await fs.mkdir(path.join(root, 'models'));
    await fs.writeFile(path.join(root, 'bin', 'upscayl-bin'), 'binary');
    await fs.writeFile(path.join(root, 'models', 'ultramix-balanced-4x.param'), 'model');
    assert.equal(await findUpscayl([root], 'darwin'), null);
    await fs.writeFile(path.join(root, 'models', 'ultramix-balanced-4x.bin'), 'weights');
    const installation = await findUpscayl([root], 'darwin');
    assert.equal(installation.binary, path.join(root, 'bin', 'upscayl-bin'));
    assert.match(installation.cacheKey, /^\d+-\d+-\d+-\d+-\d+-\d+$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runs the installed engine with explicit model paths and returns its PNG', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-engine-test-'));
  const binary = path.join(root, 'fake-engine.cjs');
  const models = path.join(root, 'models');
  try {
    await fs.mkdir(models);
    await fs.writeFile(
      binary,
      `const fs = require('node:fs');
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
if (value('-n') !== 'ultramix-balanced-4x' || value('-s') !== '4' || value('-m') !== ${JSON.stringify(models)} || value('-f') !== 'png') process.exit(2);
fs.copyFileSync(value('-i'), value('-o'));
`,
    );
    const input = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
    const output = await runUpscayl(
      input,
      { binary, models },
      {
        spawnProcess(command: string, args: string[], options: SpawnOptions) {
          assert.equal(command, binary);
          return spawn(process.execPath, [command, ...args], options);
        },
      },
    );
    assert.deepEqual(Uint8Array.from(output), input);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

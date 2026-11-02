// Load only hash-verified components from the user's installed Design Space.
// No Cricut runtime code or keys are distributed with Skarix.
// Electron virtualizes .asar paths. Read the installed archive as raw bytes for hash verification.
const fs = process.versions.electron
  ? require('original-fs').promises
  : require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { brotliDecompressSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { findCricutInstallation } = require('../cricut-installation.cjs');

const VERIFIED_FILES = {
  'design-space-app/chunk-TO5TFYMB.js':
    'fd017c3890886e2aee5969d35af6b4ec878b0930319ee5a7ea46862a1eb7a3a1',
  'design-space-app/chunk-2ZBRDBX3.js':
    '919fcf8f33935996a72ad158c04fb7d0103e82ed003e8a4730745ecf440355a6',
  'design-space-app/chunk-IN2AQKOL.js':
    'b3928298c373fac2ab3e36fb855ef4b74ff54c65a2b6adb65e37f6d7bb9d68d1',
  'static-asset/wasm/Bifrost.wasm.br':
    'c5bda89f968959967cbf63da3bc84bb1a4fe8001536c356e5f1f6db118310c5c',
};

const UPDATED_FILES = {
  'design-space-app/chunk-KEEGO4M6.js':
    '6dc259e6eea14c17c3c080e14895d269ec22fb5a999cb29ffe9ba69267646e4c',
  'design-space-app/chunk-2ZBRDBX3.js': VERIFIED_FILES['design-space-app/chunk-2ZBRDBX3.js'],
  'design-space-app/chunk-IN2AQKOL.js': VERIFIED_FILES['design-space-app/chunk-IN2AQKOL.js'],
  'static-asset/wasm/Bifrost.wasm.br':
    '3e7d5ae2b6c3afbf45f9f398bcf96c8ae9a29a9a7de987e8e26f2976f770af57',
};

async function readVerifiedRuntime(archive) {
  const handle = await fs.open(archive, 'r');
  try {
    const read = async (size, offset) => {
      const bytes = Buffer.alloc(size);
      let completed = 0;
      while (completed < size) {
        const result = await handle.read(bytes, completed, size - completed, offset + completed);
        if (!result.bytesRead) throw new Error('Truncated Design Space archive');
        completed += result.bytesRead;
      }
      return bytes;
    };
    const header = await read(16, 0),
      length = header.readUInt32LE(12);
    if (!length || length > 16 * 1024 * 1024)
      throw new Error('Invalid Design Space archive header');
    const index = JSON.parse((await read(length, 16)).toString('utf8'));
    const base = 8 + header.readUInt32LE(4),
      total = (await handle.stat()).size;
    const result = {};
    const manifest = index.files?.['design-space-app']?.files?.['chunk-KEEGO4M6.js']
      ? UPDATED_FILES
      : VERIFIED_FILES;
    for (const [name, expected] of Object.entries(manifest)) {
      const entry = name.split('/').reduce((node, part) => node?.files?.[part], index);
      const offset = base + Number(entry?.offset),
        size = entry?.size;
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 30 * 1024 * 1024 ||
        offset < base ||
        offset + size > total
      )
        throw new Error(`Missing or invalid runtime component: ${name}`);
      const bytes = await read(size, offset);
      if (createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error(
          `Unverified Cricut runtime component: ${name}. Re-inspect this build before executing it.`,
        );
      result[name] = bytes;
    }
    return result;
  } finally {
    await handle.close();
  }
}

async function loadInstalledRuntime() {
  const installation = await findCricutInstallation();
  if (
    !installation ||
    (installation.platform === 'darwin'
      ? installation.applicationVersion !== '10.8.81'
      : installation.version !== '43.2.0')
  )
    throw new Error(
      'Unverified Design Space installation. Direct connection requires the inspected 10.8.81 build.',
    );
  const files = await readVerifiedRuntime(installation.archivePath);
  const updated = !!files['design-space-app/chunk-KEEGO4M6.js'];
  const source =
    files[
      updated ? 'design-space-app/chunk-KEEGO4M6.js' : 'design-space-app/chunk-TO5TFYMB.js'
    ].toString('utf8');
  const start = source.indexOf(updated ? 'function M_(' : 'function v_('),
    end = source.indexOf(updated ? 'var At,qi,uo' : 'var Ut,Ji');
  if (start < 0 || end <= start) throw new Error('Cannot isolate the inspected WASM wrapper');
  const scratchParent = path.resolve(os.tmpdir());
  const scratch = await fs.mkdtemp(path.join(scratchParent, 'skarix-cutter-runtime-'));
  try {
    await fs.writeFile(path.join(scratch, 'package.json'), '{"type":"module"}');
    for (const name of ['chunk-2ZBRDBX3.js', 'chunk-IN2AQKOL.js'])
      await fs.writeFile(path.join(scratch, name), files[`design-space-app/${name}`]);
    const loader = [
      updated
        ? "import {l as Zb,m as Jb} from './chunk-2ZBRDBX3.js';"
        : "import {l as Mb,m as wb} from './chunk-2ZBRDBX3.js';",
      updated
        ? "import {a as G,b as re} from './chunk-IN2AQKOL.js';"
        : "import {a as j,b as oe} from './chunk-IN2AQKOL.js';",
      updated ? "import * as Od from 'node:buffer';" : "import * as fd from 'node:buffer';",
      source.slice(start, end),
      'export async function load(bytes) {',
      updated
        ? '  const wrapper = new zT(Zb, Jb), imports = {};'
        : '  const wrapper = new wT(Mb, wb), imports = {};',
      updated
        ? '  for (const part of [wrapper.exports, rL, nL, oL, sL, cL, tL])'
        : '  for (const part of [wrapper.exports, kw, Uw, Hw, Vw, jw, Bw])',
      '    for (const [name, values] of Object.entries(part)) imports[name] = {...imports[name], ...values};',
      '  const {instance} = await WebAssembly.instantiate(bytes, imports);',
      '  const api = wrapper.init(instance);',
      updated
        ? '  iL(api, {wasmNapi: wrapper}); aL(api, {wasmNapi: wrapper});'
        : '  Fw(api, {wasmNapi: wrapper}); Gw(api, {wasmNapi: wrapper});',
      '  return api;',
      '}',
    ].join('\n');
    await fs.writeFile(path.join(scratch, 'loader.mjs'), loader);
    const module = await import(pathToFileURL(path.join(scratch, 'loader.mjs')).href);
    const wasm = brotliDecompressSync(files['static-asset/wasm/Bifrost.wasm.br'], {
      maxOutputLength: 80 * 1024 * 1024,
    });
    return {
      installation,
      applicationVersion: updated ? '10.8.81' : null,
      api: await module.load(wasm),
    };
  } finally {
    const resolved = path.resolve(scratch);
    if (
      path.dirname(resolved) !== scratchParent ||
      !path.basename(resolved).startsWith('skarix-cutter-runtime-')
    )
      throw new Error('Unexpected runtime scratch directory');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

module.exports = { loadInstalledRuntime, readVerifiedRuntime };

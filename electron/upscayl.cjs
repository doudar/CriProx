const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODEL = 'ultramix-balanced-4x';
const MAX_INPUT_BYTES = 50_000_000;
const MAX_OUTPUT_BYTES = 200_000_000;

function installationRoots(platform = process.platform, env = process.env) {
  if (platform === 'darwin')
    return [
      '/Applications/Upscayl.app/Contents/Resources',
      path.join(os.homedir(), 'Applications/Upscayl.app/Contents/Resources'),
    ];
  if (platform === 'win32')
    return [
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs/Upscayl/resources'),
      env.ProgramFiles && path.join(env.ProgramFiles, 'Upscayl/resources'),
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Upscayl/resources'),
    ].filter(Boolean);
  return [
    '/opt/Upscayl/resources',
    '/opt/upscayl/resources',
    '/usr/lib/upscayl/resources',
    '/usr/share/upscayl/resources',
    '/app/upscayl/resources',
  ];
}

async function findUpscayl(roots = installationRoots(), platform = process.platform) {
  const binaryName = platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
  for (const root of roots) {
    const binary = path.join(root, 'bin', binaryName);
    const models = path.join(root, 'models');
    try {
      const [binaryStat, modelStat, weightsStat] = await Promise.all([
        fs.stat(binary),
        fs.stat(path.join(models, `${MODEL}.param`)),
        fs.stat(path.join(models, `${MODEL}.bin`)),
      ]);
      if (!binaryStat.isFile() || !modelStat.isFile() || !weightsStat.isFile()) continue;
      return {
        binary,
        models,
        cacheKey: `${binaryStat.size}-${Math.floor(binaryStat.mtimeMs)}-${modelStat.size}-${Math.floor(modelStat.mtimeMs)}-${weightsStat.size}-${Math.floor(weightsStat.mtimeMs)}`,
      };
    } catch {
      // Continue through the known installation locations.
    }
  }
  return null;
}

async function runUpscayl(input, installation, { signal, spawnProcess = spawn } = {}) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > MAX_INPUT_BYTES)
    throw new Error('Upscayl input must be a PNG smaller than 50 MB.');
  if (!installation) throw new Error('Upscayl is not installed in a supported location.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-upscayl-'));
  const source = path.join(directory, 'input.png');
  const output = path.join(directory, 'output.png');
  try {
    await fs.writeFile(source, input);
    await new Promise((resolve, reject) => {
      const child = spawnProcess(
        installation.binary,
        [
          '-i',
          source,
          '-o',
          output,
          '-m',
          installation.models,
          '-n',
          MODEL,
          '-s',
          '4',
          '-f',
          'png',
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let errorText = '';
      const abort = () => child.kill();
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      child.stderr?.on('data', (chunk) => {
        errorText = (errorText + chunk.toString()).slice(-4000);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(new Error('Upscayl was cancelled.'));
        else if (code === 0) resolve();
        else
          reject(
            new Error(
              `Upscayl exited with code ${code}: ${errorText.trim() || 'check GPU support and the Upscayl installation.'}`,
            ),
          );
      });
    });
    const resultFile = await fs.open(output, 'r');
    try {
      const stat = await resultFile.stat();
      if (!stat.isFile() || !stat.size || stat.size > MAX_OUTPUT_BYTES)
        throw new Error('Upscayl produced an invalid or oversized image.');
      const result = await resultFile.readFile();
      if (result.length > MAX_OUTPUT_BYTES) throw new Error('Upscayl produced an oversized image.');
      return result;
    } finally {
      await resultFile.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { findUpscayl, installationRoots, runUpscayl };

// Optional smoke check: node tests/ai-design-packaged.cjs path/to/CriProx.exe
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  { createInterface } = require('node:readline');
const { createAiServer } = require('../electron/ai-server.cjs');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'criprox-packaged-mcp-')),
    file = path.join(directory, 'connection.json');
  let child;
  const service = createAiServer({
    connectionFile: file,
    invoke: async (_owner, name, args) => ({ name, args }),
  });
  try {
    await service.start(1);
    const executable = path.resolve(process.argv[2]);
    child = spawn(
      executable,
      [path.join(path.dirname(executable), 'resources', 'ai-stdio.cjs'), '--connection-file', file],
      {
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b));
    const lines = createInterface({ input: child.stdout });
    let id = 0;
    const pending = new Map();
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const m = JSON.parse(line),
          p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          p.resolve(m);
        }
      } catch {
        for (const p of pending.values())
          p.reject(
            Error(
              'Packaged MCP wrote non-protocol data to stdout: ' +
                line.replace(/[a-f0-9]{64}/gi, '[redacted]').slice(0, 240),
            ),
          );
      }
    });
    child.on('error', (e) => {
      for (const p of pending.values()) p.reject(e);
    });
    child.on('exit', (code) => {
      for (const p of pending.values()) p.reject(Error(`Relay exited ${code}: ${stderr}`));
    });
    async function request(method, params) {
      const key = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Packaged MCP timed out: ' + stderr)), 15000);
        pending.set(key, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
      });
    }
    const init = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'packaged-regression', version: '1' },
    });
    assert.equal(init.result.serverInfo.name, 'criprox-design');
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    const listed = await request('tools/list');
    assert.equal(listed.result.tools.length, 18);
    const blocked = await request('tools/call', { name: 'cut_sheet', arguments: {} });
    assert(blocked.error || blocked.result?.isError);
    const read = await request('tools/call', {
      name: 'get_workspace',
      arguments: { workspace: 'stickers' },
    });
    assert.equal(read.result.structuredContent.name, 'get_workspace');
    child.stdin.end();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Relay did not exit on stdin closure.')), 5000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(Error('Relay exit ' + code + ': ' + stderr));
      });
    });
    console.log(
      'PASS: Packaged executable stdio initialize, 18 tools, design request, rejected cut request, clean shutdown.',
    );
  } finally {
    child?.kill();
    await service.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

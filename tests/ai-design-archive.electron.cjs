// Optional headless smoke: electron tests/ai-design-archive.electron.cjs path/to/app.asar
const { app } = require('electron');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
let directory, service;
(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-mcp-archive-'));
  app.setPath('userData', path.join(directory, 'profile'));
  await app.whenReady();
  const { createAiServer } = require(
    path.join(path.resolve(process.argv[2]), 'electron', 'ai-server.cjs'),
  );
  const file = path.join(directory, 'connection.json');
  service = createAiServer({ connectionFile: file, invoke: async () => ({ ok: true }) });
  await service.start(1);
  const c = JSON.parse(await fs.readFile(file, 'utf8'));
  const response = await fetch(c.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_workspace', arguments: { workspace: 'stickers' } },
    }),
  });
  const result = await response.json();
  assert.equal(result.result.structuredContent.ok, true);
  console.log(
    'PASS: Packaged MCP SDK, HTTP adapter, schemas and dependencies load and serve a design request from app.asar.',
  );
})().then(
  async () => {
    await service?.stop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    app.quit();
  },
  async (error) => {
    console.error(error);
    await service?.stop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    app.exit(1);
  },
);

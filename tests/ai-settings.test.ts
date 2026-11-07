import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const { installAiBridge } = require('../electron/ai-bridge.cjs');
const { createAiServer } = require('../electron/ai-server.cjs');
const { relay } = require('../electron/ai-stdio.cjs');

function session(directory: string, id = 1) {
  const handlers = new Map<string, Function>();
  const frame = {},
    sender = { mainFrame: frame },
    event = { sender, senderFrame: frame };
  let config = '';
  const bridge = installAiBridge({
    ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn) },
    BrowserWindow: { fromWebContents: () => ({ id }), fromId: () => undefined },
    clipboard: { writeText: (value: string) => (config = value) },
    app: {
      getVersion: () => '1.0.0',
      getPath: (name: string) => (name === 'exe' ? 'C:/Skarix.exe' : directory),
      isPackaged: false,
    },
    checkSender: (value: any) => assert.equal(value.sender, sender),
  });
  return {
    bridge,
    call: (name: string) => handlers.get(`ai-design-${name}`)!(event),
    config: () => {
      handlers.get('ai-design-copy-config')!(event);
      return config;
    },
  };
}

test('MCP remembers Start across quit and window closure, while Stop persists across sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skarix-ai-settings-'));
  const sessions: ReturnType<typeof session>[] = [];
  const open = () => {
    const s = session(directory);
    sessions.push(s);
    return s;
  };
  const connection = join(directory, 'ai-design-connection.json');
  const settings = join(directory, 'ai-design-settings.json');
  try {
    const first = open();
    await first.call('ready');
    assert.equal((await first.call('status')).running, false);
    await first.call('start');
    const config = first.config();
    const oldConnection = JSON.parse(await readFile(connection, 'utf8'));
    await first.bridge.stop(); // App quit preserves enabled preference.
    assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), { enabled: true });
    await assert.rejects(readFile(connection), { code: 'ENOENT' });

    const second = open();
    const restoring = second.call('ready');
    assert.equal((await second.call('status')).running, true, 'status waits for restoration');
    await restoring;
    assert.equal(second.config(), config, 'client configuration is reusable');
    assert.notEqual(JSON.parse(await readFile(connection, 'utf8')).token, oldConnection.token);
    await second.bridge.windowClosed(1);
    await assert.rejects(readFile(connection), { code: 'ENOENT' });
    await second.call('ready'); // macOS can reopen a window without quitting.
    assert.equal((await second.call('status')).running, true);
    await second.call('stop');
    await second.call('ready'); // Re-registering a renderer listener must not undo Stop.
    assert.equal((await second.call('status')).running, false);
    assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), { enabled: false });
    await second.bridge.stop();

    const third = open();
    await third.call('ready');
    assert.equal((await third.call('status')).running, false);
  } finally {
    for (const s of sessions) await s.bridge.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('shutdown waits for in-progress MCP restore and preserves the next-launch preference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skarix-ai-restore-close-'));
  await writeFile(join(directory, 'ai-design-settings.json'), JSON.stringify({ enabled: true }));
  const s = session(directory);
  try {
    const restoring = s.call('ready');
    const closing = s.bridge.windowClosed(1);
    const quitting = s.bridge.stop();
    await Promise.all([restoring, closing, quitting]);
    assert.equal((await s.call('status')).running, false);
    await assert.rejects(readFile(join(directory, 'ai-design-connection.json')), {
      code: 'ENOENT',
    });
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'ai-design-settings.json'), 'utf8')),
      { enabled: true },
    );
  } finally {
    await s.bridge.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('MCP restore reports an occupied connection without replacing the owner or disabling the preference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skarix-ai-restore-owner-'));
  const first = session(directory),
    second = session(directory, 2);
  const connection = join(directory, 'ai-design-connection.json');
  try {
    await first.call('start');
    const original = await readFile(connection, 'utf8');
    await second.call('ready');
    const state = await second.call('status');
    assert.equal(state.running, false);
    assert.match(state.error, /Could not restore.*Another Skarix/);
    await assert.rejects(second.call('start'), /Another Skarix/);
    assert.equal(await readFile(connection, 'utf8'), original);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'ai-design-settings.json'), 'utf8')),
      { enabled: true },
    );
    await first.bridge.stop();
    await second.call('start');
    assert.equal((await second.call('status')).error, '');
  } finally {
    await second.bridge.stop();
    await first.bridge.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing, malformed and non-boolean MCP preferences do not auto-enable access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skarix-ai-settings-invalid-'));
  try {
    for (const content of [undefined, '{', 'null', '{"enabled":"true"}', '{"enabled":false}']) {
      if (content !== undefined)
        await writeFile(join(directory, 'ai-design-settings.json'), content);
      const s = session(directory);
      try {
        await s.call('ready');
        assert.equal((await s.call('status')).running, false);
      } finally {
        await s.bridge.stop();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a running MCP relay reconnects after server restart and validates every new connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skarix-ai-relay-restart-'));
  const connectionFile = join(directory, 'connection.json');
  const service = createAiServer({ connectionFile, invoke: async () => ({ ok: true }) });
  const input = new PassThrough(),
    output = new PassThrough();
  let requests = 0;
  const running = relay({
    connectionFile,
    input,
    output,
    fetchImpl: (...args: Parameters<typeof fetch>) => {
      requests++;
      return fetch(...args);
    },
  });
  async function ping(id: number) {
    const response = new Promise<any>((resolve) =>
      output.once('data', (chunk) => resolve(JSON.parse(chunk.toString()))),
    );
    input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) + '\n');
    return response;
  }
  try {
    assert.ok((await ping(1)).error, 'relay survives launch before the GUI server');
    await service.start(1);
    assert.deepEqual((await ping(2)).result, {});
    await service.stop();
    await service.start(2);
    assert.deepEqual((await ping(3)).result, {});
    await writeFile(
      connectionFile,
      JSON.stringify({ url: 'https://example.com/mcp', token: 'a'.repeat(64) }),
    );
    assert.match((await ping(4)).error.message, /Invalid local/);
    assert.equal(requests, 2, 'invalid new targets never receive a request');
  } finally {
    input.end();
    await running;
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

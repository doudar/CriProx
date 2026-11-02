import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { applyDesignOperations, invokeAiDesign, registerAiWorkspace } from '../src/lib/ai-design';
import { newDesign, newElement, designSvg, validateStickerDesign } from '../src/lib/sticker-design';
import {
  newStickerProject,
  stickerGeometryKey,
  validateStickerProject,
  type StickerProject,
} from '../src/lib/stickers';

const require = createRequire(import.meta.url);
const { DESIGN_TOOLS, designTool } = require('../electron/ai-tools.cjs');
const { createAiServer } = require('../electron/ai-server.cjs');
const { relay, validateConnection } = require('../electron/ai-stdio.cjs');

test('AI catalogue has no printer/cutter/IPC execution tools and rejects unknown fields', () => {
  for (const name of [
    'print',
    'cut',
    'cut_sheet',
    'cutter-connect',
    'prepare_print',
    'eval',
    'execute',
    'ai-design-start',
  ])
    assert.throws(() => designTool(name), /Unknown design tool/);
  assert.equal(DESIGN_TOOLS.length, 15);
  assert.throws(() =>
    designTool('update_project_settings').schema.parse({
      workspace: 'cards',
      settings: { print: true },
    }),
  );
  assert.throws(() =>
    designTool('create_project').schema.parse({ workspace: 'stickers', name: 'x', command: 'cut' }),
  );
  assert.throws(() =>
    designTool('edit_design').schema.parse({
      workspace: 'cards',
      designId: 'card',
      operations: [
        { action: 'add', element: { kind: 'image', image: 'https://example.com/private.png' } },
      ],
    }),
  );
});
test('AI layer batches are atomic and preserve normalized filled paths, transforms and ordering', () => {
  const original = newDesign(80, 60);
  const changed = applyDesignOperations(original, [
    {
      action: 'add',
      element: {
        id: 'ridge',
        kind: 'draw',
        closed: true,
        fill: '#456789',
        points: [
          { x: 0, y: 1 },
          { x: 0.5, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    },
    { action: 'duplicate', id: 'ridge', newId: 'back-ridge', dx: 2, dy: 3 },
    { action: 'update', id: 'ridge', patch: { flipX: true, opacity: 0.7, rotation: 12 } },
    { action: 'reorder', ids: ['back-ridge', 'ridge'] },
  ]);
  assert.equal(original.elements.length, 0);
  assert.deepEqual(
    changed.elements.map((e) => e.id),
    ['back-ridge', 'ridge'],
  );
  assert.equal(changed.elements[1].flipX, true);
  assert.match(designSvg(changed), /fill="#456789"/);
  assert.throws(
    () =>
      applyDesignOperations(changed, [
        { action: 'remove', id: 'ridge' },
        { action: 'reorder', ids: [] },
      ]),
    /every layer/,
  );
  assert.equal(changed.elements.length, 2);
  assert.throws(
    () =>
      applyDesignOperations(changed, [
        { action: 'update', id: 'ridge', patch: { id: 'different' } },
      ]),
    /IDs/,
  );
});

test('complex illustrations are bounded by both layer and path-point limits', () => {
  const d = newDesign(80, 60);
  d.elements = Array.from({ length: 500 }, (_, i) => ({
    ...newElement('shape', d),
    id: `tree-${i}`,
  }));
  assert.equal(validateStickerDesign(d).elements.length, 500);
  d.elements.push({ ...newElement('shape', d), id: 'one-too-many' });
  assert.throws(() => validateStickerDesign(d), /500/);
  d.elements = Array.from({ length: 51 }, (_, i) => ({
    ...newElement('draw', d),
    id: `path-${i}`,
    points: Array.from({ length: 2000 }, () => ({ x: 0, y: 0 })),
  }));
  assert.throws(() => validateStickerDesign(d), /100,000/);
});
test('AI project commands are undoable, settings are validated, and invalid actions never write', async () => {
  let current = newStickerProject(),
    past: StickerProject[] = [],
    writes = 0;
  const stop = registerAiWorkspace('stickers', {
    read: () => current,
    write: (p) => {
      past.push(current);
      current = p as StickerProject;
      writes++;
    },
    open: () => {},
    busy: () => false,
    undo: () => {
      current = past.pop()!;
    },
    redo: () => {},
  });
  try {
    await invokeAiDesign('create_project', { workspace: 'stickers', name: 'AI artwork' });
    await invokeAiDesign('update_project_settings', {
      workspace: 'stickers',
      settings: { width: 65, height: 40, gap: 3 },
    });
    assert.equal(current.settings.width, 65);
    assert.equal(current.name, 'AI artwork');
    await invokeAiDesign('workspace_history', { workspace: 'stickers', action: 'undo' });
    assert.equal(current.settings.width, 40);
    const before = writes;
    await assert.rejects(
      invokeAiDesign('update_project_settings', {
        workspace: 'stickers',
        settings: { width: -10 },
      }),
    );
    await assert.rejects(invokeAiDesign('print', { workspace: 'stickers' }));
    assert.equal(writes, before);
    const exported = await invokeAiDesign('export_project', { workspace: 'stickers' });
    assert.equal(exported.project.name, 'AI artwork');
  } finally {
    stop();
  }
});
test('local MCP requires authorization and rejects browser origins, bad hosts and forbidden tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'criprox-ai-'));
  const file = join(directory, 'connection.json'),
    calls: any[] = [];
  const service = createAiServer({
    connectionFile: file,
    invoke: async (_owner: number, name: string, args: unknown) => {
      calls.push({ name, args });
      return { ok: true };
    },
  });
  try {
    await service.start(1);
    const c = JSON.parse(await readFile(file, 'utf8'));
    const configuration = service.configuration('C:/Skarix.exe', 'C:/resources/ai-stdio.cjs');
    assert.equal(configuration.mcpServers.criprox.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(configuration.mcpServers.criprox.args[0], 'C:/resources/ai-stdio.cjs');
    assert(
      !JSON.stringify(configuration).includes(c.token),
      'client configuration contains no bearer token',
    );
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${c.token}`,
      'MCP-Protocol-Version': '2025-11-25',
    };
    const post = (body: unknown, extra = {}) =>
      fetch(c.url, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body: JSON.stringify(body),
      });
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    };
    assert.equal((await post(init, { Authorization: 'wrong' })).status, 403);
    assert.equal((await post(init, { Origin: 'http://evil.example' })).status, 403);
    const { request } = await import('node:http');
    const badHost = await new Promise<number>((resolve, reject) => {
      const req = request(
        c.url,
        { method: 'POST', headers: { ...headers, Host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(init));
    });
    assert.equal(badHost, 403);
    assert.equal(calls.length, 0);
    const initialized = await (await post(init)).json();
    assert.equal(initialized.result.serverInfo.name, 'criprox-design');
    const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.equal(list.result.tools.length, 15);
    const blocked = await (
      await post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'print', arguments: {} },
      })
    ).json();
    assert(blocked.error || blocked.result?.isError);
    assert.equal(calls.length, 0);
    const result = await (
      await post({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_workspace', arguments: { workspace: 'stickers' } },
      })
    ).json();
    assert.equal(result.result.structuredContent.ok, true);
    assert.equal(calls.length, 1);
    await service.stop();
    await assert.rejects(readFile(file));
    assert.equal(service.status().running, false);
  } finally {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('concurrent AI shutdown callers both await connection-file cleanup before restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skarix-ai-stop-'));
  const file = join(directory, 'connection.json');
  const service = createAiServer({ connectionFile: file, invoke: async () => ({ ok: true }) });
  try {
    await service.start(1);
    const closing = service.stop();
    const quitting = service.stop();
    assert.equal(closing, quitting, 'window-close and quit must share the complete cleanup');
    await quitting;
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    assert.equal(service.status().running, false);
    await service.start(2);
    assert.equal(service.owns(2), true);
    const stopAgain = service.stop();
    const restarting = service.start(3);
    await stopAgain;
    await restarting;
    assert.equal(service.owns(3), true);
    assert.ok(JSON.parse(await readFile(file, 'utf8')).url);
  } finally {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('another app instance cannot replace or remove an active design connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'criprox-ai-owner-')),
    file = join(directory, 'connection.json');
  const first = createAiServer({ connectionFile: file, invoke: async () => ({ ok: true }) });
  const second = createAiServer({ connectionFile: file, invoke: async () => ({ ok: true }) });
  try {
    await first.start(1);
    const original = await readFile(file, 'utf8');
    await assert.rejects(second.start(2), /Another Skarix/);
    await second.stop();
    assert.equal(await readFile(file, 'utf8'), original);
    assert.equal(first.status().running, true);
  } finally {
    await second.stop();
    await first.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('desktop MCP access starts off and client configuration is restricted to the owning main frame', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'criprox-ai-ipc-')),
    handlers = new Map<string, Function>();
  let copied = '';
  const frame = {},
    sender = { mainFrame: frame },
    event = { sender, senderFrame: frame };
  const { installAiBridge } = require('../electron/ai-bridge.cjs');
  const bridge = installAiBridge({
    ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn) },
    BrowserWindow: { fromWebContents: () => ({ id: 1 }), fromId: () => undefined },
    clipboard: { writeText: (value: string) => (copied = value) },
    app: {
      getVersion: () => '1.0.0',
      getPath: (name: string) => (name === 'exe' ? 'C:/Skarix.exe' : directory),
      isPackaged: false,
    },
    checkSender: (value: any) => {
      assert.equal(value.sender, sender);
    },
  });
  try {
    assert.equal(handlers.get('ai-design-status')!(event).running, false);
    assert.throws(() => handlers.get('ai-design-copy-config')!(event), /Start AI/);
    await handlers.get('ai-design-start')!(event);
    handlers.get('ai-design-copy-config')!(event);
    assert.equal(JSON.parse(copied).mcpServers.criprox.env.ELECTRON_RUN_AS_NODE, '1');
    assert.throws(
      () => handlers.get('ai-design-stop')!({ ...event, senderFrame: {} }),
      /main workspace/,
    );
    assert(!handlers.has('print') && !handlers.has('cutSheet'));
    await handlers.get('ai-design-stop')!(event);
    assert.equal(handlers.get('ai-design-status')!(event).running, false);
  } finally {
    await bridge.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('stdio relay validates local-only connection targets and never sends tokens to redirects', async () => {
  assert.throws(() =>
    validateConnection({ url: 'https://example.com/mcp', token: 'a'.repeat(64) }),
  );
  assert.throws(() =>
    validateConnection({ url: 'http://127.0.0.1:123/mcp?secret=1', token: 'a'.repeat(64) }),
  );
  const directory = await mkdtemp(join(tmpdir(), 'criprox-relay-')),
    file = join(directory, 'connection.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify({ url: 'http://127.0.0.1:123/mcp', token: 'a'.repeat(64) }));
  const input = new PassThrough(),
    output = new PassThrough();
  let text = '';
  output.on('data', (b) => (text += b));
  const running = relay({
    connectionFile: file,
    input,
    output,
    fetchImpl: async (_url: string, options: any) => {
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    },
  });
  input.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  await running;
  assert.equal(JSON.parse(text).result.ok, true);
  await rm(directory, { recursive: true, force: true });
});

test('AI machine changes discard incompatible registration captures and preserve matching ones', async () => {
  let current = newStickerProject();
  current.machine = 'explore-5';
  current.capture = {
    key: stickerGeometryKey(current.settings, current.machine),
    name: 'marks.pdf',
    pdf: btoa('%PDF-1.7'),
  };
  current = validateStickerProject(current);
  const capture = structuredClone(current.capture);
  const stop = registerAiWorkspace('stickers', {
    read: () => current,
    write: (p) => {
      current = p as StickerProject;
    },
    open: () => {},
    busy: () => false,
    undo: () => {},
    redo: () => {},
  });
  try {
    await invokeAiDesign('update_project_settings', {
      workspace: 'stickers',
      settings: { machine: 'explore-5' },
    });
    assert.deepEqual(current.capture, capture);
    await invokeAiDesign('update_project_settings', {
      workspace: 'stickers',
      settings: { machine: 'maker' },
    });
    assert.equal(current.machine, 'maker');
    assert.equal(current.capture, undefined);
    assert.doesNotThrow(() => validateStickerProject(current));
  } finally {
    stop();
  }
});

test('AI replacement preserves the prior snapshot before committing and rejects editor or project changes during persistence', async () => {
  for (const interruption of ['none', 'busy', 'changed', 'failed'] as const) {
    let current = newStickerProject(),
      busy = false,
      writes = 0,
      opened: boolean | undefined;
    const original = current,
      snapshots: StickerProject[] = [];
    const stop = registerAiWorkspace('stickers', {
      read: () => current,
      busy: () => busy,
      beforeReplace: async () => {
        snapshots.push(structuredClone(current));
        await Promise.resolve();
        assert.equal(writes, 0);
        if (interruption === 'busy') busy = true;
        if (interruption === 'changed') current = { ...current, name: 'Human changes' };
        if (interruption === 'failed') throw Error('Storage full');
      },
      write: (p, fresh) => {
        assert.equal(fresh, true);
        current = p as StickerProject;
        writes++;
      },
      open: (fresh) => {
        opened = fresh;
      },
      undo: () => {},
      redo: () => {},
    });
    try {
      const pending = invokeAiDesign('create_project', {
        workspace: 'stickers',
        name: 'New AI project',
      });
      if (interruption === 'none') {
        await pending;
        assert.equal(writes, 1);
        assert.equal(opened, true);
        assert.equal(current.name, 'New AI project');
      } else {
        await assert.rejects(pending, /editor operation|project changed|Storage full/);
        assert.equal(writes, 0);
        assert.equal(opened, undefined);
      }
      assert.deepEqual(snapshots, [original]);
    } finally {
      stop();
    }
  }
});

test('MCP creates, edits and disables shape gradients through the shared schema and layer operations', () => {
  const args = designTool('create_design').schema.parse({
    workspace: 'stickers',
    name: 'Gradient',
    elements: [
      {
        id: 'gradient-shape',
        kind: 'shape',
        fill: '#222222',
        gradient: { from: '#ff0000', to: '#0000ff' },
      },
    ],
  });
  let design = applyDesignOperations(
    newDesign(),
    args.elements.map((element: unknown) => ({ action: 'add', element })),
  );
  assert.deepEqual(design.elements[0].gradient, { from: '#ff0000', to: '#0000ff' });
  const edit = (gradient: unknown) =>
    designTool('edit_design').schema.parse({
      workspace: 'stickers',
      designId: 'design',
      operations: [{ action: 'update', id: 'gradient-shape', patch: { gradient } }],
    });
  design = applyDesignOperations(design, edit({ from: '#00ff00', to: '#ffffff' }).operations);
  assert.equal(design.elements[0].gradient!.from, '#00ff00');
  assert.ok(designSvg(design).includes('stop-color="#00ff00"'));
  design = applyDesignOperations(design, edit(null).operations);
  assert.equal(design.elements[0].gradient, undefined);
  assert.equal(design.elements[0].fill, '#222222');
  assert.throws(() => edit({ from: '#000000', to: 'red' }));
  assert.throws(() => edit({ from: '#000000' }));
});

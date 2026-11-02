// Headless renderer regression: exercise the actual design engine through MCP HTTP.
// No printer or cutter service is imported or instantiated.
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const { createAiServer } = require('../electron/ai-server.cjs');
const { landscapeLayers, heroLayers } = require('../examples/ai-design-scenes.cjs');
let directory, window, service;
(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-mcp-'));
  app.setPath('userData', path.join(directory, 'profile'));
  await app.whenReady();
  const bundle = buildSync({
    stdin: {
      contents:
        "export * from './src/lib/ai-design'; export {newStickerProject} from './src/lib/stickers'; export {DEFAULT_SETTINGS} from './src/lib/types';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'error',
  }).outputFiles[0].text;
  window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const html = path.join(directory, 'index.html');
  await fs.writeFile(html, '<!doctype html><title>AI design renderer test</title>');
  await window.loadFile(html);
  await window.webContents.executeJavaScript(
    `(()=>{const module={exports:{}};${bundle};window.designTest=module.exports;const m=module.exports;let cards={version:1,name:'Cards',entries:[],settings:structuredClone(m.DEFAULT_SETTINGS)},stickers=m.newStickerProject();m.registerAiWorkspace('cards',{read:()=>cards,write:p=>cards=p,open:()=>{},busy:()=>false,undo:()=>{},redo:()=>{}});m.registerAiWorkspace('stickers',{read:()=>stickers,write:p=>stickers=p,open:()=>{},busy:()=>false,undo:()=>{},redo:()=>{}});})()`,
  );
  const connectionFile = path.join(directory, 'connection.json');
  service = createAiServer({
    connectionFile,
    invoke: (_owner, name, args) =>
      window.webContents.executeJavaScript(
        `window.designTest.invokeAiDesign(${JSON.stringify(name)},${JSON.stringify(args)})`,
      ),
  });
  await service.start(1);
  const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
  let id = 0;
  async function rpc(method, params) {
    const response = await fetch(connection.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${connection.token}`,
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const result = await response.json();
    if (result.error) throw Error(JSON.stringify(result.error));
    return result.result;
  }
  async function call(name, args) {
    const result = await rpc('tools/call', { name, arguments: args });
    if (result.isError) throw Error(JSON.stringify(result.content));
    return result;
  }
  await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'renderer-test', version: '1' },
  });
  await call('create_project', { workspace: 'stickers', name: 'Alpine dawn — MCP example' });
  const landscape = (
    await call('create_design', {
      workspace: 'stickers',
      name: 'Alpine lake',
      canvas: { width: 80, height: 56, background: '#c8e6ef' },
      elements: landscapeLayers(),
      copies: 2,
    })
  ).structuredContent;
  assert(landscape.layers > 100);
  await call('edit_sticker_items', {
    action: 'transform',
    index: 1,
    pose: { rotation: 180, flipX: true },
  });
  const preview = await call('preview_design', {
    workspace: 'stickers',
    designId: landscape.designId,
    maxPixels: 1600,
  });
  const landscapePng = Buffer.from(preview.content[0].data, 'base64');
  assert(landscapePng.length > 10000);
  await fs.writeFile('tmp/mcp-landscape.png', landscapePng);
  await call('create_project', { workspace: 'cards', name: 'Original heroes — MCP example' });
  const hero = (
    await call('create_design', {
      workspace: 'cards',
      name: 'Mira, Keeper of Dawn',
      hero: {
        title: 'Mira, Keeper of Dawn',
        subtitle: 'Original hero · Dawn ranger',
        rules:
          'Dawncall — Restore 2 health.\nTrailblazer — Draw one card.\nOnce per turn, protect an ally.',
        stats: 'Health 24 · Power 4',
        accent: '#e2c785',
        artwork: `data:image/png;base64,${landscapePng.toString('base64')}`,
      },
      elements: heroLayers(),
    })
  ).structuredContent;
  assert(hero.layers > 10);
  const cardPng = await call('preview_design', {
    workspace: 'cards',
    designId: hero.designId,
    maxPixels: 1400,
  });
  await fs.writeFile('tmp/mcp-hero.png', Buffer.from(cardPng.content[0].data, 'base64'));
  const cards = (await call('export_project', { workspace: 'cards' })).structuredContent.project;
  assert.equal(cards.entries[0].card.faces[0].design.cropToCuts, false);
  assert(cards.entries[0].card.faces[0].design.elements.some((e) => e.id === 'hero-face'));
  await fs.writeFile('tmp/mcp-hero.cards.skarix.json', JSON.stringify(cards));
  const stickers = (await call('export_project', { workspace: 'stickers' })).structuredContent
    .project;
  assert.equal(stickers.items.length, 2);
  await fs.writeFile('tmp/mcp-landscape.stickers.skarix.json', JSON.stringify(stickers));
  const cancelled = await window.webContents.executeJavaScript(
    `(async()=>{const m=window.designTest;const before=await m.invokeAiDesign('get_workspace',{workspace:'stickers'});const pending=m.invokeAiDesign('create_design',{workspace:'stickers',name:'cancelled',copies:0});m.cancelAiDesignRequests();let rejected=false;try{await pending;}catch(e){rejected=/stopped/.test(e.message);}const after=await m.invokeAiDesign('get_workspace',{workspace:'stickers'});return {rejected,before:before.artwork.length,after:after.artwork.length};})()`,
  );
  assert.equal(cancelled.rejected, true);
  assert.equal(cancelled.before, cancelled.after);
  console.log(
    `PASS: MCP HTTP created ${landscape.layers}-layer landscape stickers and an editable ${hero.layers}-layer hero card, rendered PNG previews, transformed copies, exported native files, and cancelled a pending edit. No printing or cutter services loaded.`,
  );
})()
  .then(
    () => app.quit(),
    (error) => {
      console.error(error);
      process.exitCode = 1;
      app.quit();
    },
  )
  .finally(async () => {
    await service?.stop();
    if (window && !window.isDestroyed()) window.destroy();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
const require = createRequire(import.meta.url);
const {
  createPrintService,
  printSettings,
  printOptions,
  printHtml,
} = require('../electron/printing.cjs');
const settings = { widthMm: 215.9, heightMm: 279.4, pageCount: 2, duplex: 'simplex' };
const png = createCanvas(2550, 3300).toBuffer('image/png');

test('print geometry uses physical page dimensions, no margins, full scale, and explicit binding', () => {
  const options = printOptions(settings);
  assert.equal(options.silent, false);
  assert.equal(options.scaleFactor, 100);
  assert.deepEqual(options.pageSize, { width: 215900, height: 279400 });
  assert.deepEqual(options.margins, { marginType: 'none' });
  assert.equal(options.printBackground, true);
  for (const duplex of ['simplex', 'longEdge', 'shortEdge'])
    assert.equal(printOptions({ ...settings, duplex }).duplexMode, duplex);
  const html = printHtml(settings);
  assert.match(html, /size: 215.9mm 279.4mm; margin: 0/);
  assert.ok(html.indexOf('page-0.png') < html.indexOf('page-1.png'));
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.match(html, /img:last-child/);
  for (const patch of [
    { widthMm: NaN },
    { heightMm: 0 },
    { widthMm: '215.9' },
    { pageCount: 49 },
    { pageCount: 1.2 },
    { duplex: 'auto' },
  ])
    assert.throws(() => printSettings({ ...settings, ...patch }), /Invalid/);
});
async function fixture(outcome = 'submitted') {
  const directory = await mkdtemp(path.join(tmpdir(), 'skarix-print-test-'));
  const owner = new EventEmitter();
  let options: any,
    loaded = false,
    decoded = false,
    destroyed = false;
  class Window extends EventEmitter {
    static fromWebContents() {
      return {};
    }
    webContents = {
      setWindowOpenHandler: () => {},
      on: () => {},
      executeJavaScript: async () => {
        assert.ok(loaded);
        decoded = true;
      },
      print: (value: any, callback: Function) => {
        assert.ok(decoded, 'Pages must decode before printing');
        options = value;
        callback(
          outcome === 'submitted',
          outcome === 'cancelled' ? 'Print job canceled' : 'Print job failed',
        );
      },
    };
    async loadFile() {
      loaded = true;
    }
    isDestroyed() {
      return destroyed;
    }
    destroy() {
      destroyed = true;
      this.emit('closed');
    }
  }
  const service = createPrintService({
    BrowserWindow: Window,
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => false }) },
    tempRoot: directory,
  });
  return {
    service,
    owner,
    directory,
    options: () => options,
    destroyed: () => destroyed,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
test('printing preserves page order, waits for all pages, and removes temporary files', async () => {
  const f = await fixture();
  try {
    const id = await f.service.begin(f.owner, settings);
    await assert.rejects(f.service.begin(f.owner, settings), /current print/);
    await assert.rejects(f.service.finish(f.owner, id), /not ready/);
    await assert.rejects(f.service.page(f.owner, id, 1, png), /Invalid/);
    await f.service.page(f.owner, id, 0, png);
    await f.service.page(f.owner, id, 1, png);
    assert.deepEqual(await f.service.finish(f.owner, id), { status: 'submitted' });
    assert.equal(f.options().duplexMode, 'simplex');
    assert.ok(f.destroyed());
    assert.deepEqual(await readdir(f.directory), []);
  } finally {
    await f.cleanup();
  }
});
test('cancelled dialogs and printer failures clean up without reporting success', async () => {
  for (const outcome of ['cancelled', 'failed']) {
    const f = await fixture(outcome);
    try {
      const id = await f.service.begin(f.owner, { ...settings, pageCount: 1 });
      await f.service.page(f.owner, id, 0, png);
      if (outcome === 'cancelled')
        assert.deepEqual(await f.service.finish(f.owner, id), { status: 'cancelled' });
      else await assert.rejects(f.service.finish(f.owner, id), /failed/);
      assert.deepEqual(await readdir(f.directory), []);
    } finally {
      await f.cleanup();
    }
  }
});
test('print jobs reject other windows, invalid images, and page dimensions before printing', async () => {
  const f = await fixture();
  try {
    const id = await f.service.begin(f.owner, settings);
    await assert.rejects(f.service.abort(new EventEmitter(), id), /no longer/);
    await assert.rejects(f.service.page(f.owner, id, 0, Buffer.from('<script>')), /PNG/);
    await assert.rejects(
      f.service.page(f.owner, id, 0, createCanvas(10, 10).toBuffer('image/png')),
      /dimensions/,
    );
    await f.service.abort(f.owner, id);
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal(f.options(), undefined);
  } finally {
    await f.cleanup();
  }
});

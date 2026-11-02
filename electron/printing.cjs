const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function printSettings(value) {
  const { widthMm, heightMm, pageCount, duplex } = value || {};
  if (
    ![widthMm, heightMm].every((n) => Number.isFinite(n) && n >= 50 && n <= 500) ||
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > 48 ||
    !['simplex', 'longEdge', 'shortEdge'].includes(duplex)
  )
    throw Error('Invalid print page size, page count, or binding.');
  return { widthMm, heightMm, pageCount, duplex };
}
function printOptions(settings) {
  const s = printSettings(settings);
  return {
    silent: false,
    printBackground: true,
    color: true,
    scaleFactor: 100,
    margins: { marginType: 'none' },
    header: '',
    footer: '',
    pageSize: { width: Math.round(s.widthMm * 1000), height: Math.round(s.heightMm * 1000) },
    duplexMode: s.duplex,
  };
}
function printHtml(settings) {
  const s = printSettings(settings);
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
    <title>Skarix print sheets</title><style>
    @page { size: ${s.widthMm}mm ${s.heightMm}mm; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; }
    img { display: block; width: ${s.widthMm}mm; height: ${s.heightMm}mm;
      break-after: page; page-break-after: always; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    img:last-child { break-after: auto; page-break-after: auto; }
    </style></head><body>${Array.from({ length: s.pageCount }, (_, i) => `<img src="page-${i}.png" alt="">`).join('')}</body></html>`;
}
function createPrintService({ BrowserWindow, nativeImage, showPreview, tempRoot = os.tmpdir() }) {
  const jobs = new Map();
  function owned(owner, id) {
    const job = jobs.get(id);
    if (!job || job.owner !== owner) throw Error('Print preparation is no longer available.');
    return job;
  }
  async function remove(job) {
    if (!jobs.delete(job.id)) return;
    clearTimeout(job.timeout);
    job.owner.removeListener('destroyed', job.ownerClosed);
    if (job.window && !job.window.isDestroyed()) job.window.destroy();
    await job.write?.catch(() => {});
    // Only remove a directory that this service created directly inside its temp root.
    if (
      path.dirname(job.directory) !== path.resolve(tempRoot) ||
      !path.basename(job.directory).startsWith('skarix-print-')
    )
      throw Error('Unexpected print temporary directory.');
    await fs.rm(job.directory, { recursive: true, force: true });
  }
  return {
    async begin(owner, input) {
      if ([...jobs.values()].some((j) => j.owner === owner))
        throw Error('Finish or cancel the current print first.');
      const settings = printSettings(input);
      const directory = await fs.mkdtemp(path.join(path.resolve(tempRoot), 'skarix-print-'));
      const job = {
        id: randomUUID(),
        owner,
        directory,
        settings,
        count: 0,
        bytes: 0,
        printing: false,
      };
      job.ownerClosed = () => {
        void remove(job).catch(() => {});
      };
      job.timeout = setTimeout(job.ownerClosed, 15 * 60 * 1000);
      job.timeout.unref?.();
      jobs.set(job.id, job);
      owner.once('destroyed', job.ownerClosed);
      return job.id;
    },
    async page(owner, id, index, data) {
      const job = owned(owner, id);
      if (
        job.printing ||
        job.write ||
        index !== job.count ||
        index >= job.settings.pageCount ||
        !(data instanceof Uint8Array) ||
        data.byteLength > 40 * 1024 * 1024
      )
        throw Error('Invalid print page.');
      const bytes = Buffer.from(data);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw Error('Print pages must be PNG images.');
      // Validate dimensions before asking the native image decoder to allocate pixels.
      if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR')
        throw Error('Invalid PNG header.');
      const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
      const expectedWidth = Math.ceil((job.settings.widthMm / 25.4) * 300);
      const expectedHeight = Math.ceil((job.settings.heightMm / 25.4) * 300);
      if (
        Math.abs(width - expectedWidth) > 1 ||
        Math.abs(height - expectedHeight) > 1 ||
        width * height > 36_000_000
      )
        throw Error('Print page dimensions do not match the paper.');
      if (nativeImage.createFromBuffer(bytes).isEmpty())
        throw Error('Could not decode the print page.');
      if (job.bytes + bytes.length > 300 * 1024 * 1024)
        throw Error('Print job is too large. Print fewer sheets at a time.');
      job.write = fs.writeFile(path.join(job.directory, `page-${index}.png`), bytes);
      try {
        await job.write;
        job.bytes += bytes.length;
        job.count++;
      } finally {
        job.write = undefined;
      }
    },
    async finish(owner, id) {
      const job = owned(owner, id);
      if (job.printing || job.count !== job.settings.pageCount)
        throw Error('Print pages are not ready.');
      job.printing = true;
      clearTimeout(job.timeout);
      try {
        const file = path.join(job.directory, 'index.html');
        job.write = fs.writeFile(file, printHtml(job.settings));
        await job.write;
        job.write = undefined;
        owned(owner, id);
        const window = new BrowserWindow({
          show: false,
          parent: BrowserWindow.fromWebContents(owner),
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
        job.window = window;
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (e) => e.preventDefault());
        await window.loadFile(file);
        await window.webContents.executeJavaScript(
          `Promise.all(Array.from(document.images, image => image.decode()))`,
        );
        owned(owner, id);
        if (showPreview)
          return await showPreview(owner, job.directory, job.settings, window.webContents);
        return await new Promise((resolve, reject) => {
          const closed = () => reject(Error('Print window was closed.'));
          window.once('closed', closed);
          window.webContents.print(printOptions(job.settings), (success, reason) => {
            window.removeListener('closed', closed);
            if (success) resolve({ status: 'submitted' });
            else if (/cancel/i.test(reason)) resolve({ status: 'cancelled' });
            else reject(Error(reason || 'The printer did not accept this job.'));
          });
        });
      } finally {
        await remove(job);
      }
    },
    async abort(owner, id) {
      const job = jobs.get(id);
      if (!job) return;
      owned(owner, id);
      // Once the system dialog opens, it owns cancellation and printer submission.
      if (!job.printing) await remove(job);
    },
  };
}
module.exports = { createPrintService, printSettings, printOptions, printHtml };

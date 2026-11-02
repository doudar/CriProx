const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { printOptions } = require('./printing.cjs');

function previewOptions(settings, printers, value) {
  if (
    !value ||
    !printers.some((p) => p.name === value.printer) ||
    !Number.isInteger(value.copies) ||
    value.copies < 1 ||
    value.copies > 99 ||
    typeof value.color !== 'boolean' ||
    typeof value.systemDialog !== 'boolean' ||
    !['simplex', 'longEdge', 'shortEdge'].includes(value.duplex) ||
    !Number.isInteger(value.first) ||
    !Number.isInteger(value.last) ||
    value.first < 1 ||
    value.last < value.first ||
    value.last > settings.pageCount
  )
    throw Error('Choose an available printer, 1–99 copies, and a valid page range.');
  return {
    ...printOptions(settings),
    silent: !value.systemDialog,
    deviceName: value.printer,
    copies: value.copies,
    color: value.color,
    duplexMode: value.duplex,
    collate: true,
    pageRanges: [{ from: value.first - 1, to: value.last - 1 }],
  };
}
function createPrintPreview({ BrowserWindow, ipcMain }) {
  const previews = new Map();
  ipcMain.handle('print-preview', async (event, action, value) => {
    const job = previews.get(event.sender);
    if (!job || event.senderFrame !== event.sender.mainFrame)
      throw Error('This print preview is no longer available.');
    if (action === 'state') return job.state;
    if (job.busy) throw Error('The print request is already in progress.');
    if (action === 'cancel') {
      job.finish({ status: 'cancelled' });
      return;
    }
    if (action !== 'submit') throw Error('Unsupported print preview action.');
    const printers = await job.source.getPrintersAsync();
    // Recheck after discovery: concurrent clicks must never submit duplicate jobs.
    if (job.busy || previews.get(event.sender) !== job)
      throw Error('Print preview is busy or closed.');
    const options = previewOptions(job.state.settings, printers, value);
    job.busy = true;
    try {
      const outcome = await new Promise((resolve, reject) => {
        job.source.print(options, (success, reason) => {
          if (success) resolve({ status: 'submitted' });
          else if (/cancel/i.test(reason)) resolve({ status: 'cancelled' });
          else reject(Error(reason || 'The printer did not accept this job.'));
        });
      });
      // Cancelling advanced printer settings returns to the visible preview.
      if (outcome.status === 'submitted') job.finish(outcome);
      return outcome;
    } finally {
      job.busy = false;
    }
  });
  return async function showPreview(owner, directory, settings, source) {
    const printers = await source.getPrintersAsync();
    if (source.isDestroyed()) throw Error('The print job was closed.');
    const window = new BrowserWindow({
      title: 'Skarix — Print preview',
      width: 1100,
      height: 820,
      minWidth: 800,
      minHeight: 600,
      show: false,
      parent: BrowserWindow.fromWebContents(owner),
      modal: true,
      autoHideMenuBar: true,
      backgroundColor: '#f4f3f8',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'print-preview-preload.cjs'),
      },
    });
    let finish;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const job = {
      source,
      finish,
      busy: false,
      state: {
        settings,
        printers: printers.map((p) => ({ name: p.name, label: p.displayName || p.name })),
        pages: Array.from(
          { length: settings.pageCount },
          (_, i) => pathToFileURL(path.join(directory, `page-${i}.png`)).href,
        ),
      },
    };
    const contents = window.webContents;
    previews.set(contents, job);
    window.on('close', (e) => {
      if (job.busy) e.preventDefault();
    });
    window.on('closed', () => finish({ status: 'cancelled' }));
    const sourceClosed = () => {
      finish({ status: 'cancelled' });
    };
    source.once('destroyed', sourceClosed);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    try {
      await window.loadFile(path.join(__dirname, 'print-preview.html'));
      window.show();
      return await result;
    } finally {
      previews.delete(contents);
      source.removeListener('destroyed', sourceClosed);
      if (!window.isDestroyed()) window.destroy();
    }
  };
}
module.exports = { createPrintPreview, previewOptions };

// Exercise the actual main process with disposable storage, never the user's
// profile. No printer/cutter operations or AI design commands are submitted.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skarix-shutdown-'));
app.setPath('appData', profile);
app.setPath('userData', path.join(profile, 'profile'));
let closing = false;
const fail = (error) => {
  console.error(error);
  app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('browser-window-created', (_event, window) => {
  window.hide();
  window.webContents.once('did-finish-load', async () => {
    if (closing) return;
    closing = true;
    if (process.argv.includes('--ai')) {
      const state = await window.webContents.executeJavaScript('window.skarix.ai.start()');
      if (!state.running) throw Error('AI listener did not start');
      const socket = net.createConnection({
        host: '127.0.0.1',
        port: Number(new URL(state.url).port),
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      socket.on('error', () => {});
    }
    // Windows/Linux quit on last-window closure; macOS keeps the app active
    // until Quit, so explicitly exercise that OS's quit path when run there.
    window.close();
    if (process.platform === 'darwin') app.quit();
  });
});
app.on('will-quit', (event) => {
  const file = path.join(app.getPath('userData'), 'ai-design-connection.json');
  if (fs.existsSync(file)) {
    event.preventDefault();
    fail(Error('Quit left a stale AI connection file'));
    return;
  }
  console.log('PASS: actual application exits and AI connection state is removed');
});
setTimeout(() => {
  console.error('Shutdown timed out; remaining windows:', BrowserWindow.getAllWindows().length);
  app.exit(1);
}, 15000).unref();
require('../electron/main.cjs');

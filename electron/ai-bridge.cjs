const crypto = require('node:crypto');
const { createAiServer } = require('./ai-server.cjs');
const { designTool } = require('./ai-tools.cjs');
function installAiBridge({ ipcMain, BrowserWindow, clipboard, app, checkSender }) {
  const pending = new Map();
  let queue = Promise.resolve();
  const service = createAiServer({
    version: app.getVersion(),
    connectionFile: require('node:path').join(app.getPath('userData'), 'ai-design-connection.json'),
    invoke: (owner, name, args) => {
      designTool(name).schema.parse(args);
      const task = queue
        .catch(() => {})
        .then(
          () =>
            new Promise((resolve, reject) => {
              if (!service.owns(owner)) return reject(Error('AI design access has stopped.'));
              const window = BrowserWindow.fromId(owner);
              if (!window || window.isDestroyed())
                return reject(Error('The design window is closed.'));
              if (pending.size >= 8) return reject(Error('Too many design requests.'));
              const id = crypto.randomUUID(),
                timer = setTimeout(() => {
                  pending.delete(id);
                  if (!window.webContents.isDestroyed())
                    window.webContents.send('ai-design-cancel');
                  reject(Error('Design request timed out.'));
                }, 35000);
              pending.set(id, { owner, sender: window.webContents, resolve, reject, timer });
              window.webContents.send('ai-design-request', { id, name, args });
            }),
        );
      queue = task;
      return task;
    },
  });
  async function stop() {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      if (!p.sender.isDestroyed?.()) p.sender.send('ai-design-cancel');
      p.reject(Error('AI design access has stopped.'));
    }
    pending.clear();
    return service.stop();
  }
  function windowId(event) {
    checkSender(event);
    if (event.senderFrame !== event.sender.mainFrame)
      throw Error('AI design settings require the main workspace.');
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) throw Error('Design window unavailable.');
    return w.id;
  }
  ipcMain.handle('ai-design-status', (event) => {
    windowId(event);
    return service.status();
  });
  ipcMain.handle('ai-design-start', (event) => service.start(windowId(event)));
  ipcMain.handle('ai-design-stop', (event) => {
    const id = windowId(event);
    if (service.status().running && !service.owns(id))
      throw Error('AI server belongs to another window.');
    return stop();
  });
  ipcMain.handle('ai-design-copy-config', (event) => {
    const id = windowId(event);
    if (!service.owns(id)) throw Error('Start AI design access in this window first.');
    const relayPath = app.isPackaged
      ? require('node:path').join(process.resourcesPath, 'ai-stdio.cjs')
      : require('node:path').join(__dirname, 'ai-stdio.cjs');
    const config = service.configuration(app.getPath('exe'), relayPath);
    clipboard.writeText(JSON.stringify(config, null, 2));
    return true;
  });
  ipcMain.handle('ai-design-response', (event, response) => {
    windowId(event);
    const p = pending.get(response?.id);
    if (!p || p.sender !== event.sender) return;
    clearTimeout(p.timer);
    pending.delete(response.id);
    if (typeof response.error === 'string') p.reject(Error(response.error.slice(0, 2000)));
    else if (JSON.stringify(response.value).length > 100_000_000)
      p.reject(Error('Design result exceeds 100 MB.'));
    else p.resolve(response.value);
  });
  return {
    stop,
    windowClosed: (id) => {
      if (service.owns(id)) void stop();
    },
  };
}
module.exports = { installAiBridge };

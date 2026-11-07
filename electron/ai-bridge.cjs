const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createAiServer } = require('./ai-server.cjs');
const { designTool } = require('./ai-tools.cjs');
function installAiBridge({ ipcMain, BrowserWindow, clipboard, app, checkSender }) {
  const pending = new Map();
  let queue = Promise.resolve();
  let lifecycle = Promise.resolve(),
    startupError = '',
    accessEnabled = false;
  const readyWindows = new Set();
  const settingsFile = path.join(app.getPath('userData'), 'ai-design-settings.json');
  function schedule(action) {
    const result = lifecycle.then(action);
    lifecycle = result.catch(() => {});
    return result;
  }
  async function remember(enabled) {
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });
    const temporary = `${settingsFile}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ enabled }), { mode: 0o600 });
      await fs.rename(temporary, settingsFile);
      accessEnabled = enabled;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const service = createAiServer({
    version: app.getVersion(),
    connectionFile: path.join(app.getPath('userData'), 'ai-design-connection.json'),
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
  const status = () => ({ ...service.status(), enabled: accessEnabled, error: startupError });
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
  // The renderer registers its request listener before announcing readiness.
  ipcMain.handle('ai-design-ready', (event) => {
    const id = windowId(event);
    return schedule(async () => {
      if (readyWindows.has(id)) return;
      readyWindows.add(id);
      try {
        accessEnabled = false;
        let settings;
        try {
          settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
        } catch (error) {
          if (error.code === 'ENOENT' || error instanceof SyntaxError) return;
          throw error;
        }
        accessEnabled = settings?.enabled === true;
        if (accessEnabled) await service.start(id);
      } catch (error) {
        startupError = `Could not restore AI design access: ${error.message}`;
      }
    });
  });
  ipcMain.handle('ai-design-status', (event) => {
    windowId(event);
    return lifecycle.then(status);
  });
  ipcMain.handle('ai-design-start', (event) => {
    const id = windowId(event);
    return schedule(async () => {
      const wasRunning = service.status().running;
      await service.start(id);
      try {
        await remember(true);
      } catch (error) {
        if (!wasRunning) await stop();
        throw error;
      }
      startupError = '';
      return status();
    });
  });
  ipcMain.handle('ai-design-stop', (event) => {
    const id = windowId(event);
    if (service.status().running && !service.owns(id))
      throw Error('AI server belongs to another window.');
    return schedule(async () => {
      if (service.status().running && !service.owns(id))
        throw Error('AI server belongs to another window.');
      // Closing the window/quit uses stop() without changing this preference.
      try {
        await remember(false);
        startupError = '';
      } finally {
        await stop();
      }
      return status();
    });
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
    stop: () => schedule(stop),
    windowClosed: (id) => {
      return schedule(async () => {
        readyWindows.delete(id);
        if (service.owns(id)) await stop();
      });
    },
  };
}
module.exports = { installAiBridge };

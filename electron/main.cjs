const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { deckSourceUrl } = require('./deck-source.cjs');
const { contextMenuTemplate } = require('./context-menu.cjs');
const { isTrustedReleaseUrl } = require('./release-check.cjs');
const { createUpdateManager } = require('./update-manager.cjs');
const { isReleaseNotesUrl } = require('./release-notes.cjs');
const { createInstallerHandoff, createMacUpdateHelp } = require('./update-install.cjs');
// A developer-only fixture; packaged builds ignore the flag and exclude its module.
const updateDemo =
  !app.isPackaged && process.argv.includes('--simulate-updates')
    ? require('./update-demo.cjs').startUpdateDemo(app, dialog)
    : null;
const {
  abortProjectSave,
  assertProjectId,
  beginProjectSave,
  createFolder,
  deleteFolder,
  deleteProject,
  finishProjectSave,
  importProjects,
  listLibrary,
  moveProject,
  openProjectManifest,
  readProjectAsset,
  saveProjectAsset,
} = require('./project-library.cjs');
const { projectLibraryPaths } = require('./project-library-paths.cjs');
const { findUpscayl, runUpscayl } = require('./upscayl.cjs');
const { findCricutInstallation } = require('./cricut-installation.cjs');
const { createCutterController } = require('./cutter/controller.cjs');
const printing = require('./printing.cjs').createPrintService({ BrowserWindow, nativeImage,
  showPreview: require('./print-preview.cjs').createPrintPreview({BrowserWindow,ipcMain}) });
for (const command of ['begin', 'page', 'finish', 'abort']) {
  ipcMain.handle(`print-${command}`, (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Printing requires the main workspace.');
    checkCutterSender(event);
    return printing[command](event.sender, ...args);
  });
}
const cutter = createCutterController({
  keyStore: require('./cutter/protected-key.cjs').createProtectedKeyStore({
    safeStorage, directory: () => app.getPath('userData'),
  }),
  onState: (state) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('cutter-state', state);
  },
});
function checkCutterSender(event) {
  const url = event.senderFrame?.url;
  if (
    !url ||
    require('node:url').fileURLToPath(new URL(url)) !==
      path.resolve(__dirname, '../dist/index.html')
  )
    throw new Error('Cutter access is limited to the CriProx workspace.');
}
ipcMain.handle('materials-import', (event) => {
  checkCutterSender(event);
  return require('./material-import.cjs').importDesignSpaceMaterials();
});
ipcMain.handle('cutter-state', (event) => {
  checkCutterSender(event);
  return cutter.snapshot();
});
ipcMain.handle('cutter-key-status', (event) => {
  checkCutterSender(event);
  return cutter.keyStatus();
});
ipcMain.handle('cutter-connect-saved', (event, request) => {
  checkCutterSender(event);
  return cutter.command('connect', { transport: request?.transport, authorized: true, savedOnly: true });
});
ipcMain.handle('cutter-connect', (event, request) => {
  checkCutterSender(event);
  return cutter.command('connect', {
    transport: request?.transport,
    authorized: request?.authorized === true,
  });
});
ipcMain.handle('cutter-disconnect', (event) => {
  checkCutterSender(event);
  return cutter.command('disconnect');
});
ipcMain.handle('cutter-forget-key', (event) => {
  checkCutterSender(event);
  return cutter.command('forgetKey');
});
ipcMain.handle('cutter-home', (event, request) => {
  checkCutterSender(event);
  return cutter.command('home', { bladeRemoved: request?.bladeRemoved === true });
});
ipcMain.handle('cutter-cut-sheet', (event, request) => {
  checkCutterSender(event);
  return cutter.command('cutSheet', {
    job: request?.job, sheetIndex: request?.sheetIndex,
    materialReady: request?.materialReady === true,
  });
});
for (const [channel,command] of [['cutter-cancel','cancelCut'],['cutter-pause','pauseCut'],['cutter-resume','resumeCut']])
  ipcMain.handle(channel, event => { checkCutterSender(event); return cutter.command(command); });
let cutterQuitReady = false;
let aiDesignBridge;
app.on('before-quit', (event) => {
  if (cutterQuitReady) return;
  event.preventDefault();
  void Promise.allSettled([cutter.close(), aiDesignBridge?.stop()]).finally(() => {
    cutterQuitReady = true;
    app.quit();
  });
});
const {
  loadRegistrationTemplate,
  saveRegistrationTemplate,
} = require('./registration-template-library.cjs');

const libraryPaths = () =>
  projectLibraryPaths({
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
  });
const librarySettingsFile = () => libraryPaths().settingsFile;
const defaultLibraryRoot = () => libraryPaths().defaultRoot;
const legacyLibraryRoot = () => libraryPaths().legacyRoot;
let configuredLibraryRoot;

async function getLibraryRoot() {
  if (configuredLibraryRoot) return configuredLibraryRoot;
  try {
    const settings = JSON.parse(await fs.readFile(librarySettingsFile(), 'utf8'));
    if (typeof settings.root === 'string' && path.isAbsolute(settings.root)) {
      configuredLibraryRoot = settings.root;
      return configuredLibraryRoot;
    }
  } catch {
    // The private application library is used until the user chooses another folder.
  }
  configuredLibraryRoot = defaultLibraryRoot();
  return configuredLibraryRoot;
}

async function setLibraryRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new Error('Project library folder must be an absolute path.');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.dirname(librarySettingsFile()), { recursive: true });
  await fs.writeFile(librarySettingsFile(), JSON.stringify({ root }, null, 2), 'utf8');
  configuredLibraryRoot = root;
}

async function projectLibrarySnapshot() {
  const root = await getLibraryRoot();
  let canImportDocumentsLibrary = false;
  if (process.platform === 'darwin' && root !== legacyLibraryRoot()) {
    try {
      await fs.access(libraryPaths().legacyImportMarker);
    } catch {
      canImportDocumentsLibrary = true;
    }
  }
  return {
    root,
    isDefault: root === defaultLibraryRoot(),
    canImportDocumentsLibrary,
    ...(await listLibrary(root)),
  };
}

const mpcPaths = new Set(['/2/sources/', '/2/exploreSearch/']);
ipcMain.handle('mpc-request', async (_event, request) => {
  const { path: requestPath, method, body } = request || {};
  if (!mpcPaths.has(requestPath) || !['GET', 'POST'].includes(method))
    throw new Error('Unsupported MPC Autofill request.');
  const response = await fetch(new URL(requestPath, 'https://mpcfill.com/'), {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `MPC Autofill returned ${response.status}.`);
  return result;
});

ipcMain.handle('deck-request', async (_event, request) => {
  const requestUrl = deckSourceUrl(request);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await net.fetch(requestUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `CriProx/${app.getVersion()} (+https://github.com/Go2Engle/CriProx)`,
      },
      credentials: 'omit',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`${request.provider} returned ${response.status}.`);
  const body = await response.text();
  if (body.length > 10_000_000) throw new Error('Deck response exceeds 10 MB.');
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Deck source returned invalid JSON.');
  }
});

function senderWindow(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error('Window is no longer available.');
  return window;
}

ipcMain.handle('window-control', (event, action) => {
  const window = senderWindow(event);
  if (action === 'minimize') window.minimize();
  else if (action === 'maximize') {
    if (window.isMinimized()) window.restore();
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  } else if (action === 'close') window.close();
  else throw new Error('Unsupported window action.');
  return window.isMaximized();
});

ipcMain.handle('window-is-maximized', (event) => senderWindow(event).isMaximized());

let updates;
function updateManager() {
  updates ??= createUpdateManager({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    directory: path.join(app.getPath('userData'), 'update-downloads'),
    openInstaller: createInstallerHandoff({
      platform: process.platform,
      downloads: app.getPath('downloads'),
      openPath: (file) => shell.openPath(file),
      chooseDestination: (options) => dialog.showSaveDialog(options),
    }),
    // Give IPC its response before closing the renderer. Its workspace save has completed.
    onInstallerOpened: () => setImmediate(() => app.quit()),
    ...updateDemo?.managerOptions,
    notify: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('update-state', state);
      }
    },
  });
  return updates;
}
ipcMain.handle('release-check', () => updateManager().check());
ipcMain.handle('update-state', () => updateManager().snapshot());
ipcMain.handle('update-check', () => updateManager().check(true));
ipcMain.handle('update-download', () => updateManager().download());
ipcMain.handle('update-cancel', () => updateManager().cancel());
ipcMain.handle('update-open', () => updateManager().open());

const macUpdateHelp = createMacUpdateHelp({
  platform: process.platform,
  clipboard,
  openPath: (file) => shell.openPath(file),
});
ipcMain.handle('update-copy-mac-command', () => macUpdateHelp.copyCommand());
ipcMain.handle('update-open-terminal', () => macUpdateHelp.openTerminal());

ipcMain.handle('open-release-notes-link', (_event, url) => {
  if (!isReleaseNotesUrl(url)) throw new Error('Unsupported release notes link.');
  return shell.openExternal(url);
});

ipcMain.handle('open-release-page', (_event, releaseUrl) => {
  if (!isTrustedReleaseUrl(releaseUrl)) throw new Error('Unsupported release URL.');
  if (updateDemo) return updateDemo.showRelease();
  return shell.openExternal(releaseUrl);
});

const upscaylJobs = new Map();
ipcMain.handle('upscayl-detect', async () => {
  const installation = await findUpscayl();
  return installation ? { cacheKey: installation.cacheKey } : null;
});
ipcMain.handle('upscayl-run', async (event, request) => {
  if (typeof request?.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(request.id))
    throw new Error('Invalid Upscayl job ID.');
  const input = request.input;
  if (!(input instanceof Uint8Array)) throw new Error('Invalid Upscayl image.');
  const controller = new AbortController();
  const key = `${event.sender.id}:${request.id}`;
  if (upscaylJobs.has(key)) throw new Error('Upscayl job is already running.');
  upscaylJobs.set(key, controller);
  try {
    const installation = await findUpscayl();
    return await runUpscayl(input, installation, { signal: controller.signal });
  } finally {
    upscaylJobs.delete(key);
  }
});
ipcMain.handle('upscayl-cancel', (event, id) => {
  if (typeof id === 'string') upscaylJobs.get(`${event.sender.id}:${id}`)?.abort();
});

ipcMain.handle('cricut-installation', async () => {
  const found = await findCricutInstallation();
  return {
    installed: !!found,
    version: found?.version || null,
    bridgeInstalled: !!found?.bridgeInstalled,
  };
});
ipcMain.handle('cricut-open', async () => {
  const found = await findCricutInstallation();
  if (!found)
    throw new Error(
      'Design Space was not found. Open it manually; automatic launch currently supports Windows installations only.',
    );
  const error = await shell.openPath(found.executable);
  if (error) throw new Error(error);
});

ipcMain.handle('save-project', async (event, request) => {
  const data = request?.data;
  if (typeof data !== 'string' || Buffer.byteLength(data) > 100_000_000)
    throw new Error('Project data is invalid or exceeds 100 MB.');
  const requestedName = typeof request?.defaultName === 'string' ? request.defaultName : 'project';
  const safeName = path.basename(requestedName).replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'project';
  const defaultPath = safeName.endsWith('.criprox.json') ? safeName : `${safeName}.criprox.json`;
  const result = await dialog.showSaveDialog(senderWindow(event), {
    title: 'Save CriProx project',
    defaultPath,
    filters: [{ name: 'CriProx project', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  const target = result.filePath.toLowerCase().endsWith('.criprox.json')
    ? result.filePath
    : `${result.filePath.replace(/\.json$/i, '')}.criprox.json`;
  await fs.writeFile(target, data, 'utf8');
  return true;
});

ipcMain.handle('list-projects', () => projectLibrarySnapshot());

ipcMain.handle('choose-projects-directory', async (event) => {
  const result = await dialog.showOpenDialog(senderWindow(event), {
    title: 'Choose CriProx projects folder',
    defaultPath: await getLibraryRoot(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  await setLibraryRoot(result.filePaths[0]);
  return projectLibrarySnapshot();
});

ipcMain.handle('import-documents-projects', async () => {
  const sourceRoot = legacyLibraryRoot();
  const destinationRoot = await getLibraryRoot();
  if (sourceRoot === destinationRoot)
    throw new Error('The Documents project library is already selected.');
  const imported = await importProjects(sourceRoot, destinationRoot);
  await fs.mkdir(path.dirname(libraryPaths().legacyImportMarker), { recursive: true });
  await fs.writeFile(
    libraryPaths().legacyImportMarker,
    JSON.stringify({ importedAt: new Date().toISOString(), projects: imported.length }, null, 2),
    'utf8',
  );
  return { imported: imported.length, snapshot: await projectLibrarySnapshot() };
});

const managedProjectSaves = new Map();
const saveCleanupRegistered = new WeakSet();

function managedProjectSave(event, saveId) {
  const active = managedProjectSaves.get(saveId);
  if (!active || active.sender !== event.sender)
    throw new Error('Project save is no longer active.');
  return active;
}

ipcMain.handle('begin-managed-project-save', async (event, request) => {
  const root = await getLibraryRoot();
  const session = await beginProjectSave(root, request);
  const saveId = crypto.randomUUID();
  managedProjectSaves.set(saveId, { sender: event.sender, session });
  if (!saveCleanupRegistered.has(event.sender)) {
    saveCleanupRegistered.add(event.sender);
    event.sender.once('destroyed', () => {
      for (const [activeId, active] of managedProjectSaves) {
        if (active.sender !== event.sender) continue;
        managedProjectSaves.delete(activeId);
        void abortProjectSave(active.session).catch(() => {});
      }
    });
  }
  return { saveId, projectId: session.projectId };
});

ipcMain.handle('write-managed-project-asset', (event, request) => {
  const active = managedProjectSave(event, request?.saveId);
  return saveProjectAsset(active.session, request?.dataUrl);
});

ipcMain.handle('finish-managed-project-save', async (event, request) => {
  const active = managedProjectSave(event, request?.saveId);
  const project = await finishProjectSave(active.session, request?.data);
  managedProjectSaves.delete(request.saveId);
  return { project, snapshot: await projectLibrarySnapshot() };
});

ipcMain.handle('abort-managed-project-save', async (event, saveId) => {
  const active = managedProjectSave(event, saveId);
  managedProjectSaves.delete(saveId);
  await abortProjectSave(active.session);
});

ipcMain.handle('open-managed-project', async (_event, projectId) => {
  const project = await openProjectManifest(await getLibraryRoot(), assertProjectId(projectId));
  return JSON.stringify(project);
});

ipcMain.handle('read-managed-project-asset', async (_event, request) =>
  readProjectAsset(
    await getLibraryRoot(),
    assertProjectId(request?.projectId),
    request?.relativePath,
  ),
);

ipcMain.handle('delete-managed-project', async (_event, projectId) => {
  const root = await getLibraryRoot();
  await deleteProject(root, assertProjectId(projectId), (directory) => shell.trashItem(directory));
  return projectLibrarySnapshot();
});

ipcMain.handle('create-project-folder', async (_event, request) => {
  const root = await getLibraryRoot();
  const folder = await createFolder(root, request?.parent, request?.name);
  return { folder, snapshot: await projectLibrarySnapshot() };
});

ipcMain.handle('delete-project-folder', async (_event, folder) => {
  const root = await getLibraryRoot();
  if (typeof folder !== 'string') throw new Error('Invalid library folder.');
  for (const { session } of managedProjectSaves.values()) {
    if (!session.complete && session.directory === path.join(root, folder))
      throw new Error('Wait for this project to finish saving before deleting its folder.');
  }
  await deleteFolder(root, folder);
  return projectLibrarySnapshot();
});

ipcMain.handle('move-managed-project', async (_event, request) => {
  const root = await getLibraryRoot();
  for (const { session } of managedProjectSaves.values()) {
    if (
      !session.complete &&
      session.directory === path.join(root, assertProjectId(request?.projectId))
    )
      throw new Error('Wait for this project to finish saving before moving it.');
  }
  const project = await moveProject(root, request?.projectId, request?.folder);
  return { project, snapshot: await projectLibrarySnapshot() };
});

ipcMain.handle('reveal-project-library', async () => {
  const root = await getLibraryRoot();
  await fs.mkdir(root, { recursive: true });
  const error = await shell.openPath(root);
  if (error) throw new Error(error);
});

ipcMain.handle('load-registration-template', async (_event, request) =>
  loadRegistrationTemplate(await getLibraryRoot(), request),
);

ipcMain.handle('save-registration-template', async (_event, request) =>
  saveRegistrationTemplate(await getLibraryRoot(), request),
);

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 900,
    minHeight: 660,
    frame: false,
    backgroundColor: '#f6f7f9',
    title: 'CriProx',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  const publishWindowState = () =>
    window.webContents.send('window-maximized-change', window.isMaximized());
  window.on('closed', () => aiDesignBridge?.windowClosed(window.id));
  window.on('maximize', publishWindowState);
  window.on('unmaximize', publishWindowState);
  window.on('enter-full-screen', publishWindowState);
  window.on('leave-full-screen', publishWindowState);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(help\.cricut\.com|scryfall\.com|mpcfill\.com)\//.test(url))
      shell.openExternal(url);
    else if (/^https:\/\/ko-fi\.com\/go2engle(?:\/|$)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params);
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.whenReady().then(() => {
  aiDesignBridge = require('./ai-bridge.cjs').installAiBridge({
    ipcMain, BrowserWindow, clipboard, app, checkSender: checkCutterSender,
  });
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');

let dir,
  win,
  exitCode = 0;
app.on('window-all-closed', () => {});
(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-workflow-'));
  app.setPath('userData', path.join(dir, 'profile'));
  await app.whenReady();
  const bundle = buildSync({
    entryPoints: ['tests/design-workflow.browser.tsx'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'fixTests',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'error',
    loader: { '.css': 'empty' },
    define: {
      'import.meta.env.DEV': 'false',
      __APP_VERSION__: JSON.stringify('test'),
      __APP_CHANGELOG__: '[]',
    },
  }).outputFiles[0].text;
  await fs.writeFile(path.join(dir, 'test.html'), '<!doctype html><div id="root"></div>');
  win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(dir, 'test.html'));
  const result = await win.webContents.executeJavaScript(
    '(async()=>{try{' +
      bundle +
      '\nreturn await fixTests.run();}catch(error){return {error:error.stack};}})()',
  );
  if (result?.error) throw Error(result.error);
  if (
    !Array.isArray(result) ||
    result.length < 4 ||
    result.some((line) => !line.startsWith('PASS '))
  )
    throw Error(JSON.stringify(result));
  console.log(result.join('\n'));
})()
  .catch((e) => {
    console.error(e);
    exitCode = 1;
  })
  .finally(async () => {
    if (win && !win.isDestroyed()) win.destroy();
    // Chromium keeps its temporary profile locked until process exit on Windows.
    if (dir) await fs.rm(path.join(dir, 'test.html'), { force: true });
    app.exit(exitCode);
  });

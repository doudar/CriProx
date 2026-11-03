// Capture the real production editor with the bundled editable starter project.
// Run after npm run build: npx electron scripts/capture-editor.cjs [output.png]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
let win;
let code = 0;
app.on('window-all-closed', () => {});
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-docs-'));
  app.setPath('userData', profile);
  await app.whenReady();
  win = new BrowserWindow({
    width: 1600,
    height: 1100,
    useContentSize: true,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.resolve('dist/index.html'));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(r => setTimeout(r, 100));
    const find = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label && !b.disabled && b.getClientRects().length);
    const until = async (fn, label) => { for (let i=0;i<200;i++) { const value=fn(); if(value) return value; await pause(); } throw Error('Timed out: '+label+'; '+document.body.innerText.slice(-6000)); };
    (await until(() => [...document.querySelectorAll('button')].find(b => b.querySelector('strong')?.textContent === 'Meet Skarix' && !b.disabled), 'starter')).click();
    await until(() => [...document.querySelectorAll('nav button')].some(b => b.textContent.trim() === 'Design studio' && b.getAttribute('aria-current') === 'page'), 'visible design studio');
    // Let the new-project request finish before selecting its artwork.
    await new Promise(r => setTimeout(r, 1000));
    (await until(() => document.querySelector('.sticker-artwork-row'), 'artwork')).click();
    await pause();
    (await until(() => find('Edit design'), 'edit design')).click();
    await until(() => document.querySelector('.designer-layer-row button'), 'layers');
    [...document.querySelectorAll('.designer-layer-row > button:first-child')].find(b => !b.textContent.includes('Cut ·')).click();
    await pause();
    for (const summary of document.querySelectorAll('summary')) {
      if (summary.textContent.trim() === 'Materials' || summary.textContent.includes('Reference overlay')) summary.parentElement.open = true;
    }
    await until(() => document.querySelector('.sticker-designer')?.getBoundingClientRect().width > 0 && !document.querySelector('.skarix-home'), 'visible editor');
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 600));
    return { editor: !!document.querySelector('.sticker-designer'), materials: !!find('Apply material'), layers: document.querySelectorAll('.designer-layer-row').length };
  })()`);
  if (!result.editor || !result.materials || !result.layers)
    throw Error('Editor capture did not reach expected interface: ' + JSON.stringify(result));
  const output = path.resolve(process.argv[2] || 'docs/assets/skarix-editor.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, (await win.webContents.capturePage()).toPNG());
  console.log('Captured production Skarix editor:', output, result);
})()
  .catch((error) => {
    console.error(error);
    code = 1;
  })
  .finally(() => {
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(code);
  });

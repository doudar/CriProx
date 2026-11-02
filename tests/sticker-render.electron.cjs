// Run with: node_modules/.bin/electron tests/sticker-render.electron.cjs
// Checks the actual browser rasterizer in an isolated, hidden renderer. Never prints.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
let directory, window;
(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-sticker-render-'));
  app.setPath('userData', path.join(directory, 'profile'));
  await app.whenReady();
  const code = buildSync({
    entryPoints: [path.join(__dirname, '../src/lib/sticker-design.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
  }).outputFiles[0].text;
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const html = path.join(directory, 'index.html');
  await fs.writeFile(html, '<!doctype html><title>Sticker rasterizer test</title>');
  await window.loadFile(html);
  const result = await window.webContents.executeJavaScript(`(async()=>{
    const module={exports:{}}; ${code}
 const model=module.exports;
    const d=model.newDesign(40,40);
    const source=document.createElement('canvas');source.width=source.height=20;
    source.getContext('2d').fillStyle='#00ff00';source.getContext('2d').fillRect(0,0,20,20);
    d.elements=[
      {...model.newElement('shape',d),x:5,y:5,width:10,height:10,fill:'#ff0000'},
      {...model.newElement('draw',d),x:5,y:25,width:20,height:.1,stroke:'#0000ff',strokeWidth:2,points:[{x:0,y:0},{x:1,y:0}]},
      {...model.newElement('image',d),x:30,y:30,width:10,height:10,image:source.toDataURL('image/png')},
      {...model.newElement('text',d),x:0,y:0,text:'Hello',fontSize:4,fill:'#000000'}
    ];
    const png=await model.renderStickerDesign(d);
    const img=new Image();img.src=png;await img.decode();
    const c=document.createElement('canvas');c.width=c.height=400;c.getContext('2d').drawImage(img,0,0,400,400);
    const pixel=(x,y)=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data);
    const text=c.getContext('2d').getImageData(0,0,240,40).data;
    return {red:pixel(100,100),blue:pixel(150,250),green:pixel(350,350),white:pixel(350,100),textInk:text.some((v,i)=>i%4===0&&v<100),width:img.width,height:img.height};
  })()`);
  assert.deepEqual(result.red, [255, 0, 0, 255]);
  assert.deepEqual(result.blue, [0, 0, 255, 255]);
  assert.deepEqual(result.green, [0, 255, 0, 255]);
  assert.deepEqual(result.white, [255, 255, 255, 255]);
  assert.equal(result.textInk, true);
  assert.equal(result.width, 945);
  assert.equal(result.height, 945);
  console.log('PASS: Electron renders text, shapes, drawn lines and embedded images at 600 DPI.');
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (window && !window.isDestroyed()) window.destroy();
    if (directory)
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    app.exit(process.exitCode || 0);
  });

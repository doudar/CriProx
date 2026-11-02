const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
let directory, window;
(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skarix-fit-cut-'));
  app.setPath('userData', path.join(directory, 'profile'));
  await app.whenReady();
  const code = buildSync({
    stdin: {
      contents:
        "export * from './src/lib/sticker-fit-cut'; export * from './src/lib/sticker-design'; export * from './src/lib/sticker-contours';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
  }).outputFiles[0].text;
  window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const html = path.join(directory, 'index.html');
  await fs.writeFile(html, '<!doctype html><title>Fit Cut pixel test</title>');
  await window.loadFile(html);
  const result = await window.webContents
    .executeJavaScript(`(async()=>{const module={exports:{}};${code};const m=module.exports;
 const d=m.newDesign(40,30);d.elements=[{...m.newElement('shape',d),shape:'ellipse',x:5,y:10,width:30,height:12,fill:'#7560cf'},{...m.newElement('text',d),text:'Long text outside frame',x:0,y:0,width:40,height:10,fontSize:8,fill:'#000000',bold:true},{...m.newElement('shape',d),operation:'cut',x:8,y:12,width:20,height:8}];
 const fitted=await m.fitDesignCut(d,{borderWidth:1,strokeWidth:.3,strokeColor:'#ff0000'}),b=m.designOutputBounds(fitted);
 async function pixels(value,raw){const img=new Image();const url=URL.createObjectURL(new Blob([m.designSvg(value,{bounds:b,artworkOnly:raw})],{type:'image/svg+xml'}));try{img.src=url;await img.decode();const c=document.createElement('canvas');c.width=Math.ceil(b.width*12);c.height=Math.ceil(b.height*12);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}finally{URL.revokeObjectURL(url);}}
 const original={...fitted,elements:fitted.elements.filter(e=>e.operation!=='cut'&&e.id!==fitted.fitCut.strokeId)},before=await pixels(original,true),after=await pixels(fitted,false);let checked=0,lost=0,red=0;for(let i=0;i<before.length;i+=4){if(before[i+3]>250){checked++;if(Math.abs(before[i]-after[i])>8||Math.abs(before[i+1]-after[i+1])>8||Math.abs(before[i+2]-after[i+2])>8)lost++;}if(after[i]>200&&after[i+1]<50&&after[i+2]<50)red++;}
 return {width:fitted.width,checked,lost,red,cutCount:m.designCutPaths(fitted).length};})()`);
  assert.ok(result.width > 40, 'text beyond the original canvas expands the fitted design');
  assert.ok(result.checked > 1000);
  assert.equal(result.lost, 0, 'all original opaque artwork pixels survive the fitted cut');
  assert.ok(result.red > 100);
  assert.equal(result.cutCount, 1);
  console.log(
    'PASS: Fit Cut preserves all artwork pixels, including overflowing text, and prints its border.',
    JSON.stringify(result),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (window && !window.isDestroyed()) window.destroy();
    if (directory)
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    app.exit(process.exitCode || 0);
  });

/** Regenerate all brand assets from the editable Skarix logo. */
import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { designSvg, validateStickerDesign } from '../src/lib/sticker-design';

const logo = validateStickerDesign(
  JSON.parse(await readFile(new URL('../src/assets/skarix-logo.json', import.meta.url), 'utf8')),
);
const icon = structuredClone(logo);
icon.elements = icon.elements.filter((e) => !['wordmark', 'tagline', 'divider'].includes(e.id));
for (const e of icon.elements) {
  if (e.id.endsWith('ribbon') || e.id.endsWith('aura')) {
    e.x = 24;
    e.y = 20 + (e.y - 15) * 1.3;
    e.width *= 1.4;
    e.height *= 1.3;
  }
}
function svg(design: typeof logo) {
  return designSvg(design).replace(/width="[^"]+" height="[^"]+"/, 'width="1024" height="1024"');
}
const fullSvg = svg(logo),
  iconSvg = svg(icon);
for (const [file, content] of [
  ['public/brand/skarix-logo.svg', fullSvg],
  ['public/brand/skarix-icon.svg', iconSvg],
  ['public/brand/skarix-mark.svg', iconSvg],
  ['public/favicon.svg', iconSvg],
])
  await writeFile(new URL('../' + file, import.meta.url), content + '\n');
const canvas = createCanvas(1024, 1024);
canvas.getContext('2d').drawImage(await loadImage(Buffer.from(iconSvg)), 0, 0, 1024, 1024);
await writeFile(new URL('../build/icon.png', import.meta.url), canvas.toBuffer('image/png'));
console.log('Generated Aurora logo, mark, favicon and desktop icon.');

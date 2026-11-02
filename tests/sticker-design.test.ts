import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  newDesign,
  newElement,
  validateStickerDesign,
  designSvg,
  elementPath,
  SHAPES,
} from '../src/lib/sticker-design';
import {
  newStickerProject,
  appendSticker,
  parseStickerProject,
  stickerPoses,
} from '../src/lib/stickers';
import { copySticker, pasteSticker } from '../src/lib/sticker-clipboard';

test('editable layers survive local project save/load and independent clipboard copies', () => {
  const design = newDesign(40, 30);
  design.elements = [newElement('text', design), newElement('shape', design)];
  let project = newStickerProject();
  project.artwork = [
    { id: 'design', name: 'Custom sticker', image: 'data:image/png;base64,AAAA', design },
  ];
  project = appendSticker(project, 'design', { width: 40, height: 30 });
  const loaded = parseStickerProject(JSON.stringify(project));
  assert.deepEqual(loaded.artwork[0].design, design);
  assert.deepEqual(stickerPoses(loaded), stickerPoses(project));
  const clip = copySticker(loaded, 0)!;
  const pasted = pasteSticker(newStickerProject(), clip, 0, () => 'copy');
  clip.artwork.design!.elements[0].text = 'Changed clipboard';
  assert.equal(loaded.artwork[0].design!.elements[0].text, 'Your text');
  assert.equal(pasted.artwork[0].design!.elements[0].text, 'Your text');
});

test('untrusted saved designs cannot inject markup or remote images and reject invalid geometry', () => {
  const d = newDesign();
  const text = newElement('text', d);
  text.text = '<script>alert("x")</script> & text';
  d.elements = [text];
  assert.ok(designSvg(d).includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; text'));
  for (const change of [
    { fill: 'url(https://example.com)' },
    { width: NaN },
    { rotation: Infinity },
    { font: 'bad" onload="bad' },
    { opacity: 2 },
  ])
    assert.throws(() => validateStickerDesign({ ...d, elements: [{ ...text, ...change }] }));
  assert.throws(() => validateStickerDesign({ ...d, elements: [text, text] }));
  assert.throws(() =>
    validateStickerDesign({
      ...d,
      elements: [{ ...newElement('image', d), image: 'https://example.com/image.png' }],
    }),
  );
  assert.throws(() =>
    validateStickerDesign({
      ...d,
      elements: [
        {
          ...newElement('draw', d),
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 1 },
          ],
        },
      ],
    }),
  );
  assert.throws(() =>
    validateStickerDesign({
      ...d,
      elements: Array.from({ length: 501 }, () => newElement('text', d)),
    }),
  );
});

test('shape, text, image and line layers produce printable SVG with the selected colors and transforms', async () => {
  const d = newDesign(40, 40);
  const red = { ...newElement('shape', d), x: 5, y: 5, width: 10, height: 10, fill: '#ff0000' };
  const line = {
    ...newElement('draw', d),
    x: 5,
    y: 25,
    width: 20,
    height: 0.1,
    stroke: '#0000ff',
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  };
  d.elements = [red, line];
  assert.equal(elementPath(line), 'M 0 0 L 20 0');
  const canvas = createCanvas(400, 400),
    context = canvas.getContext('2d');
  context.drawImage(await loadImage(Buffer.from(designSvg(d))), 0, 0, 400, 400);
  assert.deepEqual([...context.getImageData(100, 100, 1, 1).data], [255, 0, 0, 255]);
  assert.deepEqual([...context.getImageData(150, 250, 1, 1).data], [0, 0, 255, 255]);
  assert.deepEqual([...context.getImageData(350, 350, 1, 1).data], [255, 255, 255, 255]);
  const embedded = createCanvas(2, 2);
  embedded.getContext('2d').fillStyle = '#00ff00';
  embedded.getContext('2d').fillRect(0, 0, 2, 2);
  d.elements = [
    {
      ...newElement('image', d),
      x: 30,
      y: 30,
      width: 10,
      height: 10,
      image: embedded.toDataURL('image/png'),
    },
    { ...newElement('text', d), x: 0, y: 0, text: 'Hello', fill: '#000000' },
  ];
  context.drawImage(await loadImage(Buffer.from(designSvg(d))), 0, 0, 400, 400);
  // Skia omits embedded image data in SVG; the Electron test checks those pixels.
  assert.ok(designSvg(d).includes(embedded.toDataURL('image/png')));
  const textPixels = context.getImageData(0, 0, 240, 140).data;
  assert.ok(
    textPixels.some((v, i) => i % 4 === 0 && v < 100),
    'text must render visible ink',
  );
  for (const shape of SHAPES) {
    d.elements = [{ ...red, shape, rotation: 30, flipX: true }];
    const svg = designSvg(d);
    assert.match(svg, /rotate\(30\) scale\(-1 1\)/);
    assert.ok((await loadImage(Buffer.from(svg))).width > 0);
  }
  // Cut overlays belong only to the editor; generated artwork has no pink cut strokes.
  assert.ok(!designSvg(d).includes('#ec268f'));
});

test('shape gradients survive saving, render both colors, and leave cut geometry unprinted', async () => {
  const d = newDesign(40, 30);
  const shape = {
    ...newElement('shape', d),
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    gradient: { from: '#ff0000', to: '#0000ff' },
  };
  d.elements = [shape];
  const loaded = validateStickerDesign(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(loaded.elements[0].gradient, shape.gradient);
  const canvas = createCanvas(400, 300);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await loadImage(Buffer.from(designSvg(loaded))), 0, 0, 400, 300);
  const left = ctx.getImageData(40, 150, 1, 1).data;
  const right = ctx.getImageData(360, 150, 1, 1).data;
  assert.ok(left[0] > 200 && left[2] < 60);
  assert.ok(right[2] > 200 && right[0] < 60);
  assert.ok(
    !designSvg({ ...d, elements: [{ ...shape, operation: 'cut' }] }).includes('linearGradient'),
  );
  for (const gradient of [
    { from: 'url(https://example.com)', to: '#ffffff' },
    { from: '#ff0000' },
    false,
  ])
    assert.throws(() => validateStickerDesign({ ...d, elements: [{ ...shape, gradient }] }));
});

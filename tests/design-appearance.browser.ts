import {
  newDesign,
  newElement,
  validateStickerDesign,
  designSvg,
  type DesignElement,
} from '../src/lib/sticker-design';
function scene(...elements: Partial<DesignElement>[]) {
  const d = newDesign(40, 40);
  d.background = 'transparent';
  d.elements = elements.map((e, i) => ({
    ...newElement('shape', d),
    id: `layer-${i}`,
    x: 5,
    y: 5,
    width: 30,
    height: 30,
    ...e,
  }));
  return validateStickerDesign(d);
}
async function pixels(d: ReturnType<typeof scene>) {
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(designSvg(d));
  await image.decode();
  const canvas = createCanvas(400, 400),
    ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, 400, 400);
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
}
function createCanvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}
const cases: { name: string; run: () => unknown }[] = [];
const test = (name: string, run: () => unknown) => cases.push({ name, run });
const assert = {
  ok: (value: unknown) => {
    if (!value) throw Error('Assertion failed');
  },
  equal: (a: unknown, b: unknown) => {
    if (a !== b) throw Error(`${a} !== ${b}`);
  },
  deepEqual: (a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Values differ');
  },
  notDeepEqual: (a: unknown, b: unknown) => {
    if (JSON.stringify(a) === JSON.stringify(b)) throw Error('Expected different values');
  },
};
test('radial and angled multi-stop gradients render transparency and retain backward compatibility', async () => {
  const d = scene({
    gradient: {
      from: '#ff0000',
      to: '#0000ff',
      type: 'radial',
      stops: [
        { offset: 0, color: '#ff0000', opacity: 1 },
        { offset: 0.5, color: '#00ff00', opacity: 1 },
        { offset: 1, color: '#0000ff', opacity: 0 },
      ],
    },
  });
  const p = await pixels(d);
  assert.ok(p(200, 200)[0] > 230);
  assert.ok(p(270, 200)[1] > 200);
  assert.ok(p(348, 200)[3] < 20);
  d.elements[0].gradient = { from: '#ff0000', to: '#0000ff', angle: 90 };
  const linear = await pixels(d);
  assert.ok(linear(200, 80)[0] > 200 && linear(200, 320)[2] > 200);
  assert.deepEqual(validateStickerDesign(JSON.parse(JSON.stringify(d))), d);
});
test('blur, drop shadow, inner shadow and glow produce printable effects', async () => {
  const base = scene({ x: 10, y: 10, width: 20, height: 20, fill: '#ffffff' });
  const shadow = { type: 'drop' as const, color: '#000000', opacity: 1, blur: 1, x: 4, y: 0 };
  base.elements[0].effects = { shadows: [shadow] };
  const p = await pixels(base);
  assert.ok(p(330, 200)[3] > 100);
  base.elements[0].effects = { shadows: [{ ...shadow, type: 'inner', x: 3, blur: 0.2 }] };
  const inner = await pixels(base);
  assert.ok(inner(110, 200)[0] < 60 && inner(200, 200)[0] > 240);
  base.elements[0].effects = { shadows: [{ ...shadow, type: 'glow', color: '#ff0000', blur: 2 }] };
  const glow = await pixels(base);
  assert.ok(glow(90, 200)[0] > 200 && glow(90, 200)[3] > 0);
  base.elements[0].effects = { blur: 1 };
  const blur = await pixels(base);
  assert.ok(blur(95, 200)[3] > 0 && blur(105, 200)[3] < 255);
});
test('blend modes change overlapping layer pixels', async () => {
  const normal = scene({ fill: '#ff0000' }, { fill: '#0000ff', blendMode: 'multiply' });
  const p = await pixels(normal);
  assert.ok(
    p(200, 200)
      .slice(0, 3)
      .every((c) => c < 10),
  );
  normal.elements[1].blendMode = 'screen';
  const screen = await pixels(normal);
  assert.ok(screen(200, 200)[0] > 240 && screen(200, 200)[2] > 240);
  for (const mode of ['overlay', 'soft-light'] as const) {
    normal.elements[1].blendMode = mode;
    assert.ok(designSvg(normal).includes(`mix-blend-mode:${mode}`));
  }
});
test('clipping and soft masks contain artwork and fade edges', async () => {
  const d = scene({ fill: '#ff0000', mask: { shape: 'ellipse' } });
  const clipped = await pixels(d);
  assert.equal(clipped(55, 55)[3], 0);
  assert.equal(clipped(200, 200)[3], 255);
  d.elements[0].mask = { shape: 'rectangle', fade: 'left', feather: 0.2 };
  const faded = await pixels(d);
  assert.ok(faded(75, 200)[3] < faded(325, 200)[3]);
});
test('procedural textures are repeatable by seed and photo textures stay embedded', async () => {
  for (const type of ['grain', 'paper', 'stone', 'metal'] as const) {
    const d = scene({ fill: '#ffffff', texture: { type, seed: 19, scale: 1, opacity: 1 } });
    const a = await pixels(d),
      b = await pixels(d);
    assert.deepEqual(a(175, 215), b(175, 215));
    const old = [a(160, 180), a(210, 230)];
    d.elements[0].texture!.seed = 23;
    const c = await pixels(d);
    assert.notDeepEqual(old, [c(160, 180), c(210, 230)]);
  }
  const tile = createCanvas(2, 2);
  tile.getContext('2d')!.fillStyle = '#00ff00';
  tile.getContext('2d')!.fillRect(0, 0, 2, 2);
  const p = await pixels(
    scene({
      texture: { type: 'image', image: tile.toDataURL('image/png'), seed: 1, scale: 1, opacity: 1 },
    }),
  );
  assert.ok(p(200, 200)[1] > 240);
});
test('image adjustments alter rendered pixels without changing the original asset', async () => {
  const tile = createCanvas(2, 2),
    ctx = tile.getContext('2d')!;
  ctx.fillStyle = '#804020';
  ctx.fillRect(0, 0, 2, 2);
  const image = tile.toDataURL('image/png');
  const d = scene({
    kind: 'image',
    image,
    adjustments: { exposure: 1, saturation: 0, temperature: 0, contrast: 1, sharpen: 1 },
  });
  const p = await pixels(d);
  assert.ok(Math.abs(p(200, 200)[0] - p(200, 200)[1]) < 3);
  assert.ok(p(200, 200)[0] > 100);
  assert.equal(d.elements[0].image, image);
});

test('background blur samples earlier artwork and clips it to the foreground layer', async () => {
  const d = scene(
    { x: 5, y: 5, width: 15, height: 30, fill: '#000000' },
    { x: 20, y: 5, width: 15, height: 30, fill: '#ffffff' },
    { x: 5, y: 5, width: 30, height: 30, fill: 'transparent', effects: { backgroundBlur: 1 } },
  );
  const p = await pixels(d);
  assert.ok(p(195, 200)[0] > 20 && p(195, 200)[0] < 230);
  assert.ok(p(205, 200)[0] > 20 && p(205, 200)[0] < 230);
});
export async function run() {
  const results: string[] = [];
  for (const item of cases) {
    try {
      await item.run();
      results.push('PASS ' + item.name);
    } catch (error) {
      results.push('FAIL ' + item.name + ': ' + String(error));
    }
  }
  document.body.textContent = results.join('\n');
  document.body.style.whiteSpace = 'pre-wrap';
  return results;
}

test('text follows existing polygon guides in all three placements', async () => {
  for (const side of ['inner', 'middle', 'outer'] as const) {
    const d = scene(
      { id: 'guide', shape: 'ellipse', fill: 'transparent' },
      {
        id: 'caption',
        kind: 'text',
        font: 'Arial',
        fontSize: 4,
        bold: true,
        align: 'center',
        text: 'PATH TEXT',
        fill: '#ff0000',
        textPath: { pathId: 'guide', side, offset: 50 },
      },
    );
    const svg = designSvg(d);
    assert.ok(svg.includes('<textPath'));
    const p = await pixels(d);
    let red = 0;
    for (let x = 0; x < 400; x += 4)
      for (let y = 0; y < 400; y += 4) {
        const c = p(x, y);
        if (c[0] > 100 && c[1] < 80 && c[3] > 100) red++;
      }
    assert.ok(red > 5);
  }
});

test('MCP create/edit, cut fitting and export retain appearance and layer state end to end', async () => {
  const { registerAiWorkspace, invokeAiDesign } = await import('../src/lib/ai-design');
  const { newStickerProject } = await import('../src/lib/stickers');
  let project = newStickerProject();
  const dispose = registerAiWorkspace('stickers', {
    read: () => project,
    write: (value) => {
      project = value;
    },
    open: () => {},
    busy: () => false,
    undo: () => {},
    redo: () => {},
  });
  try {
    const created = (await invokeAiDesign('create_design', {
      workspace: 'stickers',
      name: 'Effects test',
      copies: 1,
      canvas: { width: 60, height: 60, grid: { visible: true, snap: true, spacing: 2 } },
      elements: [
        {
          id: 'guide',
          kind: 'shape',
          shape: 'ellipse',
          x: 15,
          y: 15,
          width: 30,
          height: 30,
          fill: 'transparent',
          operation: 'cut',
        },
        {
          id: 'disk',
          kind: 'shape',
          shape: 'ellipse',
          x: 15,
          y: 15,
          width: 30,
          height: 30,
          gradient: { from: '#ff0000', to: '#ffffff', type: 'radial' },
          effects: {
            shadows: [{ type: 'drop', color: '#000000', opacity: 0.4, blur: 1, x: 1, y: 1 }],
          },
        },
        {
          id: 'words',
          kind: 'text',
          text: 'MADE HERE',
          fontSize: 3,
          fill: '#000000',
          textPath: { pathId: 'guide', side: 'outer', offset: 50 },
        },
      ],
    })) as { designId: string };
    assert.ok(!!created.designId);
    await invokeAiDesign('edit_design', {
      workspace: 'stickers',
      designId: created.designId,
      operations: [
        { action: 'group', ids: ['disk', 'words'], id: 'art-group' },
        { action: 'update', id: 'art-group', patch: { rotation: 10 } },
      ],
    });
    await invokeAiDesign('fit_design_cut', {
      workspace: 'stickers',
      designId: created.designId,
      borderWidth: 1,
      strokeWidth: 0.2,
      strokeColor: '#000000',
      strokePlacement: 'inside',
    });
    const saved = project.artwork.find((a) => a.id === created.designId)!;
    assert.ok(saved.image.startsWith('data:image/png;base64,'));
    assert.ok(saved.design!.elements.some((e) => e.kind === 'group'));
    assert.equal(saved.design!.grid!.spacing, 2);
    assert.ok(saved.design!.elements.find((e) => e.id === 'guide')!.hidden);
    assert.ok(saved.design!.elements.some((e) => e.operation === 'cut' && !e.hidden));
  } finally {
    dispose();
  }
});

test('photo and procedural textures fill text glyphs, including text on a path', async () => {
  const tile = createCanvas(2, 2),
    ctx = tile.getContext('2d')!;
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, 2, 2);
  for (const curved of [false, true]) {
    const text: Partial<DesignElement> = {
      kind: 'text',
      text: 'TEXT',
      font: 'Arial',
      fontSize: 9,
      bold: true,
      align: 'center',
      fill: '#ffffff',
      x: 5,
      y: 5,
      width: 30,
      height: 30,
      ...(curved ? { textPath: { pathId: 'guide', side: 'inner' as const, offset: 50 } } : {}),
    };
    const d = scene({ id: 'guide', shape: 'ellipse', hidden: true }, text);
    const original = await pixels(d);
    d.elements[1].texture = {
      type: 'image',
      image: tile.toDataURL('image/png'),
      seed: 1,
      scale: 1,
      opacity: 1,
    };
    const photo = await pixels(d);
    let colored = 0;
    for (let x = 0; x < 400; x += 3)
      for (let y = 0; y < 400; y += 3) {
        const a = original(x, y),
          b = photo(x, y);
        if (a[3] === 0) assert.equal(b[3], 0);
        if (a[3] > 240 && b[1] > 240 && b[0] < 10) colored++;
      }
    if (colored <= 10) throw Error(`Photo texture: curved=${curved}, colored=${colored}`);
    for (const type of ['grain', 'paper', 'stone', 'metal'] as const) {
      d.elements[1].texture = { type, seed: 42, scale: 1, opacity: 1 };
      const textured = await pixels(d);
      let changed = 0;
      for (let x = 0; x < 400; x += 3)
        for (let y = 0; y < 400; y += 3) {
          const a = original(x, y),
            b = textured(x, y);
          if (a[3] === 0) assert.equal(b[3], 0);
          if (a[3] > 240 && b[0] < 252) changed++;
        }
      if (changed <= 5) throw Error(`Texture ${type}: curved=${curved}, changed=${changed}`);
    }
  }
});

test('closed text paths wrap across zero for every alignment and placement', async () => {
  for (const side of ['inner', 'middle', 'outer'] as const) {
    for (const align of ['left', 'center', 'right'] as const) {
      const d = scene(
        { id: 'guide', shape: 'ellipse', hidden: true },
        {
          kind: 'text',
          text: 'MMMMMMMM',
          font: 'Arial',
          fontSize: 3,
          bold: true,
          align,
          fill: '#ff0000',
          strokeWidth: 0,
          textPath: { pathId: 'guide', side, offset: 50 },
        },
      );
      const ink = async (offset: number) => {
        d.elements[1].textPath!.offset = offset;
        const p = await pixels(d);
        let total = 0;
        for (let x = 0; x < 400; x++) for (let y = 0; y < 400; y++) total += p(x, y)[3];
        return total;
      };
      const baseline = await ink(50);
      for (const offset of [0, 1, 99, 100]) {
        const total = await ink(offset);
        if (total < baseline * 0.95 || total > baseline * 1.05)
          throw Error(`Clipped text at ${offset}% (${align}, ${side}): ${total}/${baseline}`);
      }
    }
  }
});

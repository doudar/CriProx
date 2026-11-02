import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  newDesign,
  newElement,
  validateStickerDesign,
  designSvg,
  elementMatrix,
  parentMatrix,
  type DesignElement,
} from '../src/lib/sticker-design';
import { designCutPaths } from '../src/lib/sticker-contours';
import { groupLayers, ungroupLayer, duplicateLayer, removeLayer } from '../src/lib/design-groups';
import { applyDesignOperations } from '../src/lib/ai-design';
import { multiply, transformPoint } from '../src/lib/design-appearance';
const { designTool } = createRequire(import.meta.url)('../electron/ai-tools.cjs');
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
test('groups preserve appearance through transforms, duplicate, ungroup and deletion', async () => {
  const original = scene(
    { x: 5, y: 5, width: 10, height: 10, fill: '#ff0000' },
    { x: 20, y: 20, width: 10, height: 10, fill: '#0000ff' },
  );
  const grouped = groupLayers(original, ['layer-0', 'layer-1'], 'group');
  const originalPoint = transformPoint(elementMatrix(original.elements[0]), { x: 2, y: 3 });
  const groupedPoint = transformPoint(
    multiply(parentMatrix(grouped, grouped.elements[0]), elementMatrix(grouped.elements[0])),
    { x: 2, y: 3 },
  );
  assert.deepEqual(originalPoint, groupedPoint);
  const group = grouped.elements.find((e) => e.id === 'group')!;
  group.rotation = 30;
  group.width *= 1.4;
  group.effects = {
    shadows: [{ type: 'drop', color: '#000000', opacity: 0.5, blur: 1, x: 1, y: 1 }],
  };
  assert.throws(() => ungroupLayer(grouped, 'group'), /Reset group/);
  group.effects = undefined;
  const child = grouped.elements[0];
  const before = transformPoint(multiply(parentMatrix(grouped, child), elementMatrix(child)), {
    x: 2,
    y: 3,
  });
  const ungrouped = ungroupLayer(grouped, 'group');
  const after = transformPoint(elementMatrix(ungrouped.elements[0]), { x: 2, y: 3 });
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-8);
  const copied = duplicateLayer(grouped, 'group', 'copy');
  assert.equal(copied.elements.filter((e) => e.parentId === 'copy').length, 2);
  assert.equal(removeLayer(copied, 'group').elements.length, 3);
});
test('Bezier paths share exact endpoints and smooth cutter geometry, independent of effects', () => {
  const d = scene({
    kind: 'draw',
    points: [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    curves: [{ c1: { x: 0, y: 0 }, c2: { x: 1, y: 0 }, end: { x: 1, y: 1 } }],
    operation: 'cut',
  });
  const [cut] = designCutPaths(d);
  assert.deepEqual(cut.points[0], { x: 5, y: 35 });
  assert.deepEqual(cut.points.at(-1), { x: 35, y: 35 });
  assert.ok(cut.points.some((p) => p.y < 13));
  d.elements[0].effects = { blur: 4 };
  assert.deepEqual(designCutPaths(d), [cut]);
  assert.ok(!designSvg(d).includes('feGaussianBlur'));
});
test('appearance validation bounds resources and rejects invalid hierarchies and external assets', () => {
  for (const patch of [
    { effects: { blur: Infinity } },
    {
      texture: { type: 'image', image: 'https://example.com/a.png', seed: 1, scale: 1, opacity: 1 },
    },
    {
      gradient: {
        from: '#000000',
        to: '#ffffff',
        stops: Array(17).fill({ offset: 0, color: '#000000', opacity: 1 }),
      },
    },
    { parentId: 'missing' },
    { matrix: [0, 0, 0, 0, 0, 0] },
    { mask: { shape: '<script>' } },
  ])
    assert.throws(() => scene(patch as Partial<DesignElement>));
  const d = groupLayers(scene({}, { x: 20 }), ['layer-0', 'layer-1'], 'g');
  d.elements.find((e) => e.id === 'g')!.parentId = 'g';
  assert.throws(() => validateStickerDesign(d));
});
test('MCP exposes all appearance properties and atomic group operations', () => {
  const element = {
    kind: 'shape',
    id: 'art',
    gradient: {
      from: '#000000',
      to: '#ffffff',
      type: 'radial',
      stops: [
        { offset: 0, color: '#000000', opacity: 1 },
        { offset: 1, color: '#ffffff', opacity: 0 },
      ],
    },
    effects: {
      blur: 1,
      backgroundBlur: 1,
      shadows: [{ type: 'inner', color: '#000000', opacity: 0.5, blur: 1, x: 1, y: 1 }],
    },
    blendMode: 'soft-light',
    mask: { shape: 'ellipse', fade: 'radial' },
    texture: { type: 'paper', seed: 12, scale: 1, opacity: 0.3 },
  };
  const args = designTool('create_design').schema.parse({
    workspace: 'stickers',
    name: 'Artwork',
    elements: [element],
  });
  let d = applyDesignOperations(
    newDesign(),
    args.elements.map((element: unknown) => ({ action: 'add', element })),
  );
  assert.equal(d.elements[0].texture!.seed, 12);
  const ops = designTool('edit_design').schema.parse({
    workspace: 'stickers',
    designId: 'design',
    operations: [
      { action: 'add', element: { kind: 'shape', id: 'second' } },
      { action: 'group', ids: ['art', 'second'], id: 'g' },
      { action: 'update', id: 'g', patch: { mask: { shape: 'heart' } } },
    ],
  });
  d = applyDesignOperations(d, ops.operations);
  assert.equal(d.elements.find((e) => e.id === 'g')!.mask!.shape, 'heart');
  assert.throws(() =>
    applyDesignOperations(d, [{ action: 'update', id: 'art', patch: { parentId: 'absent' } }]),
  );
  assert.equal(d.elements.find((e) => e.id === 'art')!.parentId, 'g');
});

test('text paths survive grouping and duplication, and deleting the guide restores straight text', () => {
  const original = scene(
    { id: 'outline', shape: 'ellipse' },
    {
      id: 'caption',
      kind: 'text',
      text: 'Curved text',
      font: 'Arial',
      fontSize: 4,
      bold: false,
      align: 'center',
      textPath: { pathId: 'outline', side: 'inner', offset: 50 },
    },
  );
  assert.match(designSvg(original), /<textPath/);
  const grouped = groupLayers(original, ['outline', 'caption'], 'g');
  const copy = duplicateLayer(grouped, 'g', 'copy');
  const copiedText = copy.elements.find((e) => e.parentId === 'copy' && e.kind === 'text')!;
  assert.notEqual(copiedText.textPath!.pathId, 'outline');
  assert.ok(
    copy.elements.some((e) => e.id === copiedText.textPath!.pathId && e.parentId === 'copy'),
  );
  const removed = validateStickerDesign(removeLayer(original, 'outline'));
  assert.equal(removed.elements[0].textPath, undefined);
});
test('hidden layers are excluded from artwork and cuts; grid remains non-printing', () => {
  const d = scene({ hidden: true, fill: '#123456' }, { operation: 'cut', hidden: true });
  d.grid = { visible: true, snap: true, spacing: 2 };
  assert.ok(!designSvg(d).includes('#123456'));
  assert.equal(designCutPaths(d).length, 0);
  assert.ok(!designSvg(d).includes('editor-grid'));
  assert.deepEqual(validateStickerDesign(JSON.parse(JSON.stringify(d))).grid, d.grid);
});
test('locked layers reject MCP edits until explicitly unlocked', () => {
  const d = scene({ locked: true });
  assert.throws(
    () => applyDesignOperations(d, [{ action: 'update', id: 'layer-0', patch: { x: 10 } }]),
    /Unlock/,
  );
  const next = applyDesignOperations(d, [
    { action: 'update', id: 'layer-0', patch: { locked: false } },
    { action: 'update', id: 'layer-0', patch: { x: 10 } },
  ]);
  assert.equal(next.elements[0].x, 10);
  assert.equal(d.elements[0].x, 5);
});
test('alignment and distribution use transformed bounds and reject locked selections', () => {
  const d = scene({ x: 1, width: 4 }, { x: 15, width: 8 }, { x: 30, width: 6 });
  const parsed = designTool('edit_design').schema.parse({
    workspace: 'stickers',
    designId: 'd',
    canvas: { grid: { visible: true, snap: true, spacing: 2 } },
    operations: [{ action: 'align', ids: ['layer-0', 'layer-1', 'layer-2'], alignment: 'left' }],
  });
  const aligned = applyDesignOperations(d, parsed.operations, parsed.canvas);
  assert.ok(aligned.elements.every((e) => Math.abs(e.x - 1) < 1e-8));
  const distributed = applyDesignOperations(d, [
    { action: 'align', ids: ['layer-0', 'layer-1', 'layer-2'], alignment: 'distribute-horizontal' },
  ]);
  const centers = distributed.elements.map((e) => e.x + e.width / 2);
  assert.ok(Math.abs(centers[1] - (centers[0] + centers[2]) / 2) < 1e-8);
  d.elements[0].locked = true;
  assert.throws(() => applyDesignOperations(d, parsed.operations));
});

test('MCP accepts and persists text textures and can clear them', () => {
  const args = designTool('create_design').schema.parse({
    workspace: 'stickers',
    name: 'Text texture',
    elements: [
      { id: 'letters', kind: 'text', texture: { type: 'paper', seed: 4, scale: 2, opacity: 0.6 } },
    ],
  });
  const d = applyDesignOperations(
    newDesign(),
    args.elements.map((element: unknown) => ({ action: 'add', element })),
  );
  assert.equal(
    validateStickerDesign(JSON.parse(JSON.stringify(d))).elements[0].texture!.type,
    'paper',
  );
  const edit = designTool('edit_design').schema.parse({
    workspace: 'stickers',
    designId: 'd',
    operations: [{ action: 'update', id: 'letters', patch: { texture: null } }],
  });
  assert.equal(applyDesignOperations(d, edit.operations).elements[0].texture, undefined);
});

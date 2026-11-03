import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REPEAT, repeatTransforms } from '../src/lib/design-repeat';
import { newDesign, newElement, validateStickerDesign, designSvg } from '../src/lib/sticker-design';

test('repeat scatter is deterministic and preserves one editable source', () => {
  const repeat = {
    ...DEFAULT_REPEAT,
    mode: 'scatter' as const,
    rotationJitter: 20,
    opacityJitter: 0.3,
  };
  assert.deepEqual(repeatTransforms(repeat), repeatTransforms(repeat));
  assert.notDeepEqual(repeatTransforms(repeat), repeatTransforms({ ...repeat, seed: 8 }));
  const d = newDesign();
  d.elements.push({ ...newElement('shape', d), repeat });
  const clean = validateStickerDesign(JSON.parse(JSON.stringify(d)));
  assert.equal(clean.elements.length, 1);
  assert.deepEqual(clean.elements[0].repeat, repeat);
  const svg = designSvg(clean);
  assert.equal((svg.match(/<use /g) ?? []).length, 10);
});
test('repeat count budgets and inappropriate kinds reject before rendering', () => {
  const d = newDesign();
  d.elements.push({ ...newElement('shape', d), repeat: { ...DEFAULT_REPEAT, count: 201 } });
  assert.throws(() => validateStickerDesign(d));
  d.elements = Array.from({ length: 11 }, () => ({
    ...newElement('shape', d),
    repeat: { ...DEFAULT_REPEAT, count: 200 },
  }));
  assert.throws(() => validateStickerDesign(d), /2000/);
  d.elements = [{ ...newElement('shape', d), operation: 'cut', repeat: DEFAULT_REPEAT }];
  assert.throws(() => validateStickerDesign(d), /cannot be repeated/);
});
test('reference persists but never enters printed SVG', () => {
  const d = newDesign();
  d.reference = {
    image: 'data:image/png;base64,AAAA',
    opacity: 0.5,
    visible: true,
    x: 0,
    y: 0,
    width: 40,
    height: 40,
  };
  const clean = validateStickerDesign(d);
  assert.deepEqual(clean.reference, d.reference);
  assert.ok(!designSvg(clean).includes('AAAA'));
  assert.throws(() =>
    validateStickerDesign({
      ...d,
      reference: { ...d.reference, image: 'https://example.com/a.png' },
    }),
  );
});

test('MCP supports named layers, repeats, reference controls and material operations', async () => {
  const { designTool } = await import('../electron/ai-tools.cjs');
  const { applyDesignOperations } = await import('../src/lib/ai-design');
  const d = newDesign();
  const source = { ...newElement('shape', d), name: 'Frame' };
  d.elements.push(source);
  const args = designTool('edit_design').schema.parse({
    workspace: 'stickers',
    designId: 'bike',
    operations: [
      { action: 'apply_material', ids: [source.id], presetId: 'painted-metal' },
      { action: 'save_material', id: source.id, name: 'Frame finish' },
      { action: 'update', id: source.id, patch: { repeat: DEFAULT_REPEAT } },
    ],
    canvas: {
      reference: {
        image: 'data:image/png;base64,AAAA',
        opacity: 0.4,
        visible: true,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
      },
    },
  });
  const next = applyDesignOperations(d, args.operations, args.canvas);
  assert.equal(next.elements[0].name, 'Frame');
  assert.equal(next.elements[0].texture?.type, 'metal');
  assert.equal(next.materialPresets?.[0].name, 'Frame finish');
  assert.equal(next.elements[0].repeat?.count, 10);
  assert.ok(next.reference);
  assert.equal(applyDesignOperations(next, [], { reference: null }).reference, undefined);
  assert.throws(() =>
    designTool('preview_design').schema.parse({
      workspace: 'stickers',
      designId: 'bike',
      layerId: '<unsafe>',
    }),
  );
});

test('group frames include repeated geometry before group effects are applied', async () => {
  const { groupLayers } = await import('../src/lib/design-groups');
  const { layerBounds } = await import('../src/lib/design-layer-tools');
  const d = newDesign(100, 100);
  const a = {
    ...newElement('shape', d),
    x: 5,
    y: 5,
    width: 5,
    height: 5,
    repeat: { ...DEFAULT_REPEAT, count: 5, columns: 5, spacingX: 15 },
  };
  const b = { ...newElement('shape', d), x: 5, y: 15, width: 5, height: 5 };
  d.elements = [a, b];
  const grouped = groupLayers(d, [a.id, b.id], 'group');
  const group = grouped.elements.find((e) => e.id === 'group')!;
  assert.equal(layerBounds(grouped, group).right, 70);
  assert.equal(group.width, 65);
  group.effects = { blur: 0.1 };
  const svg = designSvg(validateStickerDesign(grouped));
  assert.ok(svg.includes('width="65.8"'), 'Effect filter includes all repeated artwork');
});

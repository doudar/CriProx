import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDesign,
  newElement,
  validateStickerDesign,
  designSvg,
  type DesignElement,
} from '../src/lib/sticker-design';
import { groupLayers } from '../src/lib/design-groups';
import {
  MATERIAL_PRESETS,
  applyMaterialPreset,
  parseMaterialPresets,
  saveMaterialPreset,
} from '../src/lib/design-materials';
function scene(...patches: Partial<DesignElement>[]) {
  const design = newDesign(50, 50);
  design.elements = patches.map((patch, index) => ({
    ...newElement('shape', design),
    id: `layer-${index}`,
    ...patch,
  }));
  return validateStickerDesign(design);
}
test('built-in materials round-trip, render deterministically and preserve geometry', () => {
  const before = scene({
    x: 7,
    y: 11,
    width: 20,
    height: 15,
    rotation: 32,
    flipX: true,
    strokeWidth: 0.5,
    stroke: '#123456',
  });
  const original = structuredClone(before);
  for (const preset of MATERIAL_PRESETS) {
    const result = applyMaterialPreset(before, ['layer-0'], preset);
    const e = result.elements[0];
    for (const key of [
      'id',
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'flipX',
      'flipY',
      'stroke',
      'strokeWidth',
    ] as const)
      assert.deepEqual(e[key], before.elements[0][key]);
    assert.equal(e.texture?.seed, preset.appearance.texture?.seed);
    assert.deepEqual(validateStickerDesign(JSON.parse(JSON.stringify(result))), result);
    assert.equal(designSvg(result), designSvg(applyMaterialPreset(before, ['layer-0'], preset)));
    assert.match(designSvg(result), /feTurbulence/);
  }
  assert.deepEqual(before, original, 'applying a material must not mutate an undo snapshot');
});
test('group materials are opt-in, skip locked children and preserve group appearance', () => {
  const source = scene({}, { locked: true }, { kind: 'line' });
  const grouped = groupLayers(source, ['layer-0', 'layer-2'], 'assembly');
  // A previously locked child can occur in a saved hierarchy.
  grouped.elements.find((e) => e.id === 'layer-1')!.parentId = 'assembly';
  assert.throws(
    () => applyMaterialPreset(grouped, ['assembly'], MATERIAL_PRESETS[0]),
    /group contents/,
  );
  const result = applyMaterialPreset(grouped, ['assembly'], MATERIAL_PRESETS[0], {
    includeDescendants: true,
  });
  assert.equal(result.elements.find((e) => e.id === 'layer-0')!.fill, '#627d96');
  for (const id of ['assembly', 'layer-1', 'layer-2'])
    assert.deepEqual(
      result.elements.find((e) => e.id === id),
      grouped.elements.find((e) => e.id === id),
    );
  grouped.elements.find((e) => e.id === 'assembly')!.locked = true;
  assert.throws(() => applyMaterialPreset(grouped, ['layer-0'], MATERIAL_PRESETS[0]), /unlocked/);
});
test('materials never turn cut, image, or open path layers into filled artwork', () => {
  const source = scene(
    { operation: 'cut' },
    {
      kind: 'draw',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      closed: false,
    },
    { kind: 'image', image: 'data:image/png;base64,AAAA' },
    {},
  );
  const result = applyMaterialPreset(
    source,
    source.elements.map((e) => e.id),
    MATERIAL_PRESETS[2],
  );
  assert.deepEqual(result.elements.slice(0, 3), source.elements.slice(0, 3));
  assert.throws(() => applyMaterialPreset(source, ['absent'], MATERIAL_PRESETS[0]), /existing/);
});
test('custom materials persist and replace names without retaining geometry or sharing appearance', () => {
  const source = applyMaterialPreset(scene({}, {}), ['layer-0'], MATERIAL_PRESETS[1]);
  const saved = saveMaterialPreset(source, 'layer-0', ' My rubber ');
  assert.equal(saved.materialPresets?.length, 1);
  assert.equal(saved.materialPresets![0].name, 'My rubber');
  assert.equal(source.materialPresets, undefined);
  const restored = validateStickerDesign(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.materialPresets, saved.materialPresets);
  const replaced = saveMaterialPreset(saved, 'layer-1', 'my rubber');
  assert.equal(replaced.materialPresets?.length, 1);
  assert.equal(replaced.materialPresets![0].id, saved.materialPresets![0].id);
  const applied = applyMaterialPreset(
    restored,
    ['layer-0', 'layer-1'],
    restored.materialPresets![0],
  );
  applied.elements[0].texture!.seed = 99;
  assert.notEqual(applied.elements[1].texture!.seed, 99);
  assert.notEqual(restored.materialPresets![0].appearance.texture!.seed, 99);
});
test('material validation rejects malformed or unbounded values and geometry injection', () => {
  for (const value of [
    null,
    Array(33).fill(MATERIAL_PRESETS[0]),
    [MATERIAL_PRESETS[0], MATERIAL_PRESETS[0]],
    [{ ...MATERIAL_PRESETS[0], name: ' ' }],
    [{ ...MATERIAL_PRESETS[0], appearance: { ...MATERIAL_PRESETS[0].appearance, x: 5 } }],
    [{ ...MATERIAL_PRESETS[0], appearance: { fill: '#ffffff', opacity: Infinity } }],
    [
      {
        ...MATERIAL_PRESETS[0],
        appearance: {
          fill: '#ffffff',
          opacity: 1,
          texture: {
            type: 'image',
            image: 'https://example.com/a.png',
            seed: 1,
            scale: 1,
            opacity: 1,
          },
        },
      },
    ],
  ])
    assert.throws(() => parseMaterialPresets(value));
});

test('photo textures remain layer-local and cannot be saved as reusable materials', () => {
  const design = scene({
    texture: { type: 'image', image: 'data:image/png;base64,AAAA', seed: 1, scale: 1, opacity: 1 },
  });
  assert.throws(() => saveMaterialPreset(design, 'layer-0', 'Photo'), /procedural textures/);
  assert.equal(design.materialPresets, undefined);
});

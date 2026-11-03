import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDesign,
  newElement,
  validateStickerDesign,
  designSvg,
  type StickerDesign,
} from '../src/lib/sticker-design';
import { groupLayers, ungroupLayer } from '../src/lib/design-groups';
import {
  layerAncestors,
  layerLabel,
  selectionViewBox,
  layerHitRegions,
} from '../src/lib/design-workflow';
import { layerHidden, layerLocked } from '../src/lib/design-layer-tools';
import { designCutPaths } from '../src/lib/sticker-contours';
import { DEFAULT_REPEAT, repeatTransforms } from '../src/lib/design-repeat';
import { renderDesignContent } from '../src/lib/design-render';
import { historyStep, type History } from '../src/lib/workspace-history';

function scene() {
  const d = newDesign(60, 60);
  d.elements = ['a', 'b', 'c'].map((id, index) => ({
    ...newElement('shape', d),
    id,
    x: 5 + index * 12,
    y: 5,
    width: 10,
    height: 10,
  }));
  return d;
}
const raster = 'data:image/png;base64,iVBORw0KGgo=';

test('named logical groups preserve hierarchy through history and project JSON reload', () => {
  const initial = scene();
  const grouped = groupLayers(initial, ['a', 'b'], 'face');
  grouped.elements.find((e) => e.id === 'face')!.name = 'Face details';
  const nested = groupLayers(grouped, ['face', 'c'], 'character');
  nested.elements.find((e) => e.id === 'character')!.name = 'Character';
  let history: History<StickerDesign> = { present: initial, past: [], future: [] };
  history = historyStep(history, { type: 'set', value: validateStickerDesign(nested) });
  assert.equal(historyStep(history, { type: 'undo' }).present, initial);
  history = historyStep(historyStep(history, { type: 'undo' }), { type: 'redo' });
  const loaded = validateStickerDesign(JSON.parse(JSON.stringify(history.present)));
  assert.deepEqual(
    layerAncestors(
      loaded,
      loaded.elements.find((e) => e.id === 'a')!,
    ).map(layerLabel),
    ['Character', 'Face details'],
  );
  assert.equal(layerLabel(loaded.elements.find((e) => e.id === 'face')!), 'Face details');
});

test('ungroup preserves inherited visibility and refuses locked logical parts', () => {
  const grouped = groupLayers(scene(), ['a', 'b'], 'face');
  const group = grouped.elements.find((e) => e.id === 'face')!;
  group.hidden = true;
  assert.equal(layerHidden(grouped, grouped.elements[0]), true);
  const ungrouped = ungroupLayer(grouped, 'face');
  assert.equal(
    layerHidden(
      ungrouped,
      ungrouped.elements.find((e) => e.id === 'a')!,
    ),
    true,
  );
  group.locked = true;
  assert.throws(() => ungroupLayer(grouped, 'face'), /Unlock/);
  group.locked = false;
  const nested = groupLayers(grouped, ['face', 'c'], 'character');
  nested.elements.find((e) => e.id === 'character')!.locked = true;
  assert.equal(
    layerLocked(
      nested,
      nested.elements.find((e) => e.id === 'face')!,
    ),
    true,
  );
  assert.throws(() => ungroupLayer(nested, 'face'), /Unlock/);
});

test('reference is persisted and undoable but excluded from artwork and cut output', () => {
  const initial = validateStickerDesign(scene());
  const reference = {
    image: raster,
    visible: true,
    opacity: 0.35,
    x: 0,
    y: 0,
    width: 60,
    height: 60,
  };
  const next = validateStickerDesign({ ...initial, reference });
  assert.deepEqual(validateStickerDesign(JSON.parse(JSON.stringify(next))).reference, reference);
  assert.equal(designSvg(next), designSvg(initial));
  assert.deepEqual(designCutPaths(next), designCutPaths(initial));
  let history: History<StickerDesign> = { present: initial, past: [], future: [] };
  history = historyStep(history, { type: 'set', value: next });
  assert.equal(historyStep(history, { type: 'undo' }).present.reference, undefined);
  const removed = validateStickerDesign({ ...next, reference: undefined });
  assert.equal(removed.reference, undefined);
  assert.throws(
    () =>
      validateStickerDesign({
        ...initial,
        reference: { ...reference, image: 'https://example.com/private.png' },
      }),
    /reference/i,
  );
  assert.throws(
    () => validateStickerDesign({ ...initial, reference: { ...reference, opacity: 2 } }),
    /reference/i,
  );
});

test('selection detail follows nested transformations and zoom without changing artwork', () => {
  const d = groupLayers(scene(), ['a', 'b'], 'face');
  const group = d.elements.find((e) => e.id === 'face')!;
  group.x += 10;
  const element = d.elements.find((e) => e.id === 'a')!;
  const [x, y, width, height] = selectionViewBox(d, element).split(' ').map(Number);
  assert.deepEqual([x, y, width, height], [13, 3, 14, 14]);
  const zoomed = selectionViewBox(d, element, 200).split(' ').map(Number);
  assert.deepEqual(zoomed.slice(2), [7, 7]);
  assert.equal(x + width / 2, zoomed[0] + zoomed[2] / 2);
});

test('grid, radial and scatter hit regions match every rendered copy, not the empty source', () => {
  for (const mode of ['grid', 'radial', 'scatter'] as const) {
    const d = scene();
    const element = d.elements[0];
    element.repeat = {
      ...DEFAULT_REPEAT,
      mode,
      count: 7,
      spacingX: 20,
      spacingY: 15,
      rotationJitter: 30,
    };
    const copies = repeatTransforms(element.repeat);
    const regions = layerHitRegions(element);
    const markup = renderDesignContent(d);
    assert.equal(regions.length, 7);
    regions.forEach((region, i) => {
      assert.equal(
        region.transform,
        `translate(${copies[i].x} ${copies[i].y}) rotate(${copies[i].rotation} 5 5)`,
      );
      assert.ok(markup.includes(`transform="${region.transform}"`));
      assert.equal(region.width, element.width);
      assert.equal(region.height, element.height);
    });
    if (mode === 'radial') assert.equal(regions[0].transform?.startsWith('translate(20 0)'), true);
  }
  const plain = scene().elements[0];
  assert.deepEqual(layerHitRegions(plain), [{ width: 10, height: 10, transform: undefined }]);
});

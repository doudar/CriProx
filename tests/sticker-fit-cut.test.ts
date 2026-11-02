import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, newElement, designSvg, validateStickerDesign } from '../src/lib/sticker-design';
import { artworkHull, fittedDesignFromHull, reorderDesignLayer } from '../src/lib/sticker-fit-cut';
import { designCutPaths, designOutputBounds } from '../src/lib/sticker-cuts';
import { historyStep } from '../src/lib/workspace-history';

test('Fit Cut encloses all artwork with padding and an independently printed stroke', () => {
  const d = newDesign();
  d.elements = [newElement('text', d), { ...newElement('shape', d), operation: 'cut' }];
  const hull = artworkHull([
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 20 },
    { x: 10, y: 20 },
    { x: 15, y: 15 },
  ]);
  const fitted = fittedDesignFromHull(d, hull, {
    borderWidth: 1,
    strokeWidth: 0.4,
    strokeColor: '#112233',
  });
  const bounds = designOutputBounds(fitted);
  assert.ok(Math.abs(bounds.width - 22.8) < 1e-7 && Math.abs(bounds.height - 12.8) < 1e-7);
  assert.equal(designCutPaths(fitted).length, 1);
  assert.equal(fitted.elements.filter((e) => e.operation === 'cut').length, 1);
  assert.equal(fitted.elements[0].text, 'Your text');
  assert.equal(fitted.elements.find((e) => e.id === fitted.fitCut!.strokeId)!.strokeWidth, 0.4);
  assert.ok(designSvg(fitted).includes('stroke="#112233" stroke-width="0.4"'));
  assert.deepEqual(validateStickerDesign(JSON.parse(JSON.stringify(fitted))), fitted);
  const again = fittedDesignFromHull(fitted, hull, {
    borderWidth: 2,
    strokeWidth: 0,
    strokeColor: '#112233',
  });
  assert.equal(
    again.elements.length,
    2,
    're-fitting replaces the generated border instead of accumulating it',
  );
  assert.equal(again.fitCut!.strokeId, undefined);
});
test('fitted cuts expand the canvas to preserve artwork near an edge and remain undoable', () => {
  const d = newDesign();
  d.elements = [{ ...newElement('shape', d), x: 0, y: 0, width: 40, height: 40 }];
  const hull = artworkHull([
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ]);
  const fitted = fittedDesignFromHull(d, hull, {
    borderWidth: 2,
    strokeWidth: 0,
    strokeColor: '#000000',
  });
  assert.equal(fitted.width, 44);
  assert.equal(fitted.height, 44);
  assert.equal(fitted.elements[0].x, 2);
  assert.equal(fitted.elements[0].y, 2);
  assert.deepEqual(designOutputBounds(fitted), { x: 0, y: 0, width: 44, height: 44 });
  assert.equal(
    historyStep({ present: fitted, past: [d], future: [] }, { type: 'undo' }).present,
    d,
  );
  assert.throws(() =>
    fittedDesignFromHull(d, hull, { borderWidth: -1, strokeWidth: 0, strokeColor: '#000000' }),
  );
});
test('dragging a layer changes its stacking order once and supports Undo/Redo', () => {
  const d = newDesign();
  d.elements = [newElement('shape', d), newElement('text', d), newElement('shape', d)];
  const reordered = reorderDesignLayer(d, d.elements[2].id, d.elements[0].id);
  assert.deepEqual(
    reordered.elements.map((e) => e.id),
    [d.elements[2].id, d.elements[0].id, d.elements[1].id],
  );
  assert.deepEqual(
    d.elements.map((e) => e.kind),
    ['shape', 'text', 'shape'],
  );
  const undone = historyStep({ present: reordered, past: [d], future: [] }, { type: 'undo' });
  assert.equal(undone.present, d);
  assert.equal(historyStep(undone, { type: 'redo' }).present, reordered);
  assert.equal(reorderDesignLayer(d, 'missing', d.elements[0].id), d);
});

for (const [strokePlacement, padding] of [
  ['inside', 3],
  ['centered', 2],
  ['outside', 1],
] as const) {
  test(`cut border places the printed stroke ${strokePlacement} and preserves the saved choice`, () => {
    const design = newDesign();
    design.elements = [newElement('shape', design)];
    const hull = artworkHull([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]);
    const fitted = fittedDesignFromHull(design, hull, {
      borderWidth: 1,
      strokeWidth: 2,
      strokeColor: '#112233',
      strokePlacement,
    });
    const cut = fitted.elements.find((e) => e.operation === 'cut')!;
    const stroke = fitted.elements.find((e) => e.id === fitted.fitCut!.strokeId)!;
    assert.ok(Math.abs(cut.width - (20 + 2 * padding)) < 1e-7);
    assert.ok(Math.abs(stroke.width - 24) < 1e-7);
    assert.ok(stroke.x - stroke.strokeWidth / 2 >= 0, 'the full printed stroke fits the canvas');
    assert.equal(
      validateStickerDesign(JSON.parse(JSON.stringify(fitted))).fitCut!.strokePlacement,
      strokePlacement,
    );
  });
}
test('older cut borders default to inside and invalid placement is rejected', () => {
  const design = {
    ...newDesign(),
    fitCut: { borderWidth: 1, strokeWidth: 1, strokeColor: '#000000' },
  };
  assert.equal(validateStickerDesign(design).fitCut!.strokePlacement, 'inside');
  assert.throws(() =>
    validateStickerDesign({ ...design, fitCut: { ...design.fitCut, strokePlacement: 'invalid' } }),
  );
});

test('refitting preserves locked cut layers by requiring an explicit unlock', () => {
  const design = newDesign();
  design.elements = [{ ...newElement('shape', design), operation: 'cut', locked: true }];
  const hull = artworkHull([
    { x: 5, y: 5 },
    { x: 10, y: 5 },
    { x: 10, y: 10 },
    { x: 5, y: 10 },
  ]);
  assert.throws(
    () =>
      fittedDesignFromHull(design, hull, {
        borderWidth: 1,
        strokeWidth: 0,
        strokeColor: '#000000',
      }),
    /Unlock cut/,
  );
});

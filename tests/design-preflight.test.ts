import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightDesign } from '../src/lib/design-preflight';
import { invokeAiDesign, registerAiWorkspace } from '../src/lib/ai-design';
import { newStickerProject } from '../src/lib/stickers';

test('preflight reports current versus limits without rendering', () => {
  const result = preflightDesign({
    canvas: { width: 300 },
    elements: Array.from({ length: 501 }, () => ({ kind: 'shape' })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((c) => c.metric === 'layers')?.current, 501);
  assert.equal(result.checks.find((c) => c.metric === 'layers')?.max, 500);
  assert.match(result.checks.find((c) => c.metric === 'canvas.widthMm')!.suggestion!, /scale/);
  assert.equal(preflightDesign({}).ok, true);
  assert.equal((preflightDesign({}).render as any).outputDataUrlCharactersMax, 14_000_000);
});

test('preflight counts cubic control points and embedded data URL characters', () => {
  const result = preflightDesign({
    elements: [
      {
        kind: 'draw',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        curves: [{ c1: { x: 0, y: 0 }, c2: { x: 1, y: 1 }, end: { x: 1, y: 1 } }],
      },
      { kind: 'image', image: 'data:image/png;base64,AAAA' },
    ],
  });
  assert.equal(
    result.checks.find((c) => c.metric === 'totalPointsIncludingCurveControls')?.current,
    5,
  );
  assert.equal(result.checks.find((c) => c.metric === 'embeddedDataUrlCharacters')?.current, 26);
});

test('busy editor permits inspection and preflight but blocks mutations; resolution requires confirmation', async () => {
  const project = newStickerProject();
  let writes = 0,
    resolutions = 0;
  const stop = registerAiWorkspace('stickers', {
    read: () => project,
    write: () => {
      writes++;
    },
    busy: () => true,
    open: () => {},
    undo: () => {},
    redo: () => {},
    editorState: () => ({
      operation: 'Editing label',
      operationId: 'draft-1',
      actions: ['save', 'cancel'],
    }),
    resolveEditor: async (_action, id) => {
      assert.equal(id, 'draft-1');
      resolutions++;
    },
  });
  try {
    assert.equal(
      (await invokeAiDesign('get_workspace', { workspace: 'stickers' })).name,
      project.name,
    );
    assert.equal(
      (await invokeAiDesign('get_editor_state', { workspace: 'stickers' })).operation,
      'Editing label',
    );
    assert.equal((await invokeAiDesign('preflight_design', { workspace: 'stickers' })).ok, true);
    await assert.rejects(
      invokeAiDesign('create_project', { workspace: 'stickers', name: 'replacement' }),
      /Finish/,
    );
    await assert.rejects(
      invokeAiDesign('resolve_editor_operation', {
        workspace: 'stickers',
        action: 'cancel',
        operationId: 'draft-1',
      }),
    );
    await assert.rejects(
      invokeAiDesign('resolve_editor_operation', {
        workspace: 'stickers',
        action: 'cancel',
        operationId: 'stale-draft',
        confirm: true,
      }),
      /changed/,
    );
    assert.equal(resolutions, 0);
    await invokeAiDesign('resolve_editor_operation', {
      workspace: 'stickers',
      action: 'save',
      operationId: 'draft-1',
      confirm: true,
    });
    assert.equal(resolutions, 1);
    assert.equal(writes, 0);
  } finally {
    stop();
  }
});

test('preflight enforces total rendered repeat copies separately from editable layers', () => {
  const result = preflightDesign({
    elements: Array.from({ length: 11 }, () => ({
      kind: 'shape',
      repeat: { mode: 'grid', count: 200, columns: 10, dx: 1, dy: 1 },
    })),
  });
  assert.equal(result.checks.find((c) => c.metric === 'layers')?.ok, true);
  assert.equal(result.checks.find((c) => c.metric === 'renderedCopies')?.current, 2200);
  assert.equal(result.checks.find((c) => c.metric === 'renderedCopies')?.ok, false);
});

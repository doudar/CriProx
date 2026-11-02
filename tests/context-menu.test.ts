import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { contextMenuTemplate } = require('../electron/context-menu.cjs') as {
  contextMenuTemplate: (params?: {
    isEditable?: boolean;
    selectionText?: string;
    editFlags?: Record<string, boolean>;
  }) => Array<{ role?: string; type?: string; enabled?: boolean }>;
};

test('editable fields expose standard editing actions with the browser-provided state', () => {
  const template = contextMenuTemplate({
    isEditable: true,
    editFlags: {
      canUndo: false,
      canRedo: true,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canDelete: true,
      canSelectAll: true,
    },
  });

  assert.deepEqual(
    template.map(({ role, type }) => role || type),
    ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'delete', 'separator', 'selectAll'],
  );
  assert.equal(template[0].enabled, false);
  assert.equal(template[1].enabled, true);
  assert.equal(template[5].enabled, true);
});

test('selected read-only text exposes copy without an unrelated page menu', () => {
  assert.deepEqual(contextMenuTemplate({ selectionText: 'Skarix' }), [
    { role: 'copy', enabled: true },
  ]);
  assert.deepEqual(contextMenuTemplate(), []);
});

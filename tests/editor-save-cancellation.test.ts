import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelAiDesignRequests, invokeAiDesign, registerAiWorkspace } from '../src/lib/ai-design';
import { newStickerProject } from '../src/lib/stickers';

for (const invalidation of ['stop', 'project', 'draft', 'workspace'] as const) {
  test(`editor save commit guard rejects ${invalidation} during rendering`, async () => {
    let project = newStickerProject(),
      operationId = 'draft-1',
      commits = 0;
    let release!: () => void;
    const rendering = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = registerAiWorkspace('stickers', {
      read: () => project,
      write: () => {},
      busy: () => true,
      open: () => {},
      undo: () => {},
      redo: () => {},
      editorState: () => ({ operation: 'Editing', operationId, actions: ['save', 'cancel'] }),
      resolveEditor: async (_action, _id, request) => {
        await rendering;
        if (invalidation === 'stop') assert.equal(request.signal.aborted, true);
        request.assertCurrent();
        commits++;
      },
    });
    try {
      const pending = invokeAiDesign('resolve_editor_operation', {
        workspace: 'stickers',
        action: 'save',
        operationId,
        confirm: true,
      });
      if (invalidation === 'stop') cancelAiDesignRequests();
      if (invalidation === 'project') project = newStickerProject();
      if (invalidation === 'draft') operationId = 'draft-2';
      if (invalidation === 'workspace') stop();
      release();
      await assert.rejects(pending, /stopped|changed/);
      assert.equal(commits, 0);
    } finally {
      stop();
    }
  });
}

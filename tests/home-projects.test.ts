import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, workspaceName } from '../src/lib/workspaces';
import {
  projectSummary,
  pruneRecentProjects,
  type RecentProject,
} from '../src/lib/recent-projects';
import { newStickerProject } from '../src/lib/stickers';
import { projectFromDefaults, FACTORY_PROJECT_DEFAULTS } from '../src/lib/project-defaults';

test('Home and navigation share named workspace definitions', () => {
  assert.equal(workspaceName('cards'), 'Preserved CriProx project');
  assert.equal(new Set(WORKSPACES.map((w) => w.id)).size, WORKSPACES.length);
  for (const w of WORKSPACES) assert.ok(w.name && w.description && w.action);
});
test('recent-project summaries count placed items in either workspace', () => {
  const cards = projectFromDefaults(FACTORY_PROJECT_DEFAULTS);
  cards.entries = [
    {
      id: 'entry',
      quantity: 5,
      face: 0,
      card: { id: 'card', name: 'Card', set: 'local', setName: 'Local', collector: '', faces: [] },
    },
  ];
  const summary = projectSummary(cards, 'cards');
  assert.equal(
    summary.count,
    cards.entries.reduce((sum, e) => sum + e.quantity, 0),
  );
  const stickers = newStickerProject();
  stickers.items = ['a', 'a', 'b'];
  assert.equal(projectSummary(stickers, 'stickers').count, 3);
});
test('recent snapshots retain the newest project, deduplicate identities and bound storage', () => {
  const item = (id: string, bytes: number): RecentProject => ({
    id,
    workspace: 'stickers',
    name: id,
    count: 1,
    bytes,
    updatedAt: '2026-11-01T12:00:00.000Z',
  });
  assert.deepEqual(
    pruneRecentProjects([
      item('a', 40_000_000),
      item('a', 40_000_000),
      item('b', 40_000_000),
      item('c', 40_000_000),
    ]).map((p) => p.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    pruneRecentProjects([item('large', 95_000_000), item('small', 1)]).map((p) => p.id),
    ['large'],
  );
  assert.equal(
    pruneRecentProjects(Array.from({ length: 20 }, (_, i) => item(String(i), 100))).length,
    8,
  );
  assert.deepEqual(
    pruneRecentProjects([
      { ...item('file-copy', 100), identity: 'same-project' },
      { ...item('old-draft', 100), identity: 'same-project' },
    ]).map((p) => p.id),
    ['file-copy'],
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { starterDesign } from '../src/lib/starter-project';
import { validateStickerDesign } from '../src/lib/sticker-design';
const require = createRequire(import.meta.url);
const { compatibleUserData } = require('../electron/user-data-path.cjs');
const { DESIGN_TOOLS, designTool } = require('../electron/ai-tools.cjs');
test('Skarix starter uses original editable layers within its physical canvas', () => {
  const d = validateStickerDesign(starterDesign());
  assert.equal(d.width, 100);
  assert.equal(d.height, 100);
  assert.equal(d.elements.length, 10);
  assert.equal(d.elements.filter((e) => e.kind === 'draw' && e.closed).length, 4);
  assert.ok(d.elements.some((e) => e.kind === 'text' && e.text === 'skarix'));
  assert.ok(
    d.elements.every(
      (e) =>
        !e.image && e.x >= 0 && e.y >= 0 && e.x + e.width <= d.width && e.y + e.height <= d.height,
    ),
  );
});
test('existing data directory takes precedence and no user files are moved', () => {
  const base = join('test-data', 'profiles');
  assert.equal(
    compatibleUserData(base, () => false),
    join(base, 'Skarix'),
  );
  for (const name of ['Skarix', 'CriProx', 'criprox'])
    assert.equal(
      compatibleUserData(base, (p: string) => p === join(base, name)),
      join(base, name),
    );
  assert.equal(
    compatibleUserData(base, () => true),
    join(base, 'Skarix'),
  );
});
test('catalogs and gaming-card workspace are absent from the AI boundary', () => {
  assert.equal(DESIGN_TOOLS.length, 19);
  for (const name of ['search_cards', 'add_catalog_cards', 'edit_card_entries'])
    assert.throws(() => designTool(name));
  assert.throws(() =>
    designTool('create_project').schema.parse({ workspace: 'cards', name: 'Legacy' }),
  );
  assert.equal(
    designTool('create_project').schema.parse({ workspace: 'stickers', name: 'New' }).name,
    'New',
  );
});

test('renamed builds still accept prior captured-template filenames', () => {
  const { registrationTemplateFilename } = require('../electron/registration-template-library.cjs');
  assert.equal(
    registrationTemplateFilename('CP-1234ABCD', 6, 'CriProx-maker-letter'),
    'CriProx-maker-letter-cricut-template.pdf',
  );
  assert.equal(
    registrationTemplateFilename('CP-1234ABCD', 6, 'Skarix-maker-letter'),
    'Skarix-maker-letter-cricut-template.pdf',
  );
});
test('updates stay inside the renamed repository and recognize existing release assets', () => {
  const { isTrustedReleaseUrl, selectReleaseAssets } = require('../electron/release-check.cjs');
  assert.equal(
    isTrustedReleaseUrl('https://github.com/Go2Engle/CriProx/releases/tag/v9.0.0'),
    false,
  );
  assert.equal(isTrustedReleaseUrl('https://github.com/doudar/Skarix/releases/tag/v0.17.1'), true);
  const names = ['CriProx-0.17.1-win-x64.exe', 'SHA256SUMS.txt'];
  const release = {
    tag_name: 'v0.17.1',
    assets: names.map((name) => ({
      name,
      size: 100,
      browser_download_url: 'https://github.com/doudar/Skarix/releases/download/v0.17.1/' + name,
    })),
  };
  assert.ok(selectReleaseAssets(release, 'win32', 'x64'));
});

test('legacy design exports reopen with the current Skarix file identifier', async () => {
  const { newStickerProject, validateStickerProject } = await import('../src/lib/stickers');
  const current = newStickerProject();
  assert.equal(current.kind, 'skarix-stickers');
  const migrated = validateStickerProject({ ...current, kind: 'criprox-stickers' });
  assert.equal(migrated.kind, 'skarix-stickers');
  assert.equal(migrated.name, current.name);
});

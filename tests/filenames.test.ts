import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportFilename,
  filenameStem,
  templateFilename,
  templateFilenameStem,
} from '../src/lib/filenames';
import { DEFAULT_SETTINGS, EMPTY_PROJECT } from '../src/lib/types';

const project = { ...EMPTY_PROJECT, name: 'My Commander: Deck / 2026' };

test('deck exports identify the project, paper, layout, and purpose', () => {
  for (const purpose of [
    'cards',
    'fronts',
    'backs',
    'duplex',
    'size-check',
    'alignment-front',
    'alignment-back',
    'alignment-duplex',
  ])
    assert.equal(
      exportFilename(project, purpose, 'pdf'),
      `My-Commander-Deck-2026-US-Letter-6-card-${purpose}.pdf`,
    );
  assert.equal(
    exportFilename(project, 'export', 'zip'),
    'My-Commander-Deck-2026-US-Letter-6-card-export.zip',
  );
  assert.equal(
    exportFilename(project, 'sheet-03-artwork', 'png'),
    'My-Commander-Deck-2026-US-Letter-6-card-sheet-03-artwork.png',
  );
  assert.equal(
    exportFilename(project, 'sheet-03-cut-template', 'svg'),
    'My-Commander-Deck-2026-US-Letter-6-card-sheet-03-cut-template.svg',
  );
});

test('all supported layouts use the actual capacity and output paper', () => {
  for (const [profile, count] of [
    ['expanded', 6],
    ['seven', 7],
    ['eight', 8],
    ['nine', 9],
  ] as const) {
    const a4 = {
      ...project,
      settings: {
        ...DEFAULT_SETTINGS,
        profile,
        paper: 'a4' as const,
        machine: profile === 'nine' ? ('manual' as const) : ('maker' as const),
      },
    };
    assert.equal(
      exportFilename(a4, 'cards', 'pdf'),
      `My-Commander-Deck-2026-A4-${count}-card-cards.pdf`,
    );
  }
  const custom = { ...project, settings: { ...DEFAULT_SETTINGS, width: 80, height: 100 } };
  assert.match(exportFilename(custom, 'cards', 'pdf'), /-4-card-cards.pdf$/);
});

test('templates describe geometry independently of the deck and artwork settings', () => {
  assert.equal(
    templateFilename(DEFAULT_SETTINGS, 'setup', 'png'),
    'Skarix-maker-US-Letter-6-card-expanded-63x88mm-gap-1mm-radius-2.5mm-setup.png',
  );
  assert.equal(
    templateFilenameStem({ ...DEFAULT_SETTINGS, dpi: 1200, backOffsetX: 2, bleed: 0, units: 'mm' }),
    templateFilenameStem(DEFAULT_SETTINGS),
  );
  for (const settings of [
    { ...DEFAULT_SETTINGS, machine: 'explore' as const },
    { ...DEFAULT_SETTINGS, paper: 'a4' as const },
    { ...DEFAULT_SETTINGS, width: 63.0001 },
    { ...DEFAULT_SETTINGS, height: 89 },
    { ...DEFAULT_SETTINGS, gap: 1.001 },
    { ...DEFAULT_SETTINGS, radius: 2.6 },
  ])
    assert.notEqual(templateFilenameStem(settings), templateFilenameStem(DEFAULT_SETTINGS));
});

test('Cricut manual PDFs describe cut offsets in readable directions', () => {
  const manual = {
    ...project,
    settings: {
      ...DEFAULT_SETTINGS,
      profile: 'nine' as const,
      manualCutCorrectionX: 0.5,
      manualCutCorrectionY: -1.25,
    },
  };
  assert.equal(
    exportFilename(manual, 'fronts', 'pdf'),
    'My-Commander-Deck-2026-US-Letter-9-card-fronts-cut-offset-x-0.5mm-right-y-1.25mm-up.pdf',
  );
  assert.match(
    exportFilename(
      {
        ...manual,
        settings: { ...manual.settings, manualCutCorrectionX: 0, manualCutCorrectionY: 0 },
      },
      'manual-cut-calibration',
      'pdf',
    ),
    /-cut-offset-x-centered-y-centered.pdf$/,
  );
  assert.equal(
    exportFilename(
      { ...manual, settings: { ...manual.settings, machine: 'manual' } },
      'cards',
      'pdf',
    ),
    'My-Commander-Deck-2026-US-Letter-9-card-cards.pdf',
  );
  assert.doesNotMatch(templateFilename(manual.settings, 'basic-cut', 'png'), /cut-offset/);
});

test('user names are safe, bounded, and preserve international letters', () => {
  assert.equal(filenameStem('  ../My deck: <v2> / ?  '), 'My-deck-v2');
  assert.equal(filenameStem('Éowyn 日本語'), 'Éowyn-日本語');
  assert.equal(filenameStem('...'), 'Skarix');
  assert.equal(filenameStem('CON'), 'Skarix-CON');
  assert.equal(filenameStem('nul'), 'Skarix-nul');
  assert.equal(filenameStem('x'.repeat(200)).length, 80);
  assert.ok(new TextEncoder().encode(filenameStem('界'.repeat(200))).length <= 80);
});

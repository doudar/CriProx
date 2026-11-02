import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelope, grid, layout, mmToPx, templateSvg } from '../src/lib/layout';
import { formatDimensions, formatMeasurement } from '../src/lib/units';
import { projectFilename } from '../src/lib/save-project';
import { manualGuidePaths } from '../src/lib/cut-guides';
import {
  backBleedMm,
  backOuterBleedMm,
  DEFAULT_SETTINGS,
  EMPTY_PROJECT,
  fixedBleedMm,
  frontBleedMm,
  PRINT_DPI_OPTIONS,
  type Entry,
} from '../src/lib/types';
import { validateProject } from '../src/lib/project';
import { withDpi } from '../src/lib/png';
import { fitArtwork, instructions } from '../src/lib/export';
import { availableSheetProfiles, paperWorkflow } from '../src/lib/paper-workflow';
import {
  MANUAL_CUT_INSET_MM,
  manualCutCorrection,
  manualCutCorrectionFileTag,
  manualCutCorrectionLabel,
  manualCutFirstSlotBounds,
  manualCutEdgeGuides,
  manualCutLineBounds,
  manualCutPlacement,
} from '../src/lib/manual-cut';
import {
  artworkSourceRect,
  isEmbeddedArtwork,
  looksLikeMpcPrintCanvas,
  usesMpcTrim,
  withMpcTrim,
} from '../src/lib/artwork';
const entry: Entry = {
  id: 'entry-1',
  quantity: 1,
  face: 0,
  card: {
    id: 'card-1',
    name: 'Sol Ring',
    set: 'cmm',
    setName: 'Commander Masters',
    collector: '396',
    faces: [
      {
        name: 'Sol Ring',
        image: 'https://cards.scryfall.io/example.png',
        preview: 'https://cards.scryfall.io/example.png',
      },
    ],
  },
};
test('layout preserves requested quantity over full and partial sheets without stretching', () => {
  const settings = DEFAULT_SETTINGS;
  const pages = layout([{ ...entry, quantity: 9 }], settings);
  assert.deepEqual(
    pages.map((p) => p.placements.length),
    [6, 3],
  );
  assert.equal(pages[0].width, 177);
  assert.equal(pages[0].height, 191);
  assert.equal(pages[1].width, 177);
  assert.equal(pages[1].height, 127);
  assert.equal(pages.flatMap((s) => s.placements).length, 9);
  assert.deepEqual(layout([], DEFAULT_SETTINGS), []);
});
test('default layout uses TCG dimensions and six rounded cut slots', () => {
  const settings = DEFAULT_SETTINGS;
  const pages = layout([{ ...entry, quantity: 6 }], settings);
  assert.equal(grid(settings).capacity, 6);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 177);
  assert.equal(pages[0].height, 191);
  assert.ok(pages[0].placements.every((p) => p.rotated));
  const svg = templateSvg(pages[0], settings);
  assert.equal((svg.match(/<rect /g) || []).length, 6);
  assert.match(svg, /width="177mm" height="191mm"/);
  assert.equal(settings.width, 63);
  assert.equal(settings.height, 88);
  assert.equal(settings.radius, 2.5);
  assert.equal(settings.gap, 1);
  assert.equal(settings.bleed, 0.5);
  assert.equal(settings.proxyLabel, false);
  assert.match(svg, /rx="2\.5" ry="2\.5"/);
  assert.ok(!/image|clipPath|stroke/.test(svg));
});
test('experimental seven-card layout uses the proven 2-3-2 Letter geometry', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    profile: 'seven' as const,
    gap: 0.1,
    bleed: 0.05,
  };
  const pages = layout([{ ...entry, quantity: 17 }], settings);
  assert.equal(grid(settings).capacity, 7);
  assert.deepEqual(
    pages.map((page) => page.placements.length),
    [7, 7, 3],
  );
  assert.ok(pages.every((page) => page.width === 189.2 && page.height === 214.2));
  assert.deepEqual(
    pages[0].placements.map(({ x, y, width, height, rotated }) => ({
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      width,
      height,
      rotated,
    })),
    [
      { x: 6.55, y: 0, width: 88, height: 63, rotated: true },
      { x: 94.65, y: 0, width: 88, height: 63, rotated: true },
      { x: 0, y: 63.1, width: 63, height: 88, rotated: false },
      { x: 63.1, y: 63.1, width: 63, height: 88, rotated: false },
      { x: 126.2, y: 63.1, width: 63, height: 88, rotated: false },
      { x: 6.55, y: 151.2, width: 88, height: 63, rotated: true },
      { x: 94.65, y: 151.2, width: 88, height: 63, rotated: true },
    ],
  );
  const svg = templateSvg(pages[0], settings);
  assert.equal((svg.match(/<rect /g) || []).length, 7);
  assert.match(svg, /width="189\.2mm" height="214\.2mm"/);
});
test('eight-card capture layout keeps four rows of two horizontal cards with 1 mm gutters', () => {
  const settings = { ...DEFAULT_SETTINGS, profile: 'eight' as const, gap: 1, bleed: 0.5 },
    pages = layout([{ ...entry, quantity: 17 }], settings);
  assert.equal(grid(settings).capacity, 8);
  assert.deepEqual(
    pages.map((page) => page.placements.length),
    [8, 8, 1],
  );
  assert.equal(envelope(settings).width, 177);
  assert.equal(envelope(settings).height, 255);
  assert.equal(pages[0].width, 177);
  assert.equal(pages[0].height, 255);
  assert.deepEqual(
    pages[0].placements.map(({ x, y, width, height, rotated }) => ({
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      width,
      height,
      rotated,
    })),
    [0, 1, 2, 3].flatMap((row) => [
      { x: 0, y: row * 64, width: 88, height: 63, rotated: true },
      { x: 89, y: row * 64, width: 88, height: 63, rotated: true },
    ]),
  );
  assert.match(templateSvg(pages[0], settings), /width="177mm" height="255mm"/);
});
test('manual nine-card layout uses a fixed 3-by-3 block on every page', () => {
  const settings = { ...DEFAULT_SETTINGS, profile: 'nine' as const },
    pages = layout([{ ...entry, quantity: 20 }], settings);
  assert.equal(grid(settings).capacity, 9);
  assert.deepEqual(
    pages.map((page) => page.placements.length),
    [9, 9, 2],
  );
  assert.ok(pages.every((page) => page.width === 191 && page.height === 266));
  assert.deepEqual(
    pages[0].placements.map(({ x, y, width, height, rotated }) => ({
      x,
      y,
      width,
      height,
      rotated,
    })),
    [
      { x: 0, y: 0, width: 63, height: 88, rotated: false },
      { x: 64, y: 0, width: 63, height: 88, rotated: false },
      { x: 128, y: 0, width: 63, height: 88, rotated: false },
      { x: 0, y: 89, width: 63, height: 88, rotated: false },
      { x: 64, y: 89, width: 63, height: 88, rotated: false },
      { x: 128, y: 89, width: 63, height: 88, rotated: false },
      { x: 0, y: 178, width: 63, height: 88, rotated: false },
      { x: 64, y: 178, width: 63, height: 88, rotated: false },
      { x: 128, y: 178, width: 63, height: 88, rotated: false },
    ],
  );
  assert.equal(templateSvg(pages[0], settings).match(/<rect /g)?.length, 9);
});
test('hand cutting centers occupied slots and extends guides to paper edges', () => {
  const settings = { ...DEFAULT_SETTINGS, machine: 'manual' as const, profile: 'nine' as const },
    pages = layout([{ ...entry, quantity: 10 }], settings);
  const first = manualCutLineBounds(pages[0], settings)[0],
    last = manualCutLineBounds(pages[0], settings)[8];
  assert.ok(Math.abs(first.left - 12.45) < 1e-9);
  assert.ok(Math.abs(first.top - 6.7) < 1e-9);
  assert.equal(first.width, 63);
  assert.equal(first.height, 88);
  assert.ok(Math.abs(last.left - 140.45) < 1e-9);
  assert.ok(Math.abs(last.top - 184.7) < 1e-9);
  assert.equal(manualCutLineBounds(pages[1], settings).length, 1);
  const guides = manualCutEdgeGuides(pages[0], settings);
  assert.equal(guides.length, 24);
  assert.equal(manualCutEdgeGuides(pages[1], settings).length, 8);
  assert.ok(
    guides.every(
      (guide) =>
        guide.x1 === 0 ||
        Math.abs(guide.x2 - 215.9) < 1e-9 ||
        guide.y1 === 0 ||
        Math.abs(guide.y2 - 279.4) < 1e-9,
    ),
  );
  const a4 = manualCutPlacement({ ...settings, paper: 'a4' });
  assert.equal(a4.left, 9.5);
  assert.equal(a4.top, 15.5);
  const back = manualCutPlacement(settings, true);
  assert.ok(Math.abs(back.left - first.left) < 1e-9);
  assert.ok(Math.abs(back.top - first.top) < 1e-9);
});

test('manual guide choices change the shared sheet geometry', () => {
  const card = [{ left: 20, top: 30, width: 63, height: 88 }],
    paper = { width: 215.9, height: 279.4 },
    base = { ...DEFAULT_SETTINGS, machine: 'manual' as const, profile: 'nine' as const };
  const edges = manualGuidePaths(card, paper, base);
  assert.equal(edges.length, 8);
  assert.deepEqual(edges[0], [
    { x: 20, y: 0 },
    { x: 20, y: 30 },
  ]);
  assert.deepEqual(manualGuidePaths(card, paper, { ...base, manualGuidePageStyle: 'full' })[0], [
    { x: 20, y: 0 },
    { x: 20, y: paper.height },
  ]);
  assert.equal(
    manualGuidePaths(card, paper, {
      ...base,
      manualGuidePageStyle: 'none',
      manualGuideCardStyle: 'corners',
    }).length,
    4,
  );
  const rounded = manualGuidePaths(card, paper, {
    ...base,
    manualGuidePageStyle: 'none',
    manualGuideCardStyle: 'full',
    manualGuideCornerStyle: 'round',
  });
  assert.equal(rounded.length, 1);
  assert.ok(rounded[0].length > 5);
  assert.equal(manualGuidePaths(card, paper, { ...base, manualGuidesEnabled: false }).length, 0);
});
test('manual nine-card print placement matches the first quarter-inch mat inset', () => {
  const settings = { ...DEFAULT_SETTINGS, profile: 'nine' as const },
    placement = manualCutPlacement(settings);
  assert.equal(placement.left, MANUAL_CUT_INSET_MM);
  assert.equal(placement.top, MANUAL_CUT_INSET_MM);
  assert.equal(placement.full.width, 191);
  assert.equal(placement.full.height, 266);
  assert.ok(placement.left + placement.full.width <= placement.paper.width);
  assert.ok(placement.top + placement.full.height <= placement.paper.height);
  const back = manualCutPlacement(
    { ...settings, backFlip: 'long-edge', backOffsetX: 0.5, backOffsetY: -0.25 },
    true,
  );
  assert.equal(back.left, back.paper.width - MANUAL_CUT_INSET_MM - back.full.width + 0.5);
  assert.equal(back.top, MANUAL_CUT_INSET_MM - 0.25);
});
test('manual cut correction moves the physical cut relative to print without changing geometry', () => {
  const settings = {
      ...DEFAULT_SETTINGS,
      profile: 'nine' as const,
      manualCutCorrectionX: 0.5,
      manualCutCorrectionY: 1.75,
    },
    front = manualCutPlacement(settings),
    longEdgeBack = manualCutPlacement({ ...settings, backFlip: 'long-edge' }, true),
    shortEdgeBack = manualCutPlacement({ ...settings, backFlip: 'short-edge' }, true);
  assert.equal(front.left, MANUAL_CUT_INSET_MM - 0.5);
  assert.equal(front.top, MANUAL_CUT_INSET_MM - 1.75);
  assert.equal(longEdgeBack.left, longEdgeBack.paper.width - front.left - front.full.width);
  assert.equal(longEdgeBack.top, front.top);
  assert.equal(shortEdgeBack.left, front.left);
  assert.equal(shortEdgeBack.top, shortEdgeBack.paper.height - front.top - front.full.height);
  assert.equal(front.full.width, 191);
  assert.equal(front.full.height, 266);
});
test('manual cut calibration converts observed error into the opposite physical correction', () => {
  assert.deepEqual(manualCutCorrection(1.5, 'left', 2, 'up'), { x: 1.5, y: 2 });
  assert.deepEqual(manualCutCorrection(0.5, 'right', 1, 'down'), { x: -0.5, y: -1 });
  assert.throws(() => manualCutCorrection(-1, 'left', 0, 'up'));
});
test('manual cut exports identify the exact saved correction', () => {
  const settings = { manualCutCorrectionX: 0.5, manualCutCorrectionY: -1.25 };
  assert.equal(manualCutCorrectionLabel(settings), 'X +0.50 mm, Y -1.25 mm');
  assert.equal(manualCutCorrectionFileTag(settings), 'x-p0_50-y-m1_25');
});
test('manual calibration and production artwork share the exact first-slot trim origin', () => {
  const settings = {
      ...DEFAULT_SETTINGS,
      profile: 'nine' as const,
      manualCutCorrectionX: 0.5,
      manualCutCorrectionY: 1.5,
    },
    placement = manualCutPlacement(settings),
    target = manualCutFirstSlotBounds(settings);
  assert.deepEqual(target, {
    left: placement.left,
    top: placement.top,
    width: settings.width,
    height: settings.height,
  });
});
test('all supported settings place cards inside the planning envelope, without overlaps', () => {
  for (const gap of [1, 3, 10])
    for (const width of [63, 63.5]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        gap,
        width,
        height: width === 63 ? 88 : 88.9,
      };
      const bounds = envelope(settings);
      for (const sheet of layout([{ ...entry, quantity: 17 }], settings)) {
        assert.ok(sheet.width <= bounds.width && sheet.height <= bounds.height);
        for (const p of sheet.placements) {
          assert.ok(
            p.x >= 0 &&
              p.y >= 0 &&
              p.x + p.width <= sheet.width + 1e-8 &&
              p.y + p.height <= sheet.height + 1e-8,
          );
          for (const q of sheet.placements)
            if (p !== q)
              assert.ok(
                p.x + p.width <= q.x ||
                  q.x + q.width <= p.x ||
                  p.y + p.height <= q.y ||
                  q.y + q.height <= p.y,
              );
        }
      }
    }
});
test('PNG quantization stays within half a pixel in physical units', () => {
  for (const dpi of PRINT_DPI_OPTIONS)
    for (const mm of [63, 88, 88.9, 127, 177, 189.2, 191, 214.2])
      assert.ok(Math.abs((mmToPx(mm, dpi) * 25.4) / dpi - mm) <= 25.4 / dpi / 2);
});
test('display units convert labels without changing millimeter geometry', () => {
  assert.equal(formatDimensions(63.5, 88.9, 'in'), '2.5 × 3.5 in');
  assert.equal(formatDimensions(63.5, 88.9, 'mm'), '63.5 × 88.9 mm');
  assert.equal(formatMeasurement(3, 'in'), '0.1181 in');
});
test('bleed amounts are fixed by layout profile', () => {
  assert.equal(fixedBleedMm(DEFAULT_SETTINGS), 0.5);
  assert.equal(fixedBleedMm({ profile: 'seven' }), 0.05);
  assert.equal(fixedBleedMm({ profile: 'eight' }), 0.5);
  assert.equal(frontBleedMm({ profile: 'expanded', bleed: 0 }), 0);
  assert.equal(frontBleedMm({ profile: 'expanded', bleed: 1.25 }), 0.5);
  assert.equal(backBleedMm({ profile: 'expanded', backBleedEnabled: true }), 0.5);
  assert.equal(backBleedMm({ profile: 'expanded', backBleedEnabled: false }), 0);
  assert.equal(backBleedMm({ profile: 'seven', backBleedEnabled: true }), 0.05);
  assert.equal(backOuterBleedMm({ backBleedEnabled: true }), 1.5);
  assert.equal(backOuterBleedMm({ backBleedEnabled: false }), 0);
});
test('sheet areas include only layouts supported by the paper and cutting method', () => {
  for (const machine of ['maker', 'explore'] as const) {
    assert.deepEqual(availableSheetProfiles({ paper: 'letter', machine }), [
      'expanded',
      'seven',
      'eight',
      'nine',
    ]);
    assert.deepEqual(availableSheetProfiles({ paper: 'a4', machine }), [
      'expanded',
      'eight',
      'nine',
    ]);
  }
  for (const paper of ['letter', 'a4'] as const) {
    assert.deepEqual(availableSheetProfiles({ paper, machine: 'joy-xtra' }), ['expanded', 'nine']);
    assert.deepEqual(availableSheetProfiles({ paper, machine: 'manual' }), ['nine']);
  }
});
test('paper workflow uses Tabloid setup for registered Letter and A4 output', () => {
  assert.deepEqual(paperWorkflow({ paper: 'letter', profile: 'expanded' }), {
    outputPaper: 'US Letter',
    designSpacePaper: 'Tabloid (11 × 17 in)',
    systemPaper: 'US Letter',
    usesTabloidSetup: true,
    capturesTabloid: false,
  });
  assert.deepEqual(paperWorkflow({ paper: 'letter', profile: 'seven' }), {
    outputPaper: 'US Letter',
    designSpacePaper: 'Tabloid (11 × 17 in)',
    systemPaper: 'US Letter',
    usesTabloidSetup: true,
    capturesTabloid: false,
  });
  assert.deepEqual(paperWorkflow({ paper: 'letter', profile: 'eight' }), {
    outputPaper: 'US Letter',
    designSpacePaper: 'Tabloid (11 × 17 in)',
    systemPaper: 'Tabloid (11 × 17 in)',
    usesTabloidSetup: true,
    capturesTabloid: true,
  });
  assert.deepEqual(paperWorkflow({ paper: 'letter', profile: 'nine' }), {
    outputPaper: 'US Letter',
    designSpacePaper: 'US Letter',
    systemPaper: 'US Letter',
    usesTabloidSetup: false,
    capturesTabloid: false,
  });
  assert.deepEqual(paperWorkflow({ paper: 'a4', profile: 'expanded' }), {
    outputPaper: 'A4',
    designSpacePaper: 'Tabloid (11 × 17 in)',
    systemPaper: 'A4',
    usesTabloidSetup: true,
    capturesTabloid: false,
  });
  assert.deepEqual(paperWorkflow({ paper: 'a4', profile: 'nine' }), {
    outputPaper: 'A4',
    designSpacePaper: 'A4',
    systemPaper: 'A4',
    usesTabloidSetup: false,
    capturesTabloid: false,
  });
  assert.deepEqual(paperWorkflow({ paper: 'a4', profile: 'eight' }), {
    outputPaper: 'A4',
    designSpacePaper: 'Tabloid (11 × 17 in)',
    systemPaper: 'Tabloid (11 × 17 in)',
    usesTabloidSetup: true,
    capturesTabloid: true,
  });
});
test('eight-card export instructions use the selected output paper after Tabloid capture', () => {
  for (const paper of ['letter', 'a4'] as const) {
    const project = {
      ...EMPTY_PROJECT,
      settings: { ...DEFAULT_SETTINGS, paper, profile: 'eight' as const },
    };
    const guide = instructions(project, [], false);
    const outputPaper = paper === 'letter' ? 'US Letter' : 'A4';
    assert.match(guide, /Tabloid \(11 × 17 in\) in Design Space and the system print dialog/);
    assert.ok(guide.includes(`whole capture onto ${outputPaper} without scaling`));
    assert.ok(guide.includes(`print them on ${outputPaper} at 100% / Actual size`));
  }
});
test('A4 export instructions require Tabloid setup and actual-size A4 printing', () => {
  const project = {
    ...EMPTY_PROJECT,
    settings: { ...DEFAULT_SETTINGS, paper: 'a4' as const },
  };
  for (const calibration of [false, true]) {
    const guide = instructions(project, [], calibration);
    assert.match(guide, /Tabloid \(11 × 17 in\) paper in Design Space/);
    assert.match(
      guide,
      /change the paper to A4, keep portrait orientation, and print at 100% \/ Actual size/,
    );
    assert.match(guide, /Cancel if it becomes two pages or clips a mark/);
  }
});
test('project Save As names are portable across desktop platforms', () => {
  assert.equal(projectFilename('My Commander: Deck / 2026'), 'My-Commander-Deck-2026.criprox.json');
  assert.equal(projectFilename('...'), 'project.criprox.json');
});
test('PNG metadata contains one correctly ordered physical density chunk', () => {
  const source = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfoAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const out = withDpi(withDpi(source, 300), 600);
  const types = [],
    view = new DataView(out.buffer);
  for (let i = 8; i < out.length;) {
    const type = new TextDecoder().decode(out.slice(i + 4, i + 8));
    types.push(type);
    if (type === 'pHYs') {
      assert.equal(view.getUint32(i + 8), Math.round(600 / 0.0254));
      assert.equal(out[i + 16], 1);
    }
    i += view.getUint32(i) + 12;
  }
  assert.deepEqual(types, ['IHDR', 'pHYs', 'IDAT', 'IEND']);
});
test('project import validates geometry, IDs, totals, image schemes and selected face', () => {
  const good = { version: 1, name: 'Example', entries: [entry], settings: DEFAULT_SETTINGS };
  assert.equal(validateProject(good).name, 'Example');
  const {
    units: _oldUnits,
    bleed: _oldBleed,
    backBleedEnabled: _oldBackBleed,
    backsEnabled: _oldBacks,
    backPrintMode: _oldBackMode,
    backFlip: _oldBackFlip,
    backRotation: _oldBackRotation,
    backOffsetX: _oldBackX,
    backOffsetY: _oldBackY,
    manualCutCorrectionX: _oldManualCutX,
    manualCutCorrectionY: _oldManualCutY,
    manualGuidesEnabled: _oldManualGuidesEnabled,
    manualGuideColor: _oldManualGuideColor,
    manualGuidePageColor: _oldManualGuidePageColor,
    manualGuideWidthPx: _oldManualGuideWidth,
    manualGuidePlacement: _oldManualGuidePlacement,
    manualGuideCardStyle: _oldManualGuideCardStyle,
    manualGuideLineStyle: _oldManualGuideLineStyle,
    manualGuideCornerStyle: _oldManualGuideCornerStyle,
    manualGuideLengthMm: _oldManualGuideLength,
    manualGuidePageStyle: _oldManualGuidePageStyle,
    ...oldSettings
  } = DEFAULT_SETTINGS;
  const migrated = validateProject({ ...good, settings: oldSettings });
  assert.equal(migrated.settings.units, 'in');
  assert.equal(migrated.settings.bleed, 0);
  assert.equal(migrated.settings.backBleedEnabled, true);
  assert.equal(migrated.settings.backsEnabled, false);
  assert.equal(migrated.settings.backPrintMode, 'manual');
  assert.equal(migrated.settings.backRotation, 180);
  assert.equal(migrated.settings.manualCutCorrectionX, 0);
  assert.equal(migrated.settings.manualCutCorrectionY, 0);
  assert.equal(migrated.settings.manualGuidePageStyle, 'edge');
  assert.equal(migrated.settings.manualGuideColor, '#222222');
  assert.equal(migrated.settings.manualGuidePageColor, '#555555');
  const previousBrightGuide = validateProject({
    ...good,
    settings: { ...oldSettings, manualGuideColor: '#39ff14' },
  });
  assert.equal(previousBrightGuide.settings.manualGuideColor, '#39ff14');
  assert.equal(previousBrightGuide.settings.manualGuidePageColor, '#555555');
  assert.equal(
    validateProject({ ...good, settings: { ...DEFAULT_SETTINGS, radius: 3 } }).settings.radius,
    2.5,
  );
  const legacyFour = validateProject({
    ...good,
    settings: { ...DEFAULT_SETTINGS, profile: 'conservative' },
  } as unknown);
  assert.equal(legacyFour.settings.profile, 'expanded');
  assert.equal(
    validateProject({ ...good, settings: { ...DEFAULT_SETTINGS, bleed: 1.25 } }).settings.bleed,
    0.5,
  );
  for (const dpi of PRINT_DPI_OPTIONS)
    assert.equal(
      validateProject({ ...good, settings: { ...DEFAULT_SETTINGS, dpi } }).settings.dpi,
      dpi,
    );
  assert.throws(() => validateProject({ ...good, settings: { ...DEFAULT_SETTINGS, dpi: 1500 } }));
  assert.throws(() => validateProject({ ...good, settings: { ...DEFAULT_SETTINGS, gap: -3 } }));
  const seven = {
    ...DEFAULT_SETTINGS,
    profile: 'seven' as const,
    gap: 0.1,
    bleed: 0.05,
  };
  assert.equal(validateProject({ ...good, settings: seven }).settings.profile, 'seven');
  assert.throws(() =>
    validateProject({ ...good, settings: { ...seven, machine: 'joy-xtra' as const } }),
  );
  assert.throws(() => validateProject({ ...good, settings: { ...seven, paper: 'a4' as const } }));
  assert.throws(() => validateProject({ ...good, settings: { ...seven, gap: 1 } }));
  const eight = { ...seven, profile: 'eight' as const, gap: 1, bleed: 0.5 };
  assert.equal(validateProject({ ...good, settings: eight }).settings.profile, 'eight');
  assert.equal(
    validateProject({ ...good, settings: { ...eight, paper: 'a4' as const } }).settings.paper,
    'a4',
  );
  assert.throws(() => validateProject({ ...good, settings: { ...eight, gap: 2 } }));
  assert.equal(
    validateProject({ ...good, settings: { ...eight, gap: 0.1, bleed: 0.05 } }).settings.gap,
    1,
  );
  const nine = { ...DEFAULT_SETTINGS, profile: 'nine' as const };
  assert.equal(validateProject({ ...good, settings: nine }).settings.profile, 'nine');
  assert.equal(
    validateProject({ ...good, settings: { ...nine, machine: 'manual' } }).settings.machine,
    'manual',
  );
  assert.throws(() =>
    validateProject({ ...good, settings: { ...DEFAULT_SETTINGS, machine: 'manual' } }),
  );
  assert.equal(
    validateProject({
      ...good,
      settings: { ...nine, manualCutCorrectionX: 0.5, manualCutCorrectionY: 1.75 },
    }).settings.manualCutCorrectionY,
    1.75,
  );
  assert.throws(() =>
    validateProject({ ...good, settings: { ...nine, manualCutCorrectionX: 5.25 } }),
  );
  assert.throws(() =>
    validateProject({ ...good, settings: { ...nine, manualGuideColor: 'lime' } }),
  );
  assert.throws(() =>
    validateProject({ ...good, settings: { ...nine, manualGuidePageColor: 'lime' } }),
  );
  assert.throws(() => validateProject({ ...good, settings: { ...nine, gap: 0.1 } }));
  assert.throws(() => validateProject({ ...good, settings: { ...nine, width: 63.5 } }));
  assert.throws(() => validateProject({ ...good, entries: [entry, entry] }));
  assert.throws(() => validateProject({ ...good, entries: [{ ...entry, face: 2 }] }));
  assert.throws(() =>
    validateProject({
      ...good,
      entries: [
        {
          ...entry,
          card: {
            ...entry.card,
            faces: [{ name: 'x', image: 'javascript:alert(1)', preview: 'file:///secret' }],
          },
        },
      ],
    }),
  );
  assert.throws(() =>
    validateProject({
      ...good,
      entries: [
        {
          ...entry,
          card: {
            ...entry.card,
            faces: [{ ...entry.card.faces[0], trim: 'unknown-provider' }],
          },
        },
      ],
    } as unknown),
  );
});

test('MPC trim removes source bleed at every DPI and recognizes legacy saved URLs', () => {
  const explicit = {
      name: 'MPC art',
      image: 'data:image/png;base64,AA==',
      preview: 'data:image/png;base64,AA==',
      trim: 'mpc' as const,
    },
    legacy = {
      name: 'Legacy MPC art',
      image:
        'https://cdn.mpcautofill.com/images/google_drive/full/drive-id.jpg?dpi=600&jpgQuality=95',
      preview: 'https://cdn.mpcautofill.com/images/google_drive/large/drive-id.jpg',
    };
  assert.equal(usesMpcTrim(explicit), true);
  assert.equal(usesMpcTrim(legacy), true);
  assert.deepEqual(artworkSourceRect(explicit, 816, 1110), {
    x: 36,
    y: 36,
    width: 744,
    height: 1038,
  });
  assert.deepEqual(artworkSourceRect(explicit, 1632, 2220), {
    x: 72,
    y: 72,
    width: 1488,
    height: 2076,
  });

  const nativeBleed = artworkSourceRect(explicit, 816, 1110, {
    x: 0.5 / 63,
    y: 0.5 / 88,
  });
  assert.ok(nativeBleed.x < 36 && nativeBleed.y < 36);
  assert.ok(nativeBleed.width > 744 && nativeBleed.height > 1038);

  const scryfall = {
    name: 'Scryfall art',
    image: 'https://cards.scryfall.io/large/front/example.jpg',
    preview: 'https://cards.scryfall.io/normal/front/example.jpg',
  };
  assert.deepEqual(artworkSourceRect(scryfall, 672, 936), {
    x: 0,
    y: 0,
    width: 672,
    height: 936,
  });
});

test('custom artwork suggests MPC-style trim by dimensions and keeps the choice reversible', () => {
  assert.equal(looksLikeMpcPrintCanvas(816, 1110), true);
  assert.equal(looksLikeMpcPrintCanvas(1632, 2220), true);
  assert.equal(looksLikeMpcPrintCanvas(822, 1122), true);
  assert.equal(looksLikeMpcPrintCanvas(630, 880), false);
  assert.equal(looksLikeMpcPrintCanvas(750, 1050), false);
  assert.equal(looksLikeMpcPrintCanvas(1110, 816), false);
  assert.equal(looksLikeMpcPrintCanvas(0, 0), false);

  const face = {
    name: 'Uploaded art',
    image: 'data:image/png;base64,AA==',
    preview: 'data:image/png;base64,AA==',
  };
  assert.equal(isEmbeddedArtwork(face), true);
  const enabled = withMpcTrim(face, true);
  assert.equal(enabled.trim, 'mpc');
  assert.equal(usesMpcTrim(enabled), true);
  const disabled = withMpcTrim(enabled, false);
  assert.equal(disabled.trim, undefined);
  assert.equal(usesMpcTrim(disabled), false);
  assert.equal(face.image, disabled.image);
});

test('cover artwork fills card and bleed bounds without exposing backing bars', () => {
  const card = fitArtwork(816, 1110, 63, 88, 'cover');
  assert.ok(card.width >= 63 && card.height >= 88);
  assert.equal(card.height, 88);
  assert.ok(card.x < 0);

  const bleed = fitArtwork(816, 1110, 66, 91, 'cover');
  assert.ok(bleed.width >= 66 && bleed.height >= 91);
  assert.equal(bleed.height, 91);
  assert.ok(bleed.x < 0);

  const contained = fitArtwork(816, 1110, 63, 88, 'contain');
  assert.ok(contained.height < 88);
  assert.equal(contained.width, 63);
});

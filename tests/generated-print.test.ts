import { TAPERED_SETTINGS } from './fixtures/tapered-settings';
import './fixtures/test-font';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createCanvas, loadImage, Path2D, type Canvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import {
  drawRegistrationMarks,
  generateMarkedPrint,
  generatedPrintBundle,
} from '../src/lib/generated-print';
import {
  registrationGeometry,
  registrationOrigin,
  registrationConflicts,
  shapePolygon,
} from '../src/lib/generated-registration';
import { DEFAULT_SETTINGS, type Project } from '../src/lib/types';
import { newStickerProject, stickerSheets, appendSticker, editSticker } from '../src/lib/stickers';
import { fullTemplate, PT_PER_MM } from '../src/lib/registration';
import { sheetPreviewFrame } from '../src/lib/sheet-preview';
import { machineGuide } from '../src/lib/machine-guides';
import { newDesign, newElement } from '../src/lib/sticker-design';
import { stickerLocalCuts } from '../src/lib/sticker-cuts';
import { BUILTIN_MATERIALS, selectMaterial } from '../src/lib/cut-settings';
const { prepareSheetJob } = createRequire(import.meta.url)('../electron/cutter/sheet-job.cjs');
Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: Path2D });

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    createElement: () => {
      const canvas = createCanvas(1, 1);
      return Object.assign(canvas, {
        toBlob: (callback: (b: Blob) => void) =>
          callback(
            new Blob([Uint8Array.from(canvas.toBuffer('image/png')).buffer], { type: 'image/png' }),
          ),
      });
    },
  },
});
Object.defineProperty(globalThis, 'createImageBitmap', {
  configurable: true,
  value: async (blob: Blob) =>
    Object.assign(await loadImage(Buffer.from(await blob.arrayBuffer())), { close() {} }),
});
const art = createCanvas(40, 40);
art.getContext('2d').fillStyle = '#f00';
art.getContext('2d').fillRect(0, 0, 40, 40);
const image = art.toDataURL('image/png');
function cards(): Project {
  return {
    version: 1,
    name: 'Generated cards',
    settings: { ...DEFAULT_SETTINGS, machine: 'explore-5' },
    entries: [
      {
        id: 'entry',
        quantity: 1,
        face: 0,
        card: {
          id: 'card',
          name: 'Red card',
          set: 'local',
          setName: 'Local',
          collector: '',
          faces: [{ name: 'Front', image, preview: image }],
        },
      },
    ],
  };
}
async function render(pdf: Uint8Array, page = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'),
    task = pdfjs.getDocument({ data: pdf.slice() });
  try {
    const doc = await task.promise,
      p = await doc.getPage(page),
      viewport = p.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await p.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas;
  } finally {
    await task.destroy();
  }
}
function pixel(canvas: Canvas, x: number, y: number) {
  return Array.from(
    canvas
      .getContext('2d')
      .getImageData(Math.round(x * PT_PER_MM * 2), Math.round(y * PT_PER_MM * 2), 1, 1).data,
  );
}
function assertMarks(canvas: Canvas, paper: 'letter' | 'a4') {
  const { page } = registrationGeometry('explore-5', paper);
  for (const [x, y] of [
    [20, 13.3],
    [13.3, 20],
    [page.width - 20, 13.3],
    [page.width - 13.3, 20],
    [20, page.height - 13.3],
    [13.3, page.height - 20],
    [page.width - 20, page.height - 13.3],
    [page.width - 13.3, page.height - 20],
    [13.45, 13.7],
  ])
    assert.deepEqual(pixel(canvas, x, y), [0, 0, 0, 255], `${x}, ${y} must be black`);
  assert.deepEqual(pixel(canvas, 15, 13.3), [255, 255, 255, 255], 'arrow gap must stay white');
  // Sample every millimeter along all four outer margins, including the old
  // 3.85 mm dense-layout location. Marks must not creep toward the paper edge.
  for (let inset = 1; inset <= 12; inset++) {
    for (let x = 1; x < page.width - 1; x++)
      for (const y of [inset, page.height - inset])
        assert.deepEqual(pixel(canvas, x, y), [255, 255, 255, 255], `margin ${x}, ${y}`);
    for (let y = 1; y < page.height - 1; y++)
      for (const x of [inset, page.width - inset])
        assert.deepEqual(pixel(canvas, x, y), [255, 255, 255, 255], `margin ${x}, ${y}`);
  }
}
test('every supported optical machine prints four measured L marks and the arrow on both paper sizes', async () => {
  for (const machine of ['explore-5', 'explore', 'maker', 'joy-xtra'] as const)
    for (const paper of ['letter', 'a4'] as const) {
      const g = registrationGeometry(machine, paper),
        doc = await PDFDocument.create();
      assert.equal(g.frame.x, 12.7);
      assert.equal(g.marks.length, 9);
      assert.equal(g.keepOuts.length, 8);
      const page = doc.addPage([g.page.width * PT_PER_MM, g.page.height * PT_PER_MM]);
      drawRegistrationMarks(page, g);
      assertMarks(await render(await doc.save()), paper);
    }
  assert.equal(registrationGeometry('manual', 'letter').marks.length, 0);
});
test('the 54-label sheet prints generated marks without a capture and saves matching physical contours', async () => {
  const p = {
    ...newStickerProject(),
    settings: {
      ...TAPERED_SETTINGS,
      dpi: 300 as const,
      cutPressure: 'hard' as const,
      cutPasses: 3,
    },
    artwork: [{ id: 'a', name: 'Label', image }],
    items: Array(54).fill('a'),
  };
  const result = await generateMarkedPrint({ kind: 'stickers', project: p }),
    job = JSON.parse(result.job),
    s = stickerSheets(p)[0],
    origin = registrationOrigin(p.settings.paper, {
      width: p.settings.areaWidth,
      height: p.settings.areaHeight,
    });
  assert.equal(job.sheets[0].contours.length, 54);
  const native = prepareSheetJob(result.job, 0);
  assert.equal(native.contourCount, 54);
  assert.equal(native.resolved.pressureGrams, 84);
  assert.equal(native.resolved.passes, 3);
  assert.equal(job.hardwareValidated, false);
  assert.deepEqual(job.cutSettings, {
    material: 'white-sticker-paper',
    pressurePreset: 'hard',
    passes: 3,
    pressureGrams: 84,
    blade: 'fine-point',
  });
  for (const [i, contour] of job.sheets[0].contours.entries()) {
    assert.equal(contour.width, 42.5);
    assert.equal(contour.height, 14.5);
    assert.equal(contour.x, origin.x + s.placements[i].x);
    assert.equal(contour.y, origin.y + s.placements[i].y);
  }
  const canvas = await render(result.pdf);
  assertMarks(canvas, 'letter');
  const first = job.sheets[0].contours[0];
  assert.deepEqual(pixel(canvas, first.x + 21, first.y + 7), [255, 0, 0, 255]);
  const zip = await JSZip.loadAsync(await generatedPrintBundle(result));
  assert.ok(zip.file('matching-cut-job.skarix.json'));
  assert.match(await zip.file('READ-ME.txt')!.async('string'), /Hard pressure · 3 passes/);
  if (process.env.SKARIX_RENDER_QA) {
    writeFileSync('tmp/generated-54-labels.pdf', result.pdf);
    writeFileSync('tmp/generated-54-labels.png', canvas.toBuffer('image/png'));
  }
});
test('free sticker rotations retain physical cut dimensions and page positions', async () => {
  let p = newStickerProject();
  p.artwork = [{ id: 'a', name: 'Label', image }];
  p = appendSticker(p, 'a', { width: 30, height: 12 });
  p = editSticker(p, 0, { x: 60, y: 60, rotation: 35, flipX: true, flipY: true, radius: 2 });
  const result = await generateMarkedPrint({ kind: 'stickers', project: p }),
    contour = JSON.parse(result.job).sheets[0].contours[0];
  assert.equal(contour.rotation, 35);
  assert.equal(contour.width, 30);
  assert.equal(contour.height, 12);
  const polygon = shapePolygon(contour),
    center = {
      x: (Math.min(...polygon.map((p) => p.x)) + Math.max(...polygon.map((p) => p.x))) / 2,
      y: (Math.min(...polygon.map((p) => p.y)) + Math.max(...polygon.map((p) => p.y))) / 2,
    };
  assert.deepEqual(pixel(await render(result.pdf), center.x, center.y), [255, 0, 0, 255]);
});
test('generated files and native jobs keep a custom material pressure sequence', async () => {
  const p = cards();
  const profile = {
    ...BUILTIN_MATERIALS[0],
    id: 'custom:laminated',
    source: 'custom' as const,
    name: 'Laminated labels',
    pressure: 250,
    passes: 2,
    pressures: [250, 150],
  };
  Object.assign(p.settings, selectMaterial(profile));
  const result = await generateMarkedPrint({ kind: 'cards', project: p });
  assert.deepEqual(JSON.parse(result.job).cutSettings.profile, profile);
  assert.deepEqual(prepareSheetJob(result.job, 0).resolved.passPressures, [250, 150]);
  const zip = await JSZip.loadAsync(await generatedPrintBundle(result));
  assert.match(await zip.file('READ-ME.txt')!.async('string'), /250 \/ 150 g/);
});

test('multi-sheet cards include marks on every front and use the canvas origin', async () => {
  const p = cards();
  p.entries[0].quantity = 7;
  p.settings.cutPressure = 'light';
  p.settings.cutPasses = 2;
  const result = await generateMarkedPrint({ kind: 'cards', project: p }),
    doc = await PDFDocument.load(result.pdf),
    job = JSON.parse(result.job),
    frame = sheetPreviewFrame(p.settings);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual(job.cutSettings, {
    material: 'white-sticker-paper',
    pressurePreset: 'light',
    passes: 2,
    pressureGrams: 76,
    blade: 'fine-point',
  });
  assert.equal(doc.catalog.getOrCreateViewerPreferences().getPrintScaling(), 'None');
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(job.sheets[i].artworkOriginMm, { x: frame.left, y: frame.top });
    assertMarks(await render(result.pdf, i + 1), 'letter');
  }
  assert.equal(job.sheets[1].contours.length, 1, 'partial pages cut only occupied items');
  assert.equal(prepareSheetJob(result.job, 1).contourCount, 1);
});
test('backs preserve manual refeed and duplex order without redundant sensor marks', async () => {
  const p = cards();
  p.settings.backsEnabled = true;
  p.backArtwork = { name: 'Back', image, preview: image };
  const manual = await generateMarkedPrint({ kind: 'cards', project: p });
  assert.equal(manual.mode, 'manual');
  assert.ok(manual.backPdf);
  assert.deepEqual(pixel(await render(manual.backPdf!), 20, 13.3), [255, 255, 255, 255]);
  const zip = await JSZip.loadAsync(await generatedPrintBundle(manual));
  assert.ok(zip.file('card-backs.pdf'));
  p.settings.backPrintMode = 'duplex';
  const duplex = await generateMarkedPrint({ kind: 'cards', project: p });
  assert.equal(duplex.mode, 'duplex');
  assert.equal((await PDFDocument.load(duplex.pdf)).getPageCount(), 2);
  assertMarks(await render(duplex.pdf, 1), 'letter');
  assert.deepEqual(pixel(await render(duplex.pdf, 2), 20, 13.3), [255, 255, 255, 255]);
});
test('mark collisions and off-page artwork block export, clearance violations warn, and manual layouts use their own output', async () => {
  const g = registrationGeometry('explore-5', 'letter'),
    shape = { x: 12, y: 12, width: 10, height: 10, rotation: 0, radius: 0, itemId: 'a' };
  assert.deepEqual(registrationConflicts([shape], g).blocked, ['a']);
  assert.deepEqual(registrationConflicts([{ ...shape, x: -1, y: 80 }], g).blocked, ['a']);
  assert.deepEqual(
    registrationConflicts([{ ...shape, x: 16, y: 16, width: 2, height: 2 }], g).clearance,
    ['a'],
  );
  const p = cards();
  p.settings.width = 215;
  p.settings.height = 270;
  await assert.rejects(
    generateMarkedPrint({ kind: 'cards', project: p }),
    /overlap registration marks|leave the page|fit|large/,
  );
  p.settings = { ...DEFAULT_SETTINGS, profile: 'nine' };
  await assert.rejects(generateMarkedPrint({ kind: 'cards', project: p }), /manual/);
});
test('card profiles preserve artwork sizes and report dense Letter collisions at the fixed inset', () => {
  for (const profile of ['expanded', 'seven', 'eight'] as const) {
    const settings = { ...DEFAULT_SETTINGS, profile, gap: profile === 'seven' ? 0.1 : 1 },
      full = fullTemplate(settings),
      origin = registrationOrigin(settings.paper, full),
      frame = sheetPreviewFrame(settings);
    assert.deepEqual(origin, { x: frame.left, y: frame.top });
    const shapes = full.placements.map((p, i) => ({
      x: origin.x + p.x,
      y: origin.y + p.y,
      width: p.width,
      height: p.height,
      rotation: 0,
      radius: settings.radius,
      itemId: String(i),
    }));
    assert.equal(
      registrationConflicts(
        shapes,
        registrationGeometry(settings.machine, settings.paper),
        profile === 'seven' ? 0.05 : 0.5,
      ).blocked.length,
      profile === 'eight' ? 4 : 0,
      profile,
    );
  }
});

test('eight-card Letter export rejects overlapping marks instead of moving them into paper margins', async () => {
  const p = cards();
  p.settings.profile = 'eight';
  p.entries[0].quantity = 8;
  await assert.rejects(
    generateMarkedPrint({ kind: 'cards', project: p }),
    /overlap registration marks.*12.7 mm/,
  );
  // A4 has the extra height required by the same eight cards, at actual size.
  p.settings.paper = 'a4';
  const result = await generateMarkedPrint({ kind: 'cards', project: p });
  const job = JSON.parse(result.job),
    registration = job.sheets[0].registration;
  assert.equal(job.sheets[0].contours.length, 8);
  assert.equal(registration.frame.x, 12.7);
  assert.equal(registration.frame.y, 12.7);
  assert.deepEqual(registration.marks, machineGuide(p.settings.machine, 'a4').marks);
  assertMarks(await render(result.pdf), 'a4');
});

test('enlarging sticker layout limits does not move preview or PDF registration marks outward', async () => {
  for (const paper of ['letter', 'a4'] as const) {
    let p = newStickerProject();
    p.settings = { ...p.settings, paper, areaWidth: 205, areaHeight: 275 };
    p.artwork = [{ id: 'a', name: 'Label', image }];
    p = appendSticker(p, 'a', { width: 30, height: 12 });
    p = editSticker(p, 0, { x: 70, y: 70 });
    const result = await generateMarkedPrint({ kind: 'stickers', project: p });
    const registration = JSON.parse(result.job).sheets[0].registration;
    assert.equal(registration.placement, 'skarix-page-frame-v2');
    assert.equal(registration.frame.x, 12.7);
    assert.equal(registration.frame.y, 12.7);
    assert.deepEqual(registration.marks, machineGuide(p.machine, paper).marks);
    assertMarks(await render(result.pdf), paper);
  }
});

test('custom cut outlines follow rotated and mirrored artwork through PDF preparation into the native job', async () => {
  const design = newDesign(40, 40);
  design.elements = [
    {
      ...newElement('shape', design),
      operation: 'cut',
      shape: 'triangle',
      x: 4,
      y: 6,
      width: 30,
      height: 28,
    },
    {
      ...newElement('draw', design),
      operation: 'cut',
      x: 8,
      y: 20,
      width: 20,
      height: 0.1,
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
  ];
  let project = newStickerProject();
  project.artwork = [{ id: 'custom', name: 'Custom cuts', image, design }];
  project = appendSticker(project, 'custom', { width: 40, height: 40 });
  project = editSticker(project, 0, { x: 60, y: 70, rotation: 90, flipX: true });
  const result = await generateMarkedPrint({ kind: 'stickers', project }),
    job = JSON.parse(result.job);
  assert.equal(job.version, 2);
  assert.equal(job.contourShape, 'paths');
  assert.equal(job.sheets[0].contours.length, 2);
  const placement = stickerSheets(project)[0].placements[0],
    pose = placement.sticker;
  const local = stickerLocalCuts(design, pose, 'contain')[0].points[0],
    origin = job.sheets[0].artworkOriginMm;
  const first = job.sheets[0].contours[0].points[0];
  assert.ok(
    Math.abs(
      first.x - (origin.x + placement.x + placement.width / 2 - (local.y - pose.height / 2)),
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(
      first.y - (origin.y + placement.y + placement.height / 2 + (local.x - pose.width / 2)),
    ) < 1e-6,
  );
  const prepared = prepareSheetJob(result.job, 0);
  assert.equal(prepared.contourCount, 2);
  assert.ok(prepared.paths[0].endsWith(' Z'));
  assert.ok(!prepared.paths[1].endsWith(' Z'));
  assertMarks(await render(result.pdf), 'letter');
});

test('nested cropped circles print without rectangular white corners erasing their neighbors', async () => {
  const design = { ...newDesign(50, 50), cropToCuts: true };
  design.elements = [
    {
      ...newElement('shape', design),
      operation: 'cut',
      shape: 'ellipse',
      x: 10,
      y: 10,
      width: 30,
      height: 30,
    },
  ];
  let project = newStickerProject();
  project.artwork = [{ id: 'round', name: 'Round', image, design }];
  project = appendSticker(project, 'round');
  project = appendSticker(project, 'round');
  project = editSticker(project, 0, { x: 40, y: 40 });
  project = editSticker(project, 1, { x: 56, y: 40 + Math.sqrt(32 * 32 - 16 * 16) });
  const result = await generateMarkedPrint({ kind: 'stickers', project });
  const job = JSON.parse(result.job),
    origin = job.sheets[0].artworkOriginMm;
  assert.equal(prepareSheetJob(result.job, 0).contourCount, 2);
  const canvas = await render(result.pdf);
  // Inside the first circle but inside the second circle's empty rectangular corner.
  assert.deepEqual(pixel(canvas, origin.x + 56.5, origin.y + 68.5).slice(0, 3), [255, 0, 0]);
  assert.deepEqual(pixel(canvas, origin.x + 40.5, origin.y + 40.5).slice(0, 3), [255, 255, 255]);
  const first = job.sheets[0].contours[0].points[0];
  assert.ok(Math.abs(first.x - (origin.x + 70)) < 1e-6);
  assert.ok(Math.abs(first.y - (origin.y + 55)) < 1e-6);
  assertMarks(canvas, 'letter');
});

test('legacy crop-to-fill retains both ends of a wide label and prints its optional border', async () => {
  const label = createCanvas(425, 145),
    context = label.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 425, 145);
  context.fillStyle = '#f00';
  context.fillRect(2, 20, 12, 100);
  context.fillStyle = '#0f0';
  context.fillRect(410, 20, 12, 100);
  context.fillStyle = '#000';
  context.font = '32px Arial';
  context.fillText('Keep all text', 25, 80);
  let project = newStickerProject();
  project.settings = {
    ...project.settings,
    fit: 'cover',
    borderWidth: 1,
    borderStrokeWidth: 0.4,
    borderStrokeColor: '#0000ff',
  };
  project.artwork = [{ id: 'wide', name: 'Wide label', image: label.toDataURL('image/png') }];
  project = appendSticker(project, 'wide', { width: 24, height: 14.5 });
  project = editSticker(project, 0, { x: 50, y: 50, radius: 1 });
  const result = await generateMarkedPrint({ kind: 'stickers', project });
  const job = JSON.parse(result.job),
    origin = job.sheets[0].artworkOriginMm;
  const canvas = await render(result.pdf),
    scale = PT_PER_MM * 2;
  const pixels = canvas
    .getContext('2d')
    .getImageData(
      Math.round((origin.x + 50) * scale),
      Math.round((origin.y + 50) * scale),
      Math.floor(24 * scale),
      Math.floor(14.5 * scale),
    ).data;
  let red = 0,
    green = 0,
    blue = 0,
    black = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 200 && pixels[i + 1] < 50 && pixels[i + 2] < 50) red++;
    if (pixels[i + 1] > 200 && pixels[i] < 50 && pixels[i + 2] < 50) green++;
    if (pixels[i + 2] > 200 && pixels[i] < 50 && pixels[i + 1] < 50) blue++;
    if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) black++;
  }
  assert.ok(red > 20 && green > 20, 'both image edges survive');
  assert.ok(
    black > 20,
    `label text survives (red ${red}, green ${green}, blue ${blue}, black ${black})`,
  );
  assert.ok(blue > 100, 'stroke is included in the actual PDF');
  assert.equal(prepareSheetJob(result.job, 0).contourCount, 1);
  assertMarks(canvas, 'letter');
});

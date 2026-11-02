import { PDFDocument, PrintScaling, rgb, type PDFPage } from 'pdf-lib';
import JSZip from 'jszip';
import { readCutSettings, cutSettingsSummary, cutPressureGrams } from './cut-settings';
import { frontBleedMm, type Project } from './types';
import { fixedSheets, fullTemplate, PT_PER_MM } from './registration';
import { renderSheet } from './export';
import { buildBackPdfAtFrame, combineDuplexPdfs } from './registered-pdf';
import { renderStickerSheet } from './sticker-output';
import { stickerSheets, type StickerProject, type StickerPose } from './stickers';
import { hasCustomCuts, stickerLocalCuts } from './sticker-cuts';
import {
  polygonPath,
  shapePolygon,
  registrationConflicts,
  registrationGeometry,
  registrationOrigin,
  type CutShape,
} from './generated-registration';

export function drawRegistrationMarks(
  page: PDFPage,
  geometry: ReturnType<typeof registrationGeometry>,
) {
  for (const polygon of geometry.marks)
    page.drawSvgPath(polygonPath(polygon), {
      x: 0,
      y: page.getHeight(),
      scale: PT_PER_MM,
      color: rgb(0, 0, 0),
    });
}
export type GeneratedPrintResult = {
  pdf: Uint8Array;
  backPdf?: Uint8Array;
  mode: 'front' | 'manual' | 'duplex';
  job: string;
  warnings: string[];
};
export async function generateMarkedPrint(
  input: { kind: 'cards'; project: Project } | { kind: 'stickers'; project: StickerProject },
  progress: (message: string) => void = () => {},
): Promise<GeneratedPrintResult> {
  const project = input.project,
    settings = project.settings,
    machine = input.kind === 'stickers' ? input.project.machine : input.project.settings.machine;
  const cutSettings = readCutSettings(settings);
  if (machine === 'manual' || (input.kind === 'cards' && input.project.settings.profile === 'nine'))
    throw Error(
      'This manual / Basic Cut layout does not use registration marks. Use its manual print workflow.',
    );
  const doc = await PDFDocument.create();
  const sheets =
    input.kind === 'stickers'
      ? stickerSheets(input.project)
      : fixedSheets(input.project.entries, input.project.settings);
  if (!sheets.length || sheets.length > 24) throw Error('Prepare between 1 and 24 sheets.');
  const area =
    input.kind === 'stickers'
      ? { width: input.project.settings.areaWidth, height: input.project.settings.areaHeight }
      : fullTemplate(input.project.settings);
  const geometry = registrationGeometry(machine, settings.paper);
  const origin = registrationOrigin(settings.paper, area),
    jobs: unknown[] = [],
    warnings: string[] = [];
  const cardSettings = input.kind === 'cards' ? input.project.settings : undefined;
  const customCuts =
    input.kind === 'stickers' && input.project.artwork.some((a) => hasCustomCuts(a.design));
  let upscaylCacheKey = '';
  if (cardSettings?.upscaleScryfall && cardSettings.upscaleBackend === 'upscayl') {
    upscaylCacheKey = (await globalThis.window?.criprox?.upscayl?.detect())?.cacheKey || '';
    if (!upscaylCacheKey)
      throw Error('Upscayl is not detected. Choose Built-in ESRGAN or turn off upscaling.');
  }
  const upscale = {
    enabled: cardSettings?.upscaleScryfall ?? false,
    backend: cardSettings?.upscaleBackend,
    upscaylCacheKey,
    progress,
  };
  for (const [index, sheet] of sheets.entries()) {
    const shapes: CutShape[] = sheet.placements.map((p, i) => {
      const sticker = 'sticker' in p ? (p.sticker as StickerPose) : undefined;
      return {
        itemId: `sheet-${index + 1}-item-${i + 1}`,
        x: origin.x + p.x,
        y: origin.y + p.y,
        width: sticker ? sticker.width : p.width,
        height: sticker ? sticker.height : p.height,
        rotation: sticker ? sticker.rotation : 0,
        radius: sticker
          ? input.kind === 'stickers' &&
            hasCustomCuts(input.project.artwork.find((a) => a.id === p.entry.card.id)?.design)
            ? 0
            : sticker.radius
          : settings.radius,
      };
    });
    const bleed = input.kind === 'cards' ? frontBleedMm(input.project.settings) : 0;
    const conflicts = registrationConflicts(shapes, geometry, bleed);
    if (conflicts.blocked.length)
      throw Error(
        `Sheet ${index + 1}: ${conflicts.blocked.length} item(s) overlap registration marks or leave the page. Marks stay 12.7 mm (0.5 in) inside the paper edge. Move or resize the items, or choose another layout/paper size.`,
      );
    if (conflicts.clearance.length)
      warnings.push(
        `Sheet ${index + 1}: ${conflicts.clearance.length} item(s) enter the recommended sensor clearance. Review before testing.`,
      );
    progress(`Generating marked sheet ${index + 1} of ${sheets.length}…`);
    const page = doc.addPage([geometry.page.width * PT_PER_MM, geometry.page.height * PT_PER_MM]);
    const printable = {
      ...sheet,
      width: sheet.width + bleed * 2,
      height: sheet.height + bleed * 2,
      placements: sheet.placements.map((p) => ({ ...p, x: p.x + bleed, y: p.y + bleed })),
    };
    const image =
      input.kind === 'stickers'
        ? await renderStickerSheet(sheet as ReturnType<typeof stickerSheets>[number], input.project)
        : await renderSheet(printable, input.project.settings, false, bleed, bleed, upscale);
    const embedded = await doc.embedPng(image);
    page.drawImage(embedded, {
      x: (origin.x - bleed) * PT_PER_MM,
      y: (geometry.page.height - origin.y - sheet.height - bleed) * PT_PER_MM,
      width: printable.width * PT_PER_MM,
      height: printable.height * PT_PER_MM,
    });
    drawRegistrationMarks(page, geometry);
    jobs.push({
      sheet: index + 1,
      frontPdfPage:
        cardSettings?.backsEnabled && cardSettings.backPrintMode === 'duplex'
          ? index * 2 + 1
          : index + 1,
      artworkOriginMm: origin,
      registration: geometry,
      contours:
        customCuts && input.kind === 'stickers'
          ? sheet.placements.flatMap((p, i) => {
              const design = input.project.artwork.find((a) => a.id === p.entry.card.id)?.design;
              if (!design || !hasCustomCuts(design))
                return [{ points: shapePolygon(shapes[i]), closed: true }];
              const pose = (p as ReturnType<typeof stickerSheets>[number]['placements'][number])
                .sticker;
              const a = (pose.rotation * Math.PI) / 180,
                c = Math.cos(a),
                s = Math.sin(a);
              return stickerLocalCuts(design, pose, input.project.settings.fit).map((path) => ({
                ...path,
                points: path.points.map((point) => {
                  const x = point.x - pose.width / 2,
                    y = point.y - pose.height / 2;
                  return {
                    x: origin.x + p.x + p.width / 2 + x * c - y * s,
                    y: origin.y + p.y + p.height / 2 + x * s + y * c,
                  };
                }),
              }));
            })
          : shapes,
    });
  }
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  doc.setTitle(`${project.name} — generated registration marks`);
  doc.setSubject(
    'Skarix-generated marks and matching cut coordinates. Check alignment for your machine and material. Not a Design Space saved job.',
  );
  const job = JSON.stringify(
    {
      kind: 'criprox-cut-job',
      version: customCuts ? 2 : 1,
      name: project.name,
      machine,
      paper: settings.paper,
      units: 'mm',
      origin: 'page-top-left',
      contourPosition: customCuts ? 'page-points' : 'rotated-bounds-top-left',
      contourShape: customCuts ? 'paths' : 'rounded-rectangle',
      rotationDirection: 'clockwise',
      registrationMode: 'generated',
      hardwareValidated: false,
      cutSettings: {
        material: cutSettings.cutMaterial,
        pressurePreset: cutSettings.cutPressure,
        passes: cutSettings.cutPasses,
        ...(cutSettings.cutProfile ? { profile: cutSettings.cutProfile } : {}),
        ...(machine === 'explore-5'
          ? {
              pressureGrams: cutPressureGrams(cutSettings),
              blade:
                cutSettings.cutProfile && cutSettings.cutProfile.blade !== 'dragKnife'
                  ? cutSettings.cutProfile.blade
                  : 'fine-point',
            }
          : {}),
      },
      backPrint: cardSettings?.backsEnabled
        ? { mode: cardSettings.backPrintMode, flip: cardSettings.backFlip }
        : null,
      sheets: jobs,
    },
    null,
    2,
  );
  if (customCuts) {
    const parsed = JSON.parse(job);
    if (
      job.length > 8_000_000 ||
      parsed.sheets.some(
        (s: { contours: { points: unknown[] }[] }) =>
          s.contours.length > 2000 ||
          s.contours.reduce((sum, c) => sum + c.points.length, 0) > 200000,
      )
    )
      throw Error('This custom cut job is too complex. Use fewer stickers or simpler paths.');
  }
  let pdf = await doc.save();
  if (input.kind === 'cards' && input.project.settings.backsEnabled) {
    const backPdf = await buildBackPdfAtFrame(
      input.project,
      {
        pageWidthPt: geometry.page.width * PT_PER_MM,
        pageHeightPt: geometry.page.height * PT_PER_MM,
        masterXPt: 0,
        masterYPt: 0,
        leftMm: origin.x,
        topMm: origin.y,
        marginMm: geometry.frame.x,
      },
      progress,
      false,
      upscale.enabled,
      upscale.backend,
      upscaylCacheKey,
    );
    if (input.project.settings.backPrintMode === 'duplex') {
      pdf = await combineDuplexPdfs(input.project, pdf, backPdf);
      return { pdf, mode: 'duplex', job, warnings };
    }
    return { pdf, backPdf, mode: 'manual', job, warnings };
  }
  return { pdf, mode: 'front', job, warnings };
}
export async function generatedPrintBundle(result: GeneratedPrintResult) {
  const zip = new JSZip();
  const job = JSON.parse(result.job);
  const cut = readCutSettings({
    cutMaterial: job.cutSettings?.material,
    cutPressure: job.cutSettings?.pressurePreset,
    cutPasses: job.cutSettings?.passes,
    cutProfile: job.cutSettings?.profile,
  });
  zip.file('print-with-registration-marks.pdf', result.pdf);
  zip.file('matching-cut-job.criprox.json', result.job);
  if (result.backPdf) zip.file('card-backs.pdf', result.backPdf);
  zip.file(
    'READ-ME.txt',
    'Print the PDF at 100% / Actual size. It includes all generated black registration marks and the top-left directional arrow. Keep the matching cut-job file: it records the same page coordinates and cut contours.\n\nThese are Skarix-generated sheets. Do not cut them using an unrelated Design Space mat: its mark placement may differ. The Windows Explore 5 controller can scan and cut the matching prepared sheet from Print then cut. Reopen the project and prepare it again to cut; this exported JSON is a reference, not an executable Cricut file. An Explore 5 USB sticker sheet has been physically validated at 80 g, one pass; check alignment for other settings.\n\n' +
      `Requested cut settings: ${cutSettingsSummary(cut)}. Explore 5 applies these settings to every contour in the selected sheet.\n\n` +
      result.warnings.join('\n'),
  );
  const binding = job.backPrint?.flip;
  zip.file(
    'PRINT-ORDER.txt',
    result.mode === 'duplex'
      ? `Print the PDF duplex with ${binding} binding. Odd pages are registered fronts; even pages are backs without sensor marks.`
      : result.mode === 'manual'
        ? 'Print the registered fronts first. Refeed the same sheets for card-backs.pdf using your calibrated paper handling. Only fronts need sensor marks.'
        : 'Print the marked front pages at Actual size.',
  );
  return zip.generateAsync({ type: 'uint8array' });
}

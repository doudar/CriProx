import JSZip from 'jszip';
import { get, set } from 'idb-keyval';
import type { CardFace, Settings, Project } from './types';
import { mmToPx, templateSvg, type Sheet } from './layout';
import { withDpi } from './png';
import { exportFilename } from './filenames';
import { drawBleedTile, repairTransparentCorners, replicateBorder } from './bleed';
import { formatDimensions, formatMeasurement } from './units';
import { paperWorkflow } from './paper-workflow';
import { artworkSourceRect, usesMpcTrim, type SourceRect } from './artwork';
import { upscaleArtwork, type UpscaleBackend } from './upscale';

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function renderCanvas(width: number, height: number): RenderCanvas {
  const canvas =
    typeof document === 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function pngBlob(canvas: RenderCanvas) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
      'image/png',
    ),
  );
}

export function fitArtwork(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: 'contain' | 'cover',
) {
  const scale =
    mode === 'cover'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale,
    height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function drawFinishedArtwork(
  ctx: RenderContext,
  bitmap: ImageBitmap,
  face: CardFace,
  width: number,
  height: number,
  physicalHeight: number,
  proxyLabel: boolean,
) {
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, width, height);
  drawSourceArtwork(
    ctx,
    bitmap,
    artworkSourceRect(face, bitmap.width, bitmap.height),
    width,
    height,
  );
  if (proxyLabel) drawProxyLabel(ctx, width, height, physicalHeight);
}

function drawBleedCardArtwork(
  ctx: RenderContext,
  bitmap: ImageBitmap,
  face: CardFace,
  width: number,
  height: number,
  physicalHeight: number,
  proxyLabel: boolean,
) {
  drawSourceArtwork(
    ctx,
    bitmap,
    artworkSourceRect(face, bitmap.width, bitmap.height),
    width,
    height,
  );

  const image = ctx.getImageData(0, 0, width, height);
  repairTransparentCorners(image.data, width, height);
  ctx.putImageData(image, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  if (proxyLabel) drawProxyLabel(ctx, width, height, physicalHeight);
}

function drawSourceArtwork(
  ctx: RenderContext,
  bitmap: ImageBitmap,
  source: SourceRect,
  width: number,
  height: number,
) {
  const fit = fitArtwork(source.width, source.height, width, height, 'cover');
  ctx.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    fit.x,
    fit.y,
    fit.width,
    fit.height,
  );
}

function drawProxyLabel(
  ctx: RenderContext,
  width: number,
  height: number,
  physicalHeight: number,
  offsetX = 0,
  offsetY = 0,
) {
  const unit = height / physicalHeight;
  ctx.fillStyle = '#111';
  ctx.fillRect(offsetX, offsetY + height - 2.6 * unit, width, 2.6 * unit);
  ctx.fillStyle = '#eee';
  ctx.textAlign = 'center';
  ctx.font = `${1.35 * unit}px sans-serif`;
  ctx.fillText('PLAYTEST • NOT FOR SALE', offsetX + width / 2, offsetY + height - 0.85 * unit);
}

function bleedTile(bitmap: ImageBitmap, face: CardFace, settings: Settings, bleed: number) {
  const width = mmToPx(settings.width, settings.dpi),
    height = mmToPx(settings.height, settings.dpi),
    pad = Math.max(1, mmToPx(bleed, settings.dpi));

  if (usesMpcTrim(face)) {
    const tile = renderCanvas(width + pad * 2, height + pad * 2),
      ctx = tile.getContext('2d') as RenderContext,
      source = artworkSourceRect(face, bitmap.width, bitmap.height, {
        x: bleed / settings.width,
        y: bleed / settings.height,
      });
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, tile.width, tile.height);
    drawSourceArtwork(ctx, bitmap, source, tile.width, tile.height);
    if (settings.proxyLabel) drawProxyLabel(ctx, width, height, settings.height, pad, pad);
    return tile;
  }

  const card = renderCanvas(width, height);
  drawBleedCardArtwork(
    card.getContext('2d') as RenderContext,
    bitmap,
    face,
    width,
    height,
    settings.height,
    settings.proxyLabel,
  );

  const tile = renderCanvas(width + pad * 2, height + pad * 2);
  const ctx = tile.getContext('2d') as RenderContext;
  const source = (card.getContext('2d') as RenderContext).getImageData(0, 0, width, height);
  const padded = ctx.createImageData(tile.width, tile.height);
  padded.data.set(replicateBorder(source.data, width, height, pad));
  ctx.putImageData(padded, 0, 0);
  card.width = card.height = 0;
  return tile;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function imageBitmap(source: string): Promise<ImageBitmap> {
  // Embedded artwork is already local. Decode it without a network request or
  // putting the entire base64 image into an IndexedDB cache key.
  if (source.startsWith('data:')) {
    const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
    if (!match) throw new Error('Unsupported local image format.');
    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: match[1] }));
  }
  let blob = await get<Blob>(`image:${source}`).catch(() => undefined);
  if (!blob) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
    blob = await response.blob();
    if (source.startsWith('https:')) await set(`image:${source}`, blob).catch(() => {});
  }
  return createImageBitmap(blob);
}

export function artworkSourceAtDpi(source: string, _dpi: Settings['dpi']) {
  return source;
}

type BleedSides = { top: number; right: number; bottom: number; left: number };

function placementBleed(
  placement: Sheet['placements'][number],
  sheet: Sheet,
  settings: Settings,
  interior: number,
  exterior: number,
): BleedSides {
  const epsilon = 0.001,
    overlaps = (startA: number, endA: number, startB: number, endB: number) =>
      Math.min(endA, endB) - Math.max(startA, startB) > epsilon,
    adjacent = (side: keyof BleedSides) =>
      sheet.placements.some((other) => {
        if (other === placement) return false;
        if (side === 'left' || side === 'right') {
          if (
            !overlaps(placement.y, placement.y + placement.height, other.y, other.y + other.height)
          )
            return false;
          const gap =
            side === 'left'
              ? placement.x - (other.x + other.width)
              : other.x - (placement.x + placement.width);
          return gap >= -epsilon && gap <= settings.gap + epsilon;
        }
        if (!overlaps(placement.x, placement.x + placement.width, other.x, other.x + other.width))
          return false;
        const gap =
          side === 'top'
            ? placement.y - (other.y + other.height)
            : other.y - (placement.y + placement.height);
        return gap >= -epsilon && gap <= settings.gap + epsilon;
      });
  return {
    top: adjacent('top') ? interior : exterior,
    right: adjacent('right') ? interior : exterior,
    bottom: adjacent('bottom') ? interior : exterior,
    left: adjacent('left') ? interior : exterior,
  };
}

export async function renderSheet(
  sheet: Sheet,
  settings: Settings,
  calibration: boolean | 'manual' = false,
  artworkBleedMm = 0,
  exteriorArtworkBleedMm = artworkBleedMm,
  upscale?: {
    enabled: boolean;
    backend?: UpscaleBackend;
    upscaylCacheKey?: string;
    progress: (text: string) => void;
  },
): Promise<Uint8Array> {
  const canvas = renderCanvas(
    mmToPx(sheet.width, settings.dpi),
    mmToPx(sheet.height, settings.dpi),
  );
  const ctx = canvas.getContext('2d') as RenderContext | null;
  if (!ctx) throw new Error('Could not create the export canvas.');
  ctx.scale(canvas.width / sheet.width, canvas.height / sheet.height);
  try {
    for (const p of sheet.placements) {
      let bitmap: ImageBitmap | undefined;
      if (!calibration) {
        const artworkSource = artworkSourceAtDpi(
          p.entry.card.faces[p.entry.face].image,
          settings.dpi,
        );
        try {
          bitmap = await imageBitmap(artworkSource);
          if (upscale?.enabled) {
            const original = bitmap;
            try {
              bitmap = await upscaleArtwork(
                artworkSource,
                original,
                upscale.progress,
                p.entry.card.faces[p.entry.face].name,
                upscale.backend,
                upscale.upscaylCacheKey,
              );
            } finally {
              original.close();
            }
          }
        } catch (error) {
          if (upscale?.enabled)
            throw new Error(
              `Could not upscale ${p.entry.card.name}: ${error instanceof Error ? error.message : String(error)}. Choose another engine or turn off upscaling to export the original image.`,
            );
          throw new Error(
            `Could not load artwork for ${p.entry.card.name}. Check your connection and retry. No partial sheet was exported.`,
          );
        }
      }
      ctx.save();
      const bleed = Math.max(0, Math.min(artworkBleedMm, settings.gap / 2)),
        exteriorBleed = Math.max(bleed, exteriorArtworkBleedMm);
      if (exteriorBleed > bleed) {
        const sides = placementBleed(p, sheet, settings, bleed, exteriorBleed);
        // Clip in sheet coordinates before applying card rotations. Only sides
        // facing away from a neighboring card receive the larger safety bleed.
        ctx.beginPath();
        ctx.rect(
          p.x - sides.left,
          p.y - sides.top,
          p.width + sides.left + sides.right,
          p.height + sides.top + sides.bottom,
        );
        ctx.clip();
      }
      ctx.translate(p.x, p.y);
      if (p.rotated) {
        ctx.translate(p.width, 0);
        ctx.rotate(Math.PI / 2);
      }
      const w = settings.width,
        h = settings.height;
      if (p.artworkRotation === 180) {
        ctx.translate(w, h);
        ctx.rotate(Math.PI);
      }
      if (bitmap && exteriorBleed > 0) {
        const tile = bleedTile(bitmap, p.entry.card.faces[p.entry.face], settings, exteriorBleed);
        drawBleedTile(ctx, tile, w, h, exteriorBleed);
        tile.width = tile.height = 0;
      } else {
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, settings.radius);
        ctx.clip();
      }
      if (calibration) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f0efe9';
        ctx.fillRect(0.5, 0.5, w - 1, h - 1);
        if (calibration !== 'manual') {
          ctx.strokeStyle = '#555';
          ctx.lineWidth = 0.15;
          for (let x = 5; x < w; x += 5) {
            ctx.beginPath();
            ctx.moveTo(x, 3);
            ctx.lineTo(x, h - 3);
            ctx.stroke();
          }
          for (let y = 5; y < h; y += 5) {
            ctx.beginPath();
            ctx.moveTo(3, y);
            ctx.lineTo(w - 3, y);
            ctx.stroke();
          }
          ctx.fillStyle = '#f0efe9';
          ctx.fillRect(3, h / 2 - 12, w - 6, 24);
          ctx.textAlign = 'center';
          ctx.fillStyle = '#111';
          ctx.font = 'bold 4px sans-serif';
          ctx.fillText('Skarix · size check', w / 2, h / 2 - 3);
          ctx.font = '3px sans-serif';
          ctx.fillText(formatDimensions(w, h, settings.units), w / 2, h / 2 + 3);
          ctx.fillText(
            `Grid: ${formatMeasurement(5, settings.units)} · measure after cutting`,
            w / 2,
            h / 2 + 8,
          );
        }
      } else if (bleed === 0) {
        // Card artwork fills the trim shape. Standard card images already match this
        // ratio; full-bleed and custom sources are cropped evenly at the outer edges.
        drawFinishedArtwork(
          ctx,
          bitmap!,
          p.entry.card.faces[p.entry.face],
          w,
          h,
          h,
          settings.proxyLabel,
        );
      }
      ctx.restore();
      bitmap?.close();
    }
    const blob = await pngBlob(canvas);
    return withDpi(new Uint8Array(await blob.arrayBuffer()), settings.dpi);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
export function instructions(project: Project, sheets: Sheet[], calibration: boolean) {
  const printPaper = paperWorkflow(project.settings);
  if (project.settings.profile === 'eight')
    return (
      `SKARIX — ${calibration ? 'PHYSICAL SIZE CHECK' : project.name}\n\n` +
      `This package contains eight-card artwork PNGs and matching SVG silhouettes. It does not contain Cricut sensor marks. Use Create print PDF in Skarix for the registered ${printPaper.outputPaper} pages.\n\n` +
      `EIGHT-CARD REGISTERED PRINT WORKFLOW\n1. In Create print PDF, download the magenta setup PNG. Upload it to Design Space as one flat Print Then Cut image at 6.9685 × 10.0394 in. Keep all eight cards and the transparent gaps together.\n2. Select portrait Tabloid (11 × 17 in) in Design Space and the system print dialog. Save the complete one-page Tabloid PDF at 100% / Actual size with bleed off and all four sensor marks.\n3. Import that Tabloid PDF in Create print PDF. Skarix checks the card pattern and complete marked footprint, then moves the whole capture onto ${printPaper.outputPaper} without scaling.\n4. Export the registered card PDFs and print them on ${printPaper.outputPaper} at 100% / Actual size, with fit-to-page disabled. Check that all four marks are complete and run a measured plain-paper cut before using card stock.\n5. Reopen the same saved Design Space cut job and mat. A change to card spacing, machine, paper, cut layout, or the saved job requires a new capture.\n\n` +
      `SHEET SIZES\n` +
      sheets
        .map(
          (s) =>
            `Sheet ${s.index + 1}: ${formatDimensions(s.width, s.height, project.settings.units)}; ${s.placements.length} cards; ${mmToPx(s.width, project.settings.dpi)} × ${mmToPx(s.height, project.settings.dpi)} px at ${project.settings.dpi} DPI.`,
        )
        .join('\n') +
      `\n\nThe SVG is a geometry reference, not a second registered cut layer. The eight-card Tabloid-to-${printPaper.outputPaper} route remains experimental until the printer and Cricut read and cut a measured test sheet.\n`
    );
  const seven = project.settings.profile === 'seven',
    cardCount = seven ? 'seven' : 'six';
  return (
    `SKARIX — ${calibration ? 'PHYSICAL SIZE CHECK' : project.name}\n\n` +
    `This package contains transparent artwork PNGs and matching vector-only SVG silhouettes. It contains no Cricut sensor marks and is not a native Design Space project. Design Space generates the marks for the actual print-and-cut job.\n\n` +
    `RECOMMENDED PRINT THEN CUT WORKFLOW\n1. Select your actual machine and ${printPaper.designSpacePaper} paper in Design Space. Calibrate Print Then Cut using Cricut's own calibration flow.${seven ? ' This workaround is limited to Maker and Explore machines.' : ''}\n2. Upload a sheet PNG as a flat / single-layer Print Then Cut image, preserving transparency. Do not remove its background or add an offset. Preview the cut contours: expect exactly one rounded rectangle per card, with no internal holes.\n3. On the Canvas, set that sheet's WIDTH and HEIGHT to the exact values below. Raster DPI metadata alone is not sufficient. Unlock the aspect ratio if needed to correct subpixel rounding. Never auto-resize to fit: that changes the card size.\n4. Make the project. Design Space adds registration marks. ${printPaper.usesTabloidSetup ? `The preview must show all ${cardCount} cards and all four sensor marks on one page. In the system print dialog, change the paper to ${printPaper.systemPaper}, keep portrait orientation, and print at 100% / Actual size. Cancel if it becomes two pages or clips a mark.` : 'The selected paper must accept the design at its original size. If it does not, use a smaller batch. The six-card area is experimental and not machine-validated.'}\n5. ${seven ? 'Keep Design Space bleed off for the setup/capture template. For artwork sheets, inspect every boundary carefully because the 0.1 mm spacing leaves almost no tolerance.' : 'Enable Design Space bleed. Skarix uses a fixed 0.5 mm bleed when the registered-PDF bleed toggle is on.'} Print from Design Space at actual size, with printer scaling/fit-to-page disabled.\n6. Load the sheet as Design Space instructs and finish the cut from the same device in the same session. Do not separately print this PNG from an image viewer.${seven ? ' Design Space may require a 12 × 24 in mat because the declared page is Tabloid, even though the printed sheet is Letter.' : ''}\n7. Measure a test card in both directions before printing a deck. Target: ${formatDimensions(project.settings.width, project.settings.height, project.settings.units)}; corner radius ${formatMeasurement(project.settings.radius, project.settings.units)}. This is a size-check card, not a replacement for Cricut's sensor calibration.\n\n` +
    `SHEET SIZES (set both dimensions on the Design Space Canvas)\n` +
    sheets
      .map(
        (s) =>
          `Sheet ${s.index + 1}: ${formatDimensions(s.width, s.height, project.settings.units)}; ${s.placements.length} cards; ${mmToPx(s.width, project.settings.dpi)} × ${mmToPx(s.height, project.settings.dpi)} px at ${project.settings.dpi} DPI.`,
      )
      .join('\n') +
    `\n\nSVG TEMPLATE\nThe SVG has the same origin, dimensions, card positions and corner radii as the PNG. It contains only filled cut silhouettes, with no artwork. It is a geometry reference / separate Basic Cut template; it does not independently register a printed page. Uploading the PNG already supplies cut contours through its alpha silhouette. Do not enable both PNG contours and SVG cuts in the same job, or you may cut twice. Vector reference precision does not imply identical Design Space raster tracing.\n\nLIMITS\nPhysical alignment depends on Design Space tracing, machine calibration, printer scaling and media. No hardware cut has been certified. Registered printing can create manual-refeed or alternating duplex back pages; double-sided cards use their opposite face automatically. The selected DPI controls the export raster; it does not add detail to lower-resolution source art. 900 and 1200 DPI use substantially more memory and create larger files.\n\nOfficial workflow: https://help.cricut.com/hc/en-us/articles/360009387274-How-to-Print-Then-Cut-in-Design-Space\nArea limits: https://help.cricut.com/hc/en-us/articles/360009429814-How-large-can-I-Print-Then-Cut\nCalibration: https://help.cricut.com/hc/en-us/articles/360009424974-Calibrating-your-machine-for-Print-Then-Cut\nSkarix is not affiliated with Cricut.\n`
  );
}
export async function exportBundle(
  project: Project,
  sheets: Sheet[],
  progress: (message: string) => void,
  calibration = false,
) {
  if (!sheets.length) throw new Error('Add at least one card to export.');
  if (sheets.length > 24)
    throw new Error(
      'Export up to 24 sheets at a time. Choose the current sheet for a larger project.',
    );
  const zip = new JSZip();
  for (const [i, sheet] of sheets.entries()) {
    progress(`Rendering sheet ${i + 1} of ${sheets.length}…`);
    const name = `sheet-${String(sheet.index + 1).padStart(2, '0')}`;
    zip.file(
      exportFilename(project, `${calibration ? 'size-check-' : ''}${name}-artwork`, 'png'),
      await renderSheet(sheet, project.settings, calibration),
    );
    zip.file(
      exportFilename(project, `${calibration ? 'size-check-' : ''}${name}-cut-template`, 'svg'),
      templateSvg(sheet, project.settings),
    );
  }
  zip.file('START-HERE.txt', instructions(project, sheets, calibration));
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        version: 1,
        registration: 'Generated by Cricut Design Space, not included',
        settings: project.settings,
        sheets: sheets.map((s) => ({
          number: s.index + 1,
          widthMm: s.width,
          heightMm: s.height,
          widthPx: mmToPx(s.width, project.settings.dpi),
          heightPx: mmToPx(s.height, project.settings.dpi),
          cards: s.placements.map((p) => ({
            name: p.entry.card.name,
            face: p.entry.face,
            source: calibration ? 'size-check' : p.entry.card.id,
            xMm: p.x,
            yMm: p.y,
            widthMm: p.width,
            heightMm: p.height,
            rotated: p.rotated,
            radiusMm: project.settings.radius,
          })),
        })),
      },
      null,
      2,
    ),
  );
  progress('Packing your export…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  download(blob, exportFilename(project, calibration ? 'size-check' : 'export', 'zip'));
}

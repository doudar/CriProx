import { MACHINE_NAMES } from './machine-guides';
import { hasCustomCuts, hasTrimmedOutline, stickerLocalCuts, pathSvg } from './sticker-cuts';
import { cutSettingsSummary } from './cut-settings';
import { PDFDocument, PrintScaling, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { stickerArtworkFrame, stickerArtworkInfo } from './sticker-artwork';
import { mmToPx, type Sheet } from './layout';
import { captureProfile } from './registered-pdf';
import { PT_PER_MM, type RegistrationProfile } from './registration';
import { withDpi } from './png';
import {
  stickerGeometryKey,
  stickerLayoutSettings,
  stickerSheets,
  stickerTemplate,
  type StickerProject,
  type StickerSheet,
} from './stickers';

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function base64ToBytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export async function captureStickerProfile(
  pdf: Uint8Array,
  project: StickerProject,
  name: string,
) {
  if (project.poses)
    throw new Error(
      'Export the arranged sheet to Design Space to create matching registration marks. Captured fixed-slot templates cannot be reused after moving or resizing stickers.',
    );
  // Re-measure the PDF on every open. Never trust saved coordinates or preview metadata.
  const profile = await captureProfile(
    pdf,
    stickerLayoutSettings(project.settings, project.machine),
    name,
    stickerTemplate(project.settings),
  );
  return { ...profile, key: stickerGeometryKey(project.settings, project.machine) };
}

export async function readStickerArtwork(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10_000_000)
    throw new Error('Choose a PNG, JPEG, or WebP under 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('Use an image under 40 megapixels.');
    return `data:${file.type};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
  } finally {
    bitmap.close();
  }
}

export async function renderStickerSheet(
  sheet: Sheet,
  project: StickerProject,
  options: { maxPixels?: number } = {},
): Promise<Uint8Array> {
  const s = project.settings;
  const canvas = document.createElement('canvas');
  const scale = options.maxPixels
    ? options.maxPixels / Math.max(sheet.width, sheet.height)
    : undefined;
  canvas.width = scale ? Math.max(1, Math.ceil(sheet.width * scale)) : mmToPx(sheet.width, s.dpi);
  canvas.height = scale
    ? Math.max(1, Math.ceil(sheet.height * scale))
    : mmToPx(sheet.height, s.dpi);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the sticker canvas.');
  const images = new Map<string, ImageBitmap>();
  try {
    ctx.scale(canvas.width / sheet.width, canvas.height / sheet.height);
    for (const p of sheet.placements) {
      const source = p.entry.card.faces[0].image;
      let bitmap = images.get(source);
      if (!bitmap) {
        const [header, data] = source.split(',');
        bitmap = await createImageBitmap(
          new Blob([base64ToBytes(data).buffer as ArrayBuffer], {
            type: header.slice(5, header.indexOf(';')),
          }),
        );
        images.set(source, bitmap);
      }
      ctx.save();
      const pose = (p as StickerSheet['placements'][number]).sticker ?? {
        width: s.width,
        height: s.height,
        rotation: p.rotated ? 90 : 0,
        flipX: false,
        flipY: false,
        radius: s.radius,
      };
      ctx.translate(p.x + p.width / 2, p.y + p.height / 2);
      ctx.rotate((pose.rotation * Math.PI) / 180);
      ctx.scale(pose.flipX ? -1 : 1, pose.flipY ? -1 : 1);
      ctx.translate(-pose.width / 2, -pose.height / 2);
      ctx.beginPath();
      const design = project.artwork.find((a) => a.id === p.entry.card.id)?.design;
      const custom = hasCustomCuts(design);
      if (design && hasTrimmedOutline(design)) {
        const outline = stickerLocalCuts(
          design,
          { ...pose, flipX: false, flipY: false },
          s.fit,
        ).filter((path) => path.closed);
        // Separate subpaths are a union, regardless of a path's drawing direction.
        const mask = new Path2D();
        for (const path of outline) {
          const area = path.points.reduce((sum, p, i) => {
            const q = path.points[(i + 1) % path.points.length];
            return sum + p.x * q.y - q.x * p.y;
          }, 0);
          mask.addPath(
            new Path2D(
              pathSvg({ ...path, points: area < 0 ? [...path.points].reverse() : path.points }),
            ),
          );
        }
        ctx.clip(mask);
      } else {
        ctx.roundRect(0, 0, pose.width, pose.height, custom ? 0 : pose.radius);
        ctx.clip();
      }
      // White opaque silhouettes give Design Space one outer cut per sticker, including transparent art.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, pose.width, pose.height);
      const fit = stickerArtworkFrame(await stickerArtworkInfo(source, bitmap), pose, s, custom);
      ctx.drawImage(
        bitmap,
        fit.source.x,
        fit.source.y,
        fit.source.width,
        fit.source.height,
        fit.x,
        fit.y,
        fit.width,
        fit.height,
      );
      if (!custom && s.borderStrokeWidth) {
        const stroke = Math.min(s.borderStrokeWidth, pose.width / 2, pose.height / 2);
        ctx.beginPath();
        ctx.roundRect(
          stroke / 2,
          stroke / 2,
          pose.width - stroke,
          pose.height - stroke,
          Math.max(0, pose.radius - stroke / 2),
        );
        ctx.strokeStyle = s.borderStrokeColor ?? '#222222';
        ctx.lineWidth = stroke;
        ctx.stroke();
      }
      ctx.restore();
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode sticker sheet.'))),
        'image/png',
      ),
    );
    return withDpi(new Uint8Array(await blob.arrayBuffer()), s.dpi);
  } finally {
    for (const bitmap of images.values()) bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

export async function buildStickerPdf(
  project: StickerProject,
  profile: RegistrationProfile,
  progress: (message: string) => void = () => {},
) {
  if (project.artwork.some((a) => hasCustomCuts(a.design)))
    throw Error(
      'Custom cut paths need Prepare print sheets and the matching CriProx cut job. A captured template has different cuts.',
    );
  if (project.poses)
    throw new Error(
      'Create the matching Print Then Cut job in Design Space for freely arranged stickers.',
    );
  if (profile.key !== stickerGeometryKey(project.settings, project.machine))
    throw new Error('Capture matching registration marks first.');
  const sheets = stickerSheets(project);
  if (!sheets.length || sheets.length > 24)
    throw new Error('Prepare between 1 and 24 sheets per print job.');
  const output = await PDFDocument.create(),
    source = await PDFDocument.load(profile.pdf);
  const master = await output.embedPage(source.getPage(0));
  for (const [index, sheet] of sheets.entries()) {
    progress(`Preparing sticker sheet ${index + 1} of ${sheets.length}…`);
    const page = output.addPage([profile.pageWidthPt, profile.pageHeightPt]);
    page.drawPage(master, { x: 0, y: 0, width: profile.pageWidthPt, height: profile.pageHeightPt });
    const x = profile.leftMm * PT_PER_MM,
      y = profile.pageHeightPt - (profile.topMm + sheet.height) * PT_PER_MM,
      pad = 0.35 * PT_PER_MM;
    // Clear each template slot, including unoccupied ones. Keep sensor marks in tapered corners.
    for (const slot of stickerTemplate(project.settings).placements)
      page.drawRectangle({
        x: x + slot.x * PT_PER_MM - pad,
        y: profile.pageHeightPt - (profile.topMm + slot.y + slot.height) * PT_PER_MM - pad,
        width: slot.width * PT_PER_MM + 2 * pad,
        height: slot.height * PT_PER_MM + 2 * pad,
        color: rgb(1, 1, 1),
      });
    const artwork = await output.embedPng(await renderStickerSheet(sheet, project));
    page.drawImage(artwork, {
      x,
      y,
      width: sheet.width * PT_PER_MM,
      height: sheet.height * PT_PER_MM,
    });
  }
  output.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  output.setTitle(`${project.name} — sticker sheets`);
  output.setSubject(
    'Experimental reuse of captured Design Space registration marks. Physical cut validation pending.',
  );
  return output.save();
}

export async function buildStickerHandoff(
  project: StickerProject,
  progress: (message: string) => void,
) {
  if (project.artwork.some((a) => hasCustomCuts(a.design)))
    throw Error(
      'Use Prepare print sheets for custom cut paths. Design Space image import does not preserve separate CriProx blade paths.',
    );
  const sheets = stickerSheets(project).filter((s) => s.placements.length),
    zip = new JSZip();
  if (!sheets.length || sheets.length > 24)
    throw new Error('Prepare between 1 and 24 sheets per export.');
  for (const [index, sheet] of sheets.entries()) {
    progress(`Exporting sticker sheet ${index + 1} of ${sheets.length}…`);
    const number = String(index + 1).padStart(2, '0');
    zip.file(`sheet-${number}.png`, await renderStickerSheet(sheet, project));
    zip.file(`sheet-${number}-cut-reference.svg`, stickerCutSvg(sheet));
  }
  const full = stickerTemplate(project.settings);
  // Partial PNGs crop to their occupied alpha bounds in Design Space; give dimensions per sheet.
  const dimensions = sheets
    .map((s, i) => {
      // Design Space crops PNG alpha. Rounded corners reduce a rotated silhouette's outer bounds.
      const bounds = s.placements.map((p) => {
        const pose = p.sticker,
          angle = (pose.rotation * Math.PI) / 180,
          c = Math.abs(Math.cos(angle)),
          sn = Math.abs(Math.sin(angle));
        const width =
          (pose.width - 2 * pose.radius) * c +
          (pose.height - 2 * pose.radius) * sn +
          2 * pose.radius;
        const height =
          (pose.width - 2 * pose.radius) * sn +
          (pose.height - 2 * pose.radius) * c +
          2 * pose.radius;
        return { x: p.x + (p.width - width) / 2, y: p.y + (p.height - height) / 2, width, height };
      });
      const width =
        Math.max(...bounds.map((p) => p.x + p.width)) - Math.min(...bounds.map((p) => p.x));
      const height =
        Math.max(...bounds.map((p) => p.y + p.height)) - Math.min(...bounds.map((p) => p.y));
      return `Sheet ${i + 1}: occupied artwork ${width.toFixed(3)} x ${height.toFixed(3)} mm.`;
    })
    .join('\n');
  zip.file(
    'label-positions-mm.csv',
    'sheet,label,x_mm,y_mm,width_mm,height_mm,rotated,rotation_degrees,flip_horizontal,flip_vertical\n' +
      sheets
        .flatMap((sheet, page) =>
          sheet.placements.map((p, i) =>
            [
              page + 1,
              i + 1,
              p.x,
              p.y,
              p.width,
              p.height,
              p.rotated,
              p.sticker.rotation,
              p.sticker.flipX,
              p.sticker.flipY,
            ].join(','),
          ),
        )
        .join('\n'),
  );
  zip.file(
    'READ-ME.txt',
    `Requested cut settings: ${cutSettingsSummary(project.settings)}. Set these in Design Space for the chosen material; they are not applied automatically.\n\n` +
      `${MACHINE_NAMES[project.machine]} sticker sheets\n\n${dimensions}\nLayout frame: ${project.poses ? project.settings.areaWidth : full.width} x ${project.poses ? project.settings.areaHeight : full.height} mm.\n\nUpload each PNG as a Flat Graphic / Print Then Cut image in Design Space. Set its occupied artwork dimensions above; check the cut contours. White backgrounds are intentional. PNG transparency supplies rounded rectangle cuts, not an outline traced around the artwork. The SVG is a reference only; do not enable both PNG contours and SVG cuts.\n\nSelect ${MACHINE_NAMES[project.machine]} and the correct paper. Design Space decides whether the arrangement fits; reduce the layout limits or sticker count if it does not, without rescaling finished stickers. Print and cut from the same Design Space job. Design Space supplies the sensor marks and directional arrow. Follow Design Space for mat placement. On Explore 5, place A4 landscape on the mat, arrow at upper left pointing up. Select material and pressure in Design Space, load the mat and press Go.\n\nFor reusable captured PDFs use CriProx's separate setup PNG, capture with bleed OFF, and keep that exact saved full-template job. Partial registered pages still use the full template and cut blank slots. Captured PDF reuse is experimental; physical registration scanning and cut alignment have not been validated.\n\nCriProx can connect to Explore 5 in the Windows desktop app and run a blade-free homing test. Registration scanning, cutting, pause, and cancel still use Design Space. Disconnect CriProx before opening Design Space.\n`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

export function stickerCutSvg(sheet: StickerSheet): string {
  const shapes = sheet.placements
    .map((p) => {
      const s = p.sticker;
      return `<rect x="${-s.width / 2}" y="${-s.height / 2}" width="${s.width}" height="${s.height}" rx="${s.radius}" transform="translate(${p.x + p.width / 2} ${p.y + p.height / 2}) rotate(${s.rotation})" fill="none" stroke="black" stroke-width="0.1"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}mm" height="${sheet.height}mm" viewBox="0 0 ${sheet.width} ${sheet.height}">${shapes}</svg>`;
}

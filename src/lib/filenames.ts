import { grid } from './layout';
import type { Project, Settings } from './types';

/** Keep names readable while avoiding path separators and Windows reserved names. */
export function filenameStem(name: string, fallback = 'Skarix') {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  let stem = '';
  for (const character of cleaned) {
    if (new TextEncoder().encode(stem + character).length > 80) break;
    stem += character;
  }
  stem = stem.replace(/-+$/g, '');
  if (!stem) return fallback;
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem) ? `Skarix-${stem}` : stem;
}

export function layoutFilenameStem(settings: Settings) {
  return `${settings.paper === 'letter' ? 'US-Letter' : 'A4'}-${grid(settings).capacity}-card`;
}

/** Reusable templates describe every setting that changes their cut geometry. */
export function templateFilenameStem(settings: Settings) {
  return `Skarix-${settings.machine}-${layoutFilenameStem(settings)}-${settings.profile}-${settings.width}x${settings.height}mm-gap-${settings.gap}mm-radius-${settings.radius}mm`;
}

export function templateFilename(settings: Settings, purpose: string, extension: 'png' | 'pdf') {
  return `${templateFilenameStem(settings)}-${purpose}.${extension}`;
}

function cutOffsetFilenameTag(settings: Settings) {
  const axis = (value: number, negative: string, positive: string) =>
    Math.abs(value) < 0.001
      ? 'centered'
      : `${Number(Math.abs(value).toFixed(2))}mm-${value < 0 ? negative : positive}`;
  return `cut-offset-x-${axis(settings.manualCutCorrectionX, 'left', 'right')}-y-${axis(settings.manualCutCorrectionY, 'up', 'down')}`;
}

export function exportFilename(
  project: Project,
  purpose: string,
  extension: 'pdf' | 'png' | 'svg' | 'zip',
) {
  const settings = project.settings,
    correction =
      extension === 'pdf' && settings.profile === 'nine' && settings.machine !== 'manual'
        ? `-${cutOffsetFilenameTag(settings)}`
        : '';
  return `${filenameStem(project.name)}-${layoutFilenameStem(settings)}-${purpose}${correction}.${extension}`;
}

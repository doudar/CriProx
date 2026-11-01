import {
  fixedBleedMm,
  isTightRegisteredProfile,
  PRINT_DPI_OPTIONS,
  STANDARD_CARD_RADIUS_MM,
  type Project,
} from './types';
import { availableSheetProfiles } from './paper-workflow';
import { readCutSettings } from './cut-settings';
import { validateStickerDesign } from './sticker-design';
const supportedImage = (url: unknown) =>
  typeof url === 'string' &&
  /^(https:\/\/(cards\.scryfall\.io\/|cdn\.mpcautofill\.com\/images\/google_drive\/(full|large)\/)|data:image\/(png|jpeg|webp);base64,)/.test(
    url,
  );
export function validateProject(value: unknown): Project {
  const p = value as Project;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== 'string' ||
    p.name.length > 100 ||
    !Array.isArray(p.entries) ||
    !p.settings
  )
    throw new Error('This is not a supported CriProx project.');
  const s = p.settings;
  Object.assign(s, readCutSettings(s));
  // Older projects stay valid. The removed four-slot profile migrates to the
  // six-slot layout, and any enabled custom bleed amount becomes the fixed amount.
  if ((s.profile as string) === 'conservative') s.profile = 'expanded';
  // The first eight-card test used 0.1 mm spacing. Its capture is incompatible
  // with the revised 1 mm geometry, so migrate saved projects before validation.
  if (s.profile === 'eight' && s.gap === 0.1) s.gap = 1;
  s.units ??= s.paper === 'letter' ? 'in' : 'mm';
  s.bleed ??= 0;
  // Projects created with the previous 3 mm default should follow the corrected
  // physical Magic card geometry without requiring manual JSON edits.
  if (s.radius === 3) s.radius = STANDARD_CARD_RADIUS_MM;
  if (Number.isFinite(s.bleed) && s.bleed > 0) s.bleed = fixedBleedMm(s);
  s.backBleedEnabled ??= true;
  s.backsEnabled ??= false;
  s.backPrintMode ??= 'manual';
  s.backFlip ??= 'long-edge';
  s.backRotation ??= s.backPrintMode === 'manual' ? 180 : 0;
  s.backOffsetX ??= 0;
  s.backOffsetY ??= 0;
  s.manualCutCorrectionX ??= 0;
  s.manualCutCorrectionY ??= 0;
  s.manualGuidesEnabled ??= true;
  s.manualGuideColor ??= '#222222';
  s.manualGuidePageColor ??= '#555555';
  s.manualGuideWidthPx ??= 1;
  s.manualGuidePlacement ??= 'outside';
  s.manualGuideCardStyle ??= 'none';
  s.manualGuideLineStyle ??= 'solid';
  s.manualGuideCornerStyle ??= 'square';
  s.manualGuideLengthMm ??= 7.5;
  s.manualGuidePageStyle ??= 'edge';
  s.upscaleScryfall ??= false;
  s.upscaleBackend ??= 'built-in';
  if (
    !['mm', 'in'].includes(s.units) ||
    !['letter', 'a4'].includes(s.paper) ||
    !['maker', 'explore-5', 'explore', 'joy-xtra', 'manual'].includes(s.machine) ||
    !['expanded', 'seven', 'eight', 'nine'].includes(s.profile) ||
    !PRINT_DPI_OPTIONS.includes(s.dpi) ||
    typeof s.upscaleScryfall !== 'boolean' ||
    !['built-in', 'upscayl'].includes(s.upscaleBackend) ||
    typeof s.backBleedEnabled !== 'boolean' ||
    typeof s.backsEnabled !== 'boolean' ||
    !['manual', 'duplex'].includes(s.backPrintMode) ||
    !['long-edge', 'short-edge'].includes(s.backFlip) ||
    ![0, 180].includes(s.backRotation) ||
    typeof s.proxyLabel !== 'boolean' ||
    typeof s.manualGuidesEnabled !== 'boolean' ||
    !/^#[0-9a-f]{6}$/i.test(s.manualGuideColor) ||
    !/^#[0-9a-f]{6}$/i.test(s.manualGuidePageColor) ||
    !['outside', 'center', 'inside'].includes(s.manualGuidePlacement) ||
    !['none', 'corners', 'full'].includes(s.manualGuideCardStyle) ||
    !['solid', 'dashed'].includes(s.manualGuideLineStyle) ||
    !['square', 'round'].includes(s.manualGuideCornerStyle) ||
    !['none', 'edge', 'full'].includes(s.manualGuidePageStyle)
  )
    throw new Error('Invalid sheet settings.');
  for (const [n, min, max] of [
    [s.width, 40, 100],
    [s.height, 40, 120],
    [s.gap, isTightRegisteredProfile(s.profile) ? 0.1 : 1, 10],
    [s.radius, 0, 6],
    [s.bleed, 0, 1.5],
    [s.backOffsetX, -5, 5],
    [s.backOffsetY, -5, 5],
    [s.manualCutCorrectionX, -5, 5],
    [s.manualCutCorrectionY, -5, 5],
    [s.manualGuideWidthPx, 0.5, 8],
    [s.manualGuideLengthMm, 2.5, 20],
  ]) {
    if (!Number.isFinite(n) || n < min || n > max)
      throw new Error('Card dimensions are outside the supported range.');
  }
  if (s.bleed > s.gap / 2)
    throw new Error('Artwork bleed must fit within half of the card spacing.');
  if (s.machine === 'manual' && s.profile !== 'nine')
    throw new Error('Manual cutting requires the nine-card layout.');
  if (
    (s.profile === 'seven' || s.profile === 'eight') &&
    (!availableSheetProfiles(s).includes(s.profile) ||
      s.width !== 63 ||
      s.height !== 88 ||
      s.gap !== (s.profile === 'seven' ? 0.1 : 1) ||
      s.radius !== STANDARD_CARD_RADIUS_MM)
  )
    throw new Error(
      'The experimental seven-card and eight-card layouts require a Maker or Explore, 63 × 88 mm cards, 2.5 mm corners, and respectively 0.1 mm or 1 mm spacing. Seven-card output requires US Letter; eight-card output supports US Letter or A4.',
    );
  if (
    s.profile === 'nine' &&
    (s.width !== 63 || s.height !== 88 || s.gap !== 1 || s.radius !== STANDARD_CARD_RADIUS_MM)
  )
    throw new Error(
      'The manual nine-card layout requires 63 × 88 mm cards, 1 mm spacing, and 2.5 mm corners.',
    );
  if (
    p.backArtwork &&
    (typeof p.backArtwork.name !== 'string' ||
      (p.backArtwork.trim !== undefined && p.backArtwork.trim !== 'mpc') ||
      ![p.backArtwork.image, p.backArtwork.preview].every((url) => supportedImage(url)))
  )
    throw new Error('Unsupported card-back artwork in project.');
  const ids = new Set<string>();
  for (const entry of p.entries) {
    const c = entry.card;
    if (
      typeof entry.id !== 'string' ||
      ids.has(entry.id) ||
      !Number.isInteger(entry.quantity) ||
      entry.quantity < 1 ||
      entry.quantity > 100 ||
      !c ||
      !['id', 'name', 'set', 'setName', 'collector'].every(
        (key) => typeof c[key as keyof typeof c] === 'string',
      ) ||
      !Array.isArray(c.faces) ||
      !c.faces.length ||
      c.faces.length > 2 ||
      !Number.isInteger(entry.face) ||
      entry.face < 0 ||
      entry.face >= c.faces.length
    )
      throw new Error('Invalid card entry.');
    ids.add(entry.id);
    for (const face of c.faces) {
      if (face.design) face.design = validateStickerDesign(face.design);
      if (
        typeof face.name !== 'string' ||
        (face.trim !== undefined && face.trim !== 'mpc') ||
        ![face.image, face.preview].every((url) => supportedImage(url))
      )
        throw new Error('Unsupported card image in project.');
    }
  }
  if (p.entries.reduce((sum, e) => sum + e.quantity, 0) > 500)
    throw new Error('Projects can contain up to 500 cards.');
  return p;
}

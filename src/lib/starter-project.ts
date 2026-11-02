import { renderStickerDesign, validateStickerDesign } from './sticker-design';
import { appendSticker, newStickerProject, validateStickerProject } from './stickers';
import logo from '../assets/skarix-logo.json';

/** Editable logo artwork shared with the app and exported brand assets. */
export function starterDesign() {
  return validateStickerDesign(structuredClone(logo));
}
export async function createStarterProject() {
  const design = starterDesign();
  const image = await renderStickerDesign(design);
  const artworkId = crypto.randomUUID();
  const project = {
    ...newStickerProject(),
    name: 'Meet Skarix',
    settings: { ...newStickerProject().settings, width: 100, height: 100, radius: 18 },
    artwork: [{ id: artworkId, name: 'Skarix sticker', image, design }],
  };
  return validateStickerProject(appendSticker(project, artworkId, { width: 100, height: 100 }));
}

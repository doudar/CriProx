import { newDesign, newElement, renderStickerDesign, type DesignElement } from './sticker-design';
import { appendSticker, newStickerProject, validateStickerProject } from './stickers';

/** Editable original artwork: no remote images, fonts, or catalog content. */
export function starterDesign() {
  const design = newDesign(76, 42);
  design.background = '#112b29';
  const element = (
    kind: DesignElement['kind'],
    id: string,
    patch: Partial<DesignElement>,
  ): DesignElement => ({ ...newElement(kind, design), id, ...patch });
  design.elements = [
    element('draw', 'skarix-upper-cut', {
      x: 6,
      y: 7,
      width: 20,
      height: 13,
      fill: '#70e2bd',
      closed: true,
      points: [
        { x: 0, y: 0.65 },
        { x: 0.38, y: 0 },
        { x: 1, y: 0 },
        { x: 0.62, y: 0.65 },
        { x: 1, y: 1 },
        { x: 0.6, y: 1 },
      ],
    }),
    element('draw', 'skarix-lower-cut', {
      x: 6,
      y: 21,
      width: 20,
      height: 13,
      fill: '#70e2bd',
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 0.4, y: 0 },
        { x: 1, y: 0.35 },
        { x: 0.62, y: 1 },
        { x: 0, y: 1 },
        { x: 0.38, y: 0.35 },
      ],
    }),
    element('text', 'skarix-wordmark', {
      x: 30,
      y: 10,
      width: 40,
      height: 13,
      text: 'skarix',
      font: 'Arial',
      fontSize: 10,
      bold: true,
      align: 'left',
      fill: '#ffffff',
    }),
    element('text', 'skarix-tagline', {
      x: 31,
      y: 25,
      width: 40,
      height: 7,
      text: 'MAKE IT YOUR OWN',
      font: 'Arial',
      fontSize: 2.5,
      bold: true,
      align: 'left',
      fill: '#70e2bd',
    }),
  ];
  return design;
}
export async function createStarterProject() {
  const design = starterDesign();
  const image = await renderStickerDesign(design);
  const artworkId = crypto.randomUUID();
  const project = {
    ...newStickerProject(),
    name: 'Meet Skarix',
    settings: { ...newStickerProject().settings, width: 76, height: 42, radius: 4 },
    artwork: [{ id: artworkId, name: 'Skarix sticker', image, design }],
  };
  return validateStickerProject(appendSticker(project, artworkId, { width: 76, height: 42 }));
}

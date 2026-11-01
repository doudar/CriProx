import { designOutputBounds, designCutPaths, hasTrimmedOutline, pathSvg } from './sticker-contours';
export const SHAPES = [
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'heart',
  'hexagon',
] as const;
export type ShapeName = (typeof SHAPES)[number];
export const FONTS = ['Arial', 'Georgia', 'Courier New'] as const;
export const PALETTES = {
  Essentials: [
    '#ffffff',
    '#222222',
    '#ef4444',
    '#f59e0b',
    '#facc15',
    '#22c55e',
    '#3b82f6',
    '#8b5cf6',
  ],
  Pastel: ['#fff7ed', '#fecdd3', '#fed7aa', '#fef08a', '#bbf7d0', '#bae6fd', '#ddd6fe', '#f5d0fe'],
  Earth: ['#faf5e9', '#d5b893', '#ad795b', '#7d4937', '#57694c', '#8d9b77', '#50777a', '#343d38'],
};
export type DesignElement = {
  operation?: 'print' | 'cut';
  closed?: boolean;
  cornerRadius?: number;
  id: string;
  kind: 'text' | 'shape' | 'image' | 'line' | 'draw';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  shape?: ShapeName;
  text?: string;
  font?: (typeof FONTS)[number];
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  image?: string;
  points?: { x: number; y: number }[];
};
export type StickerDesign = {
  cropToCuts?: boolean;
  fitCut?: { borderWidth: number; strokeWidth: number; strokeColor: string; strokeId?: string };
  version: 1;
  width: number;
  height: number;
  background: string;
  elements: DesignElement[];
};
const color = (v: unknown): v is string =>
  typeof v === 'string' && /^(#[0-9a-f]{6}|transparent)$/i.test(v);
const raster = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function validateStickerDesign(value: unknown): StickerDesign {
  const d = value as StickerDesign;
  if (
    !d ||
    d.version !== 1 ||
    (d.cropToCuts !== undefined && typeof d.cropToCuts !== 'boolean') ||
    ![d.width, d.height].every((n) => Number.isFinite(n) && n >= 10 && n <= 250) ||
    !color(d.background) ||
    !Array.isArray(d.elements) ||
    d.elements.length > 500
  )
    throw Error('Invalid sticker design. Use 10–250 mm and at most 500 elements.');
  const ids = new Set<string>();
  let bytes = 0,
    points = 0;
  const elements = d.elements.map((e) => {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(e.id) ||
      ids.has(e.id) ||
      !['text', 'shape', 'image', 'line', 'draw'].includes(e.kind) ||
      ![e.x, e.y, e.width, e.height, e.rotation, e.strokeWidth, e.opacity].every(Number.isFinite) ||
      Math.abs(e.x) > 500 ||
      Math.abs(e.y) > 500 ||
      e.width < 0.1 ||
      e.height < 0.1 ||
      e.width > 500 ||
      e.height > 500 ||
      Math.abs(e.rotation) > 360 ||
      e.strokeWidth < 0 ||
      e.strokeWidth > 20 ||
      e.opacity < 0 ||
      e.opacity > 1 ||
      !color(e.fill) ||
      !color(e.stroke) ||
      typeof e.flipX !== 'boolean' ||
      typeof e.flipY !== 'boolean'
    )
      throw Error('Invalid design element.');
    ids.add(e.id);
    if (e.operation !== undefined && !['print', 'cut'].includes(e.operation))
      throw Error('Invalid element operation.');
    if (e.operation === 'cut' && !['shape', 'line', 'draw'].includes(e.kind))
      throw Error('Use a shape or drawn path for cuts.');
    if (e.closed !== undefined && typeof e.closed !== 'boolean')
      throw Error('Invalid path closure.');
    if (
      e.cornerRadius !== undefined &&
      (!Number.isFinite(e.cornerRadius) ||
        e.cornerRadius < 0 ||
        e.cornerRadius > Math.min(e.width, e.height) / 2)
    )
      throw Error('Invalid shape corner radius.');
    const base: DesignElement = {
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      rotation: e.rotation,
      flipX: e.flipX,
      flipY: e.flipY,
      fill: e.fill,
      stroke: e.stroke,
      strokeWidth: e.strokeWidth,
      opacity: e.opacity,
      ...(e.operation ? { operation: e.operation } : {}),
      ...(e.closed !== undefined ? { closed: e.closed } : {}),
      ...(e.cornerRadius !== undefined ? { cornerRadius: e.cornerRadius } : {}),
    };
    if (e.kind === 'shape') {
      if (!SHAPES.includes(e.shape!)) throw Error('Invalid shape.');
      base.shape = e.shape;
    } else if (e.kind === 'text') {
      if (
        typeof e.text !== 'string' ||
        e.text.length > 2000 ||
        !FONTS.includes(e.font!) ||
        !Number.isFinite(e.fontSize) ||
        e.fontSize! < 0.5 ||
        e.fontSize! > 100 ||
        typeof e.bold !== 'boolean' ||
        !['left', 'center', 'right'].includes(e.align!)
      )
        throw Error('Invalid text element.');
      Object.assign(base, {
        text: e.text,
        font: e.font,
        fontSize: e.fontSize,
        bold: e.bold,
        align: e.align,
      });
    } else if (e.kind === 'image') {
      if (typeof e.image !== 'string' || e.image.length > 14_000_000 || !raster.test(e.image))
        throw Error('Design images must be embedded PNG, JPEG, or WebP files.');
      bytes += e.image.length;
      base.image = e.image;
    } else if (e.kind === 'draw') {
      if (
        !Array.isArray(e.points) ||
        e.points.length < 2 ||
        e.points.length > 2000 ||
        e.points.some((p) => !p || ![p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
      )
        throw Error('Invalid drawn line.');
      base.points = e.points.map((p) => ({ x: p.x, y: p.y }));
      points += base.points.length;
    }
    return base;
  });
  if (bytes > 40_000_000) throw Error('Use less than 40 MB of embedded design images.');
  if (points > 100_000) throw Error('Use at most 100,000 points in one design.');
  if (
    d.fitCut &&
    (!Number.isFinite(d.fitCut.borderWidth) ||
      d.fitCut.borderWidth < 0 ||
      d.fitCut.borderWidth > 20 ||
      !Number.isFinite(d.fitCut.strokeWidth) ||
      d.fitCut.strokeWidth < 0 ||
      d.fitCut.strokeWidth > 5 ||
      !/^#[0-9a-f]{6}$/i.test(d.fitCut.strokeColor) ||
      (d.fitCut.strokeId !== undefined && !/^[a-zA-Z0-9-]{1,80}$/.test(d.fitCut.strokeId)))
  )
    throw Error('Use a border from 0–20 mm and a stroke from 0–5 mm.');
  return {
    version: 1,
    width: d.width,
    height: d.height,
    background: d.background,
    elements,
    ...(d.cropToCuts !== undefined ? { cropToCuts: d.cropToCuts } : {}),
    ...(d.fitCut
      ? {
          fitCut: {
            borderWidth: d.fitCut.borderWidth,
            strokeWidth: d.fitCut.strokeWidth,
            strokeColor: d.fitCut.strokeColor,
            ...(d.fitCut.strokeId ? { strokeId: d.fitCut.strokeId } : {}),
          },
        }
      : {}),
  };
}
export function newDesign(width = 40, height = 40): StickerDesign {
  return { version: 1, width, height, background: '#ffffff', elements: [] };
}
export function newElement(kind: DesignElement['kind'], design: StickerDesign): DesignElement {
  const width = design.width * 0.6,
    height = design.height * 0.35;
  return {
    id: crypto.randomUUID(),
    kind,
    x: (design.width - width) / 2,
    y: (design.height - height) / 2,
    width,
    height,
    rotation: 0,
    flipX: false,
    flipY: false,
    fill: '#7560cf',
    stroke: '#222222',
    strokeWidth: kind === 'line' || kind === 'draw' ? 0.6 : 0,
    opacity: 1,
    ...(kind === 'text'
      ? {
          text: 'Your text',
          font: 'Arial',
          fontSize: Math.min(6, design.height / 5),
          bold: false,
          align: 'center',
        }
      : {}),
    ...(kind === 'shape' ? { shape: 'rectangle' } : {}),
  };
}
export function shapePath(shape: ShapeName, w: number, h: number): string {
  if (shape === 'ellipse')
    return `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h} A ${w / 2} ${h / 2} 0 1 1 ${w / 2} 0 Z`;
  if (shape === 'rectangle') return `M0 0H${w}V${h}H0Z`;
  if (shape === 'heart')
    return `M${w / 2} ${h} C${w * 0.35} ${h * 0.75} 0 ${h * 0.5} 0 ${h * 0.25} C0 ${-h * 0.08} ${w * 0.4} ${-h * 0.08} ${w / 2} ${h * 0.2} C${w * 0.6} ${-h * 0.08} ${w} ${-h * 0.08} ${w} ${h * 0.25} C${w} ${h * 0.5} ${w * 0.65} ${h * 0.75} ${w / 2} ${h} Z`;
  const n = shape === 'triangle' ? 3 : shape === 'diamond' ? 4 : shape === 'hexagon' ? 6 : 10;
  return (
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n,
        r = shape === 'star' && i % 2 ? 0.43 : 1;
      return `${i ? 'L' : 'M'} ${w / 2 + ((Math.cos(a) * w) / 2) * r} ${h / 2 + ((Math.sin(a) * h) / 2) * r}`;
    }).join(' ') + ' Z'
  );
}
export function elementPath(e: DesignElement): string {
  if (e.kind === 'shape' && e.shape === 'rectangle' && e.cornerRadius) {
    const r = e.cornerRadius,
      w = e.width,
      h = e.height;
    return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
  }
  if (e.kind === 'shape') return shapePath(e.shape!, e.width, e.height);
  if (e.kind === 'line') return `M0 0L${e.width} ${e.height}`;
  return (
    (e.points || [])
      .map((p, i) => `${i ? 'L' : 'M'} ${p.x * e.width} ${p.y * e.height}`)
      .join(' ') + (e.closed ? ' Z' : '')
  );
}
export function elementTransform(e: DesignElement): string {
  return `translate(${e.x + e.width / 2} ${e.y + e.height / 2}) rotate(${e.rotation}) scale(${e.flipX ? -1 : 1} ${e.flipY ? -1 : 1}) translate(${-e.width / 2} ${-e.height / 2})`;
}
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
/** The editor and print rasterizer use the same SVG primitives, text metrics and transforms. */
export function designSvg(
  value: StickerDesign,
  options: {
    bounds?: { x: number; y: number; width: number; height: number };
    artworkOnly?: boolean;
  } = {},
): string {
  const d = validateStickerDesign(value);
  const content = d.elements
    .filter((e) => e.operation !== 'cut')
    .map((e) => {
      let body = '';
      if (e.kind === 'image')
        body = `<image xlink:href="${e.image}" width="${e.width}" height="${e.height}" preserveAspectRatio="xMidYMid meet"/>`;
      else if (e.kind === 'text')
        body = `<text fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" paint-order="stroke fill" font-family="${e.font}" font-size="${e.fontSize}" font-weight="${e.bold ? '700' : '400'}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}">${e
          .text!.split('\n')
          .map(
            (line, i) =>
              `<tspan x="${e.align === 'center' ? e.width / 2 : e.align === 'right' ? e.width : 0}" y="${e.fontSize! * (1 + i * 1.2)}">${escape(line)}</tspan>`,
          )
          .join('')}</text>`;
      else
        body = `<path d="${elementPath(e)}" fill="${e.kind === 'shape' || (e.kind === 'draw' && e.closed) ? e.fill : 'none'}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
      return `<g transform="${elementTransform(e)}" opacity="${e.opacity}">${body}</g>`;
    })
    .join('');
  const b = options.bounds ?? designOutputBounds(d);
  const clip =
    !options.artworkOnly && hasTrimmedOutline(d)
      ? designCutPaths(d)
          .filter((p) => p.closed)
          .map((p) => `<path d="${pathSvg(p)}"/>`)
          .join('')
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${b.width}mm" height="${b.height}mm" viewBox="${b.x} ${b.y} ${b.width} ${b.height}">${clip ? `<defs><clipPath id="cut-outline">${clip}</clipPath></defs>` : ''}<g${clip ? ' clip-path="url(#cut-outline)"' : ''}>${options.artworkOnly ? '' : `<rect width="${d.width}" height="${d.height}" fill="${d.background}"/>`}${content}</g></svg>`;
}
export async function renderStickerDesign(value: StickerDesign): Promise<string> {
  const d = validateStickerDesign(value),
    url = URL.createObjectURL(new Blob([designSvg(d)], { type: 'image/svg+xml' }));
  const canvas = document.createElement('canvas');
  const bounds = designOutputBounds(d);
  const scale = Math.min(600 / 25.4, Math.sqrt(24_000_000 / (bounds.width * bounds.height)));
  canvas.width = Math.ceil(bounds.width * scale);
  canvas.height = Math.ceil(bounds.height * scale);
  try {
    await document.fonts.ready;
    const image = new Image();
    image.src = url;
    await image.decode();
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    if (png.length > 14_000_000)
      throw Error('This design is too large. Use smaller images or fewer elements.');
    return png;
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

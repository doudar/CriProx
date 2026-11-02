import { layerHidden, layerLocked } from './design-layer-tools';
import { transformPoint, multiply } from './design-appearance';
import {
  designSvg,
  parentMatrix,
  elementMatrix,
  newElement,
  validateStickerDesign,
  type DesignElement,
  type StickerDesign,
} from './sticker-design';
import { cutElementPoints, designCutPaths } from './sticker-contours';
import type { PointMm } from './generated-registration';

export type FitCutOptions = {
  borderWidth: number;
  strokeWidth: number;
  strokeColor: string;
  strokePlacement?: 'inside' | 'centered' | 'outside';
};
const cross = (a: PointMm, b: PointMm, c: PointMm) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function artworkHull(points: PointMm[]): PointMm[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: PointMm[]) => {
    const result: PointMm[] = [];
    for (const p of list) {
      while (
        result.length > 1 &&
        cross(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop();
      result.push(p);
    }
    return result;
  };
  return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)];
}
/** Round the enclosing contour outward, never removing any visible artwork. */
function paddedHull(hull: PointMm[], radius: number): PointMm[] {
  if (!radius) return hull;
  return hull.flatMap((p, i) => {
    const prev = hull[(i + hull.length - 1) % hull.length],
      next = hull[(i + 1) % hull.length];
    const start = Math.atan2(-(p.x - prev.x), p.y - prev.y),
      end = Math.atan2(-(next.x - p.x), next.y - p.y);
    const angle = (end - start + Math.PI * 2) % (Math.PI * 2),
      steps = Math.max(1, Math.ceil(angle / (Math.PI / 24)));
    return Array.from({ length: steps + 1 }, (_, j) => ({
      x: p.x + radius * Math.cos(start + (angle * j) / steps),
      y: p.y + radius * Math.sin(start + (angle * j) / steps),
    }));
  });
}
function bounds(points: PointMm[]) {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { x, y, width: right - x, height: bottom - y };
}
function fitArtworkLayers(design: StickerDesign) {
  if (
    design.elements.some(
      (e) => (e.operation === 'cut' || e.id === design.fitCut?.strokeId) && layerLocked(design, e),
    )
  )
    throw Error('Unlock cut and border layers before refitting.');
  const referenced = new Set(
    design.elements.flatMap((e) => (e.textPath ? [e.textPath.pathId] : [])),
  );
  return design.elements.flatMap((e) =>
    e.operation === 'cut' || e.id === design.fitCut?.strokeId
      ? referenced.has(e.id)
        ? [{ ...e, operation: 'print' as const, hidden: true }]
        : []
      : [e],
  );
}
export function fittedDesignFromHull(
  design: StickerDesign,
  hull: PointMm[],
  options: FitCutOptions,
  pixelGuard = 0,
): StickerDesign {
  if (hull.length < 3) throw Error('Add visible artwork before fitting a cut.');
  validateStickerDesign({ ...design, fitCut: options });
  const placement = options.strokePlacement ?? 'inside';
  const cutPadding =
    options.borderWidth +
    pixelGuard +
    options.strokeWidth * (placement === 'inside' ? 1 : placement === 'centered' ? 0.5 : 0);
  const outer = paddedHull(hull, cutPadding),
    box = bounds(paddedHull(hull, options.borderWidth + options.strokeWidth + pixelGuard));
  if (box.width < 1 || box.height < 1)
    throw Error('Fit Cut needs artwork at least 1 mm wide and tall.');
  const dx = Math.max(0, -box.x),
    dy = Math.max(0, -box.y);
  const width = Math.max(design.width + dx, box.x + box.width + dx),
    height = Math.max(design.height + dy, box.y + box.height + dy);
  if (width > 250 || height > 250)
    throw Error(
      'The fitted border exceeds the 250 mm canvas limit. Reduce the border or artwork size.',
    );
  const elements = fitArtworkLayers(design).map((e) => ({
    ...e,
    x: e.x + (e.parentId ? 0 : dx),
    y: e.y + (e.parentId ? 0 : dy),
  }));
  const path = (points: PointMm[], operation: 'print' | 'cut'): DesignElement => {
    const b = bounds(points);
    return {
      ...newElement('draw', design),
      operation,
      closed: true,
      x: b.x + dx,
      y: b.y + dy,
      width: b.width,
      height: b.height,
      rotation: 0,
      flipX: false,
      flipY: false,
      fill: 'transparent',
      stroke: options.strokeColor,
      strokeWidth: operation === 'print' ? options.strokeWidth : 0,
      points: points.map((p) => ({ x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height })),
    };
  };
  const stroke = options.strokeWidth
    ? path(paddedHull(hull, options.borderWidth + options.strokeWidth / 2 + pixelGuard), 'print')
    : undefined;
  if (stroke) elements.push(stroke);
  elements.push(path(outer, 'cut'));
  const result = validateStickerDesign({
    ...design,
    width,
    height,
    elements,
    cropToCuts: true,
    fitCut: { ...options, ...(stroke ? { strokeId: stroke.id } : {}) },
  });
  designCutPaths(result);
  return result;
}

function transformedRect(
  e: DesignElement,
  x: number,
  y: number,
  width: number,
  height: number,
): PointMm[] {
  const a = (e.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map((p) => {
    const x = (p.x - e.width / 2) * (e.flipX ? -1 : 1),
      y = (p.y - e.height / 2) * (e.flipY ? -1 : 1);
    const result = { x: e.x + e.width / 2 + x * c - y * s, y: e.y + e.height / 2 + x * s + y * c };
    return e.matrix ? transformPoint(e.matrix, result) : result;
  });
}
export async function fitDesignCut(
  design: StickerDesign,
  options: FitCutOptions,
): Promise<StickerDesign> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const printed = fitArtworkLayers(design);
  const extents: PointMm[] = [];
  for (const e of printed) {
    if (layerHidden(design, e)) continue;
    if (e.textPath) {
      const path = design.elements.find((p) => p.id === e.textPath!.pathId)!;
      const m = multiply(parentMatrix(design, path), elementMatrix(path));
      const pad = (e.fontSize ?? 6) * 2;
      extents.push(
        ...[
          { x: -pad, y: -pad },
          { x: path.width + pad, y: -pad },
          { x: -pad, y: path.height + pad },
          { x: path.width + pad, y: path.height + pad },
        ].map((p) => transformPoint(m, p)),
      );
    }
    const startIndex = extents.length;
    if (e.kind === 'text') {
      ctx.font = `${e.bold ? '700' : '400'} ${e.fontSize}px "${e.font}"`;
      ctx.textAlign = e.align === 'right' ? 'right' : e.align === 'center' ? 'center' : 'left';
      for (const [i, line] of e.text!.split('\n').entries()) {
        const m = ctx.measureText(line),
          anchor = e.align === 'right' ? e.width : e.align === 'center' ? e.width / 2 : 0;
        const baseline = e.fontSize! * (1 + i * 1.2),
          pad = e.strokeWidth / 2;
        extents.push(
          ...transformedRect(
            e,
            anchor - m.actualBoundingBoxLeft - pad,
            baseline - m.actualBoundingBoxAscent - pad,
            m.actualBoundingBoxLeft + m.actualBoundingBoxRight + pad * 2,
            m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + pad * 2,
          ),
        );
      }
    } else if (e.kind === 'image' || e.kind === 'group')
      extents.push(...transformedRect(e, 0, 0, e.width, e.height));
    else {
      const p = cutElementPoints(e);
      const b = bounds(p),
        pad = e.strokeWidth / 2;
      extents.push(
        { x: b.x - pad, y: b.y - pad },
        { x: b.x + b.width + pad, y: b.y + b.height + pad },
      );
    }
    const pad = Math.max(
      (e.effects?.blur ?? 0) * 4,
      ...(e.effects?.shadows ?? []).map((s) => s.blur * 4 + Math.max(Math.abs(s.x), Math.abs(s.y))),
    );
    const local = extents.splice(startIndex);
    const m = parentMatrix(design, e);
    extents.push(
      ...local
        .flatMap((p) => [
          { x: p.x - pad, y: p.y - pad },
          { x: p.x + pad, y: p.y + pad },
        ])
        .map((p) => transformPoint(m, p)),
    );
  }
  if (!extents.length) throw Error('Add visible artwork before fitting a cut.');
  const raw = bounds(extents),
    source = { x: raw.x - 1, y: raw.y - 1, width: raw.width + 2, height: raw.height + 2 };
  const scale = Math.min(12, 2048 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.ceil(source.width * scale));
  canvas.height = Math.max(1, Math.ceil(source.height * scale));
  const url = URL.createObjectURL(
    new Blob([designSvg({ ...design, elements: printed }, { bounds: source, artworkOnly: true })], {
      type: 'image/svg+xml',
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      points: PointMm[] = [];
    for (let y = 0; y < canvas.height; y++) {
      let left = -1,
        right = -1;
      for (let x = 0; x < canvas.width; x++)
        if (data[(y * canvas.width + x) * 4 + 3]) {
          if (left < 0) left = x;
          right = x;
        }
      if (left >= 0)
        for (const x of [left, right])
          points.push({
            x: source.x + ((x + 0.5) * source.width) / canvas.width,
            y: source.y + ((y + 0.5) * source.height) / canvas.height,
          });
    }
    return fittedDesignFromHull(design, artworkHull(points), options, Math.SQRT1_2 / scale);
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

export function reorderDesignLayer(
  design: StickerDesign,
  sourceId: string,
  targetId: string,
): StickerDesign {
  const from = design.elements.findIndex((e) => e.id === sourceId),
    to = design.elements.findIndex((e) => e.id === targetId);
  if (from < 0 || to < 0 || from === to) return design;
  if (
    layerLocked(design, design.elements[from]) ||
    layerLocked(design, design.elements[to]) ||
    (design.elements[from].parentId || null) !== (design.elements[to].parentId || null)
  )
    return design;
  const elements = [...design.elements],
    [element] = elements.splice(from, 1);
  elements.splice(to, 0, element);
  return { ...design, elements };
}

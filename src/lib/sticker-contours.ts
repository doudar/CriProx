import { transformPoint } from './design-appearance';
import type { DesignElement, StickerDesign } from './sticker-design';
import { shapePolygon, type PointMm } from './generated-registration';
export type StickerCutPath = { points: PointMm[]; closed: boolean };
export const hasCustomCuts = (design?: StickerDesign) =>
  !!design?.elements.some((e) => e.operation === 'cut');
function cubic(a: PointMm, b: PointMm, c: PointMm, d: PointMm, t: number): PointMm {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}
/** Deterministic flattening used by preview, export and the native cutter. */
export function cutElementPoints(e: DesignElement): PointMm[] {
  const w = e.width,
    h = e.height;
  let points: PointMm[] = [];
  if (e.kind === 'draw' && e.curves) {
    let start = { x: e.points![0].x * w, y: e.points![0].y * h };
    points.push(start);
    for (const curve of e.curves) {
      const b = { x: curve.c1.x * w, y: curve.c1.y * h },
        c = { x: curve.c2.x * w, y: curve.c2.y * h },
        end = { x: curve.end.x * w, y: curve.end.y * h };
      const length =
        Math.hypot(b.x - start.x, b.y - start.y) +
        Math.hypot(c.x - b.x, c.y - b.y) +
        Math.hypot(end.x - c.x, end.y - c.y);
      const steps = Math.max(8, Math.ceil(length / 0.1));
      if (points.length + steps > 30000)
        throw Error('Curve is too complex. Reduce its size or segments.');
      for (let i = 1; i <= steps; i++) points.push(cubic(start, b, c, end, i / steps));
      start = end;
    }
  } else if (e.kind === 'draw') points = e.points!.map((p) => ({ x: p.x * w, y: p.y * h }));
  else if (e.kind === 'line')
    points = [
      { x: 0, y: 0 },
      { x: w, y: h },
    ];
  else if (e.kind === 'shape') {
    if (e.shape === 'rectangle')
      points = shapePolygon({
        x: 0,
        y: 0,
        width: w,
        height: h,
        radius: e.cornerRadius || 0,
        rotation: 0,
        itemId: e.id,
      });
    else if (e.shape === 'ellipse')
      points = Array.from({ length: 128 }, (_, i) => ({
        x: w / 2 + (Math.cos((i * Math.PI) / 64) * w) / 2,
        y: h / 2 + (Math.sin((i * Math.PI) / 64) * h) / 2,
      }));
    else if (e.shape === 'heart') {
      const curves = [
        [
          [0.5, 1],
          [0.35, 0.75],
          [0, 0.5],
          [0, 0.25],
        ],
        [
          [0, 0.25],
          [0, -0.08],
          [0.4, -0.08],
          [0.5, 0.2],
        ],
        [
          [0.5, 0.2],
          [0.6, -0.08],
          [1, -0.08],
          [1, 0.25],
        ],
        [
          [1, 0.25],
          [1, 0.5],
          [0.65, 0.75],
          [0.5, 1],
        ],
      ];
      for (const curve of curves) {
        const [a, b, c, d] = curve.map(([x, y]) => ({ x: x * w, y: y * h }));
        for (let i = 0; i < 32; i++) points.push(cubic(a, b, c, d, i / 32));
      }
    } else {
      const n =
        e.shape === 'triangle' ? 3 : e.shape === 'diamond' ? 4 : e.shape === 'hexagon' ? 6 : 10;
      points = Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n,
          r = e.shape === 'star' && i % 2 ? 0.43 : 1;
        return { x: w / 2 + ((Math.cos(a) * w) / 2) * r, y: h / 2 + ((Math.sin(a) * h) / 2) * r };
      });
    }
  }
  const a = (e.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return points.map((p) => {
    const x = (p.x - w / 2) * (e.flipX ? -1 : 1),
      y = (p.y - h / 2) * (e.flipY ? -1 : 1);
    const transformed = { x: e.x + w / 2 + x * c - y * s, y: e.y + h / 2 + x * s + y * c };
    return e.matrix ? transformPoint(e.matrix, transformed) : transformed;
  });
}
export function designCutPaths(design: StickerDesign): StickerCutPath[] {
  return design.elements
    .filter((e) => e.operation === 'cut' && !e.hidden)
    .map((e) => {
      const points = cutElementPoints(e),
        closed = e.kind === 'shape' || e.closed === true;
      if (
        points.length < (closed ? 3 : 2) ||
        points.some(
          (p) =>
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.x < -1e-7 ||
            p.y < -1e-7 ||
            p.x > design.width + 1e-7 ||
            p.y > design.height + 1e-7,
        )
      )
        throw Error(
          'Keep every cut path inside the sticker canvas. Closed outlines need at least three points.',
        );
      if (!points.some((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) > 0.05))
        throw Error('Cut paths must be longer than 0.05 mm.');
      return { points, closed };
    });
}
export function pathSvg(path: StickerCutPath): string {
  return (
    path.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(6)} ${p.y.toFixed(6)}`).join(' ') +
    (path.closed ? ' Z' : '')
  );
}

/** Preserve the editable canvas; only sheet output is trimmed. Legacy designs keep their frame. */
export function designOutputBounds(design: StickerDesign) {
  const paths = design.cropToCuts ? designCutPaths(design) : [];
  if (!paths.some((p) => p.closed))
    return { x: 0, y: 0, width: design.width, height: design.height };
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const path of paths)
    for (const p of path.points) {
      x = Math.min(x, p.x);
      y = Math.min(y, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
  const width = right - x,
    height = bottom - y;
  if (width < 1 || height < 1) throw Error('The outer cut must be at least 1 mm wide and tall.');
  return { x, y, width, height };
}
export function hasTrimmedOutline(design?: StickerDesign): boolean {
  return !!design?.cropToCuts && designCutPaths(design).some((p) => p.closed);
}

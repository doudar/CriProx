import { repeatTransforms } from './design-repeat';
import {
  elementMatrix,
  parentMatrix,
  validateStickerDesign,
  type StickerDesign,
  type DesignElement,
} from './sticker-design';
import { inverse, multiply, transformPoint } from './design-appearance';
function inheritedFlag(
  design: StickerDesign,
  e: DesignElement,
  flag: 'locked' | 'hidden',
): boolean {
  const seen = new Set<string>();
  let current: DesignElement | undefined = e;
  while (current) {
    if (current[flag]) return true;
    if (seen.has(current.id)) throw Error('Invalid group hierarchy.');
    seen.add(current.id);
    current = design.elements.find((p) => p.id === current!.parentId);
  }
  return false;
}
export const layerLocked = (d: StickerDesign, e: DesignElement) => inheritedFlag(d, e, 'locked');
export const layerHidden = (d: StickerDesign, e: DesignElement) => inheritedFlag(d, e, 'hidden');
export function layerBounds(design: StickerDesign, e: DesignElement) {
  const m = multiply(parentMatrix(design, e), elementMatrix(e));
  const corners = [
    { x: 0, y: 0 },
    { x: e.width, y: 0 },
    { x: 0, y: e.height },
    { x: e.width, y: e.height },
  ];
  const p = repeatTransforms(e.repeat).flatMap((copy) => {
    const a = (copy.rotation * Math.PI) / 180,
      cos = Math.cos(a),
      sin = Math.sin(a);
    return corners.map((p) => {
      const x = p.x - e.width / 2,
        y = p.y - e.height / 2;
      return transformPoint(m, {
        x: copy.x + e.width / 2 + x * cos - y * sin,
        y: copy.y + e.height / 2 + x * sin + y * cos,
      });
    });
  });
  const left = Math.min(...p.map((p) => p.x)),
    top = Math.min(...p.map((p) => p.y)),
    right = Math.max(...p.map((p) => p.x)),
    bottom = Math.max(...p.map((p) => p.y));
  return { left, top, right, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}
export type Alignment =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical';
export function alignLayers(
  design: StickerDesign,
  ids: string[],
  alignment: Alignment,
): StickerDesign {
  const selected = design.elements.filter((e) => ids.includes(e.id));
  if (selected.length < 2 || selected.some((e) => layerLocked(design, e)))
    throw Error('Select at least two unlocked layers.');
  if (
    selected.some((e) => {
      let parent = e.parentId;
      while (parent) {
        if (ids.includes(parent)) return true;
        parent = design.elements.find((e) => e.id === parent)?.parentId;
      }
      return false;
    })
  )
    throw Error('Select the group or its children, not both.');
  const boxes = selected.map((e) => ({ e, ...layerBounds(design, e) }));
  const deltas = new Map<string, { x: number; y: number }>();
  if (alignment.startsWith('distribute')) {
    if (boxes.length < 3) throw Error('Select at least three layers to distribute.');
    const horizontal = alignment === 'distribute-horizontal',
      key = horizontal ? 'cx' : 'cy';
    boxes.sort((a, b) => a[key] - b[key]);
    const step = (boxes.at(-1)![key] - boxes[0][key]) / (boxes.length - 1);
    boxes.forEach((b, i) =>
      deltas.set(b.e.id, {
        x: horizontal ? boxes[0][key] + step * i - b[key] : 0,
        y: horizontal ? 0 : boxes[0][key] + step * i - b[key],
      }),
    );
  } else {
    const left = Math.min(...boxes.map((b) => b.left)),
      right = Math.max(...boxes.map((b) => b.right)),
      top = Math.min(...boxes.map((b) => b.top)),
      bottom = Math.max(...boxes.map((b) => b.bottom));
    boxes.forEach((b) =>
      deltas.set(b.e.id, {
        x:
          alignment === 'left'
            ? left - b.left
            : alignment === 'right'
              ? right - b.right
              : alignment === 'center'
                ? (left + right) / 2 - b.cx
                : 0,
        y:
          alignment === 'top'
            ? top - b.top
            : alignment === 'bottom'
              ? bottom - b.bottom
              : alignment === 'middle'
                ? (top + bottom) / 2 - b.cy
                : 0,
      }),
    );
  }
  const elements = design.elements.map((e) => {
    const delta = deltas.get(e.id);
    if (!delta) return e;
    const basis = inverse(multiply(parentMatrix(design, e), e.matrix ?? [1, 0, 0, 1, 0, 0]));
    return {
      ...e,
      x: e.x + basis[0] * delta.x + basis[2] * delta.y,
      y: e.y + basis[1] * delta.x + basis[3] * delta.y,
    };
  });
  return validateStickerDesign({ ...design, elements });
}
export const snapCoordinate = (n: number, spacing: number) => Math.round(n / spacing) * spacing;

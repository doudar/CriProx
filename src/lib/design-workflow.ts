import type { DesignElement, StickerDesign } from './sticker-design';
import { repeatTransforms } from './design-repeat';
import { layerBounds } from './design-layer-tools';

export function layerLabel(element: DesignElement): string {
  return (
    element.name?.trim() ||
    (element.kind === 'text' ? element.text?.slice(0, 24) : element.shape) ||
    element.kind
  );
}

/** Ancestors ordered from the outermost logical part to the immediate parent. */
export function layerAncestors(design: StickerDesign, element: DesignElement): DesignElement[] {
  const ancestors: DesignElement[] = [];
  const seen = new Set([element.id]);
  let parent = element.parentId;
  while (parent) {
    if (seen.has(parent)) break;
    seen.add(parent);
    const group = design.elements.find((e) => e.id === parent);
    if (!group) break;
    ancestors.unshift(group);
    parent = group.parentId;
  }
  return ancestors;
}

/** A close-up of the selected part in context, preserving ancestor appearance. */
export function selectionViewBox(
  design: StickerDesign,
  element: DesignElement,
  zoom = 100,
): string {
  const bounds = layerBounds(design, element);
  const width = (Math.max(1, bounds.right - bounds.left + 4) * 100) / zoom;
  const height = (Math.max(1, bounds.bottom - bounds.top + 4) * 100) / zoom;
  return `${bounds.cx - width / 2} ${bounds.cy - height / 2} ${width} ${height}`;
}

/** Editor hit boxes use exactly the same local copy transforms as printed artwork. */
export function layerHitRegions(element: DesignElement, frame: DesignElement = element) {
  return repeatTransforms(element.repeat).map((copy) => ({
    width: frame.width,
    height: frame.height,
    transform: element.repeat
      ? `translate(${copy.x} ${copy.y}) rotate(${copy.rotation} ${frame.width / 2} ${frame.height / 2})`
      : undefined,
  }));
}

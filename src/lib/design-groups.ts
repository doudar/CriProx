import { repeatTransforms } from './design-repeat';
import { layerLocked } from './design-layer-tools';
import {
  type StickerDesign,
  type DesignElement,
  newElement,
  validateStickerDesign,
  elementMatrix,
} from './sticker-design';
import { multiply, identity, transformPoint } from './design-appearance';
export function descendants(design: StickerDesign, id: string): Set<string> {
  const ids = new Set([id]);
  for (let n = 0; n < 9; n++)
    for (const e of design.elements) if (e.parentId && ids.has(e.parentId)) ids.add(e.id);
  return ids;
}
export function removeLayer(design: StickerDesign, id: string): StickerDesign {
  const ids = descendants(design, id);
  return {
    ...design,
    elements: design.elements
      .filter((e) => !ids.has(e.id))
      .map((e) => (e.textPath && ids.has(e.textPath.pathId) ? { ...e, textPath: null } : e)),
  };
}
export function duplicateLayer(
  design: StickerDesign,
  id: string,
  newId: string = crypto.randomUUID(),
  dx = 1,
  dy = 1,
): StickerDesign {
  const ids = descendants(design, id),
    mapping = new Map([...ids].map((old) => [old, old === id ? newId : crypto.randomUUID()]));
  const copies = design.elements
    .filter((e) => ids.has(e.id))
    .map((e) => ({
      ...structuredClone(e),
      id: mapping.get(e.id)!,
      parentId: mapping.get(e.parentId!) ?? e.parentId,
      ...(e.textPath
        ? {
            textPath: {
              ...e.textPath,
              pathId: mapping.get(e.textPath.pathId) ?? e.textPath.pathId,
            },
          }
        : {}),
      x: e.x + (e.id === id ? dx : 0),
      y: e.y + (e.id === id ? dy : 0),
    }));
  const elements = [...design.elements];
  const index = Math.max(...elements.map((e, i) => (ids.has(e.id) ? i : -1)));
  elements.splice(index + 1, 0, ...copies);
  return validateStickerDesign({ ...design, elements });
}
export function groupLayers(
  design: StickerDesign,
  ids: string[],
  id: string = crypto.randomUUID(),
): StickerDesign {
  const layers = design.elements.filter((e) => ids.includes(e.id));
  if (
    layers.length < 2 ||
    layers.length !== new Set(ids).size ||
    layers.some(
      (e) =>
        e.operation === 'cut' ||
        layerLocked(design, e) ||
        (e.parentId || null) !== (layers[0].parentId || null),
    )
  )
    throw Error('Select at least two artwork layers in the same group.');
  if (design.elements.some((e) => e.id === id)) throw Error('Group ID already exists.');
  const points = layers.flatMap((e) =>
    repeatTransforms(e.repeat).flatMap((copy) => {
      const a = (copy.rotation * Math.PI) / 180,
        cos = Math.cos(a),
        sin = Math.sin(a);
      return [
        { x: 0, y: 0 },
        { x: e.width, y: 0 },
        { x: 0, y: e.height },
        { x: e.width, y: e.height },
      ].map((p) => {
        const x = p.x - e.width / 2,
          y = p.y - e.height / 2;
        return transformPoint(elementMatrix(e), {
          x: copy.x + e.width / 2 + x * cos - y * sin,
          y: copy.y + e.height / 2 + x * sin + y * cos,
        });
      });
    }),
  );
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  const width = Math.max(...points.map((p) => p.x)) - x,
    height = Math.max(...points.map((p) => p.y)) - y;
  const group: DesignElement = {
    ...newElement('group', design),
    id,
    name: 'Group',
    x,
    y,
    width,
    height,
    groupWidth: width,
    groupHeight: height,
    parentId: layers[0].parentId,
  };
  const last = Math.max(...layers.map((e) => design.elements.indexOf(e)));
  const elements = design.elements.map((e) =>
    ids.includes(e.id)
      ? { ...e, parentId: id, matrix: multiply([1, 0, 0, 1, -x, -y], e.matrix ?? identity) }
      : e,
  );
  elements.splice(last + 1, 0, group);
  return validateStickerDesign({ ...design, elements });
}
export function ungroupLayer(design: StickerDesign, id: string): StickerDesign {
  const group = design.elements.find((e) => e.id === id);
  if (!group || group.kind !== 'group') throw Error('Select a group.');
  if (layerLocked(design, group)) throw Error('Unlock the group before ungrouping.');
  const m = multiply(elementMatrix(group), [
    group.width / group.groupWidth!,
    0,
    0,
    group.height / group.groupHeight!,
    0,
    0,
  ]);
  // Group appearance cannot in general be distributed among overlapping children.
  if (
    group.opacity !== 1 ||
    group.effects ||
    group.mask ||
    (group.blendMode && group.blendMode !== 'normal')
  )
    throw Error(
      'Reset group opacity, effects, mask and blend before ungrouping to preserve appearance.',
    );
  const children = design.elements
    .filter((e) => e.parentId === id)
    .map((e) => ({
      ...e,
      hidden: !!group.hidden || !!e.hidden,
      parentId: group.parentId,
      matrix: multiply(m, e.matrix ?? identity),
    }));
  const elements = design.elements
    .filter((e) => e.parentId !== id)
    .flatMap((e) => (e.id === id ? children : [e]));
  return validateStickerDesign({ ...design, elements });
}

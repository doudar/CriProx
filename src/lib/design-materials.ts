import { parseAppearance } from '../../electron/design-appearance.cjs';
import { layerLocked } from './design-layer-tools';
import { validateStickerDesign, type DesignElement, type StickerDesign } from './sticker-design';

export type MaterialAppearance = Pick<
  DesignElement,
  'fill' | 'opacity' | 'gradient' | 'texture' | 'effects' | 'blendMode'
>;
export type MaterialPreset = { id: string; name: string; appearance: MaterialAppearance };

/** Print appearances, not physical cutter material settings. */
export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'painted-metal',
    name: 'Painted metal',
    appearance: {
      fill: '#627d96',
      opacity: 1,
      blendMode: 'normal',
      gradient: {
        from: '#34495e',
        to: '#a8bfd0',
        angle: 110,
        stops: [
          { offset: 0, color: '#34495e', opacity: 1 },
          { offset: 0.45, color: '#a8bfd0', opacity: 1 },
          { offset: 1, color: '#526c85', opacity: 1 },
        ],
      },
      texture: { type: 'metal', seed: 17, scale: 1.2, opacity: 0.22 },
      effects: { blur: 0 },
    },
  },
  {
    id: 'rubber',
    name: 'Rubber',
    appearance: {
      fill: '#30343b',
      opacity: 1,
      blendMode: 'normal',
      gradient: { from: '#494e56', to: '#20242a', angle: 90 },
      texture: { type: 'grain', seed: 23, scale: 0.7, opacity: 0.15 },
      effects: { blur: 0 },
    },
  },
  {
    id: 'soft-grass',
    name: 'Soft grass',
    appearance: {
      fill: '#648b44',
      opacity: 0.96,
      blendMode: 'normal',
      gradient: { from: '#96b96a', to: '#3e682e', angle: 90 },
      texture: { type: 'grain', seed: 41, scale: 1.5, opacity: 0.35 },
      effects: { blur: 0.12 },
    },
  },
];
const keys = ['fill', 'opacity', 'gradient', 'texture', 'effects', 'blendMode'];
export function parseMaterialPresets(value: unknown): MaterialPreset[] {
  if (!Array.isArray(value) || value.length > 32) throw Error('Use at most 32 saved materials.');
  const ids = new Set<string>();
  return value.map((preset: MaterialPreset) => {
    if (
      !preset ||
      typeof preset.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(preset.id) ||
      ids.has(preset.id) ||
      typeof preset.name !== 'string' ||
      !preset.name.trim() ||
      preset.name.length > 100 ||
      !preset.appearance ||
      Object.keys(preset.appearance).some((key) => !keys.includes(key))
    )
      throw Error('Invalid named material preset.');
    ids.add(preset.id);
    const a = preset.appearance;
    if (
      typeof a.fill !== 'string' ||
      !/^(#[0-9a-f]{6}|transparent)$/i.test(a.fill) ||
      !Number.isFinite(a.opacity) ||
      a.opacity < 0 ||
      a.opacity > 1
    )
      throw Error('Invalid material fill or opacity.');
    const parsed = parseAppearance(a);
    if (parsed.texture?.type === 'image' || parsed.texture?.image)
      throw Error('Saved materials support procedural textures only, not photo textures.');
    return {
      id: preset.id,
      name: preset.name.trim(),
      appearance: {
        fill: a.fill,
        opacity: a.opacity,
        gradient: parsed.gradient ?? null,
        texture: parsed.texture ?? null,
        effects: parsed.effects ?? null,
        blendMode: parsed.blendMode ?? 'normal',
      },
    };
  });
}
export const materialFillable = (e: DesignElement): boolean =>
  e.operation !== 'cut' &&
  (e.kind === 'shape' || e.kind === 'text' || (e.kind === 'draw' && e.closed === true));

/** One immutable transaction; locked, cutting and non-fillable descendants stay untouched. */
export function applyMaterialPreset(
  design: StickerDesign,
  ids: string[],
  preset: MaterialPreset,
  options: { includeDescendants?: boolean } = {},
): StickerDesign {
  const material = parseMaterialPresets([preset])[0];
  const targets = new Set(ids);
  if (!ids.length || ids.some((id) => !design.elements.some((e) => e.id === id)))
    throw Error('Select existing layers to apply a material.');
  const selected = (e: DesignElement) => {
    if (targets.has(e.id)) return true;
    if (!options.includeDescendants) return false;
    const seen = new Set<string>();
    let parent = e.parentId;
    while (parent && !seen.has(parent)) {
      if (targets.has(parent)) return true;
      seen.add(parent);
      parent = design.elements.find((layer) => layer.id === parent)?.parentId;
    }
    return false;
  };
  let count = 0;
  const elements = design.elements.map((e) => {
    if (!selected(e) || !materialFillable(e) || layerLocked(design, e)) return e;
    count++;
    return { ...e, ...structuredClone(material.appearance) };
  });
  if (!count)
    throw Error('Select unlocked shapes, text or closed paths; enable group contents for groups.');
  return validateStickerDesign({ ...design, elements });
}
export function saveMaterialPreset(
  design: StickerDesign,
  elementId: string,
  name: string,
): StickerDesign {
  const e = design.elements.find((layer) => layer.id === elementId);
  if (!e || !materialFillable(e))
    throw Error('Select a shape, text or closed path to save its material.');
  const trimmed = name.trim();
  const existing = design.materialPresets ?? [];
  const previous = existing.find((preset) => preset.name.toLowerCase() === trimmed.toLowerCase());
  const preset: MaterialPreset = {
    id: previous?.id ?? `material-${crypto.randomUUID()}`,
    name: trimmed,
    appearance: {
      fill: e.fill,
      opacity: e.opacity,
      gradient: e.gradient,
      texture: e.texture,
      effects: e.effects,
      blendMode: e.blendMode,
    },
  };
  const materialPresets = parseMaterialPresets([
    ...existing.filter((p) => p.id !== previous?.id),
    preset,
  ]);
  return validateStickerDesign({ ...design, materialPresets });
}

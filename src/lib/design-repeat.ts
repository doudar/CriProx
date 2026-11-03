import type { RepeatPattern } from './design-appearance';

/** Shared deterministic transforms. One editable source, bounded render-only copies. */
export function repeatTransforms(repeat?: RepeatPattern | null) {
  if (!repeat) return [{ x: 0, y: 0, rotation: 0, opacity: 1 }];
  let state = repeat.seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: repeat.count }, (_, i) => {
    let x = 0,
      y = 0,
      rotation = 0;
    if (repeat.mode === 'grid') {
      x = (i % repeat.columns) * repeat.spacingX;
      y = Math.floor(i / repeat.columns) * repeat.spacingY;
    } else if (repeat.mode === 'radial') {
      rotation = i * repeat.angle;
      const a = (rotation * Math.PI) / 180;
      x = Math.cos(a) * repeat.spacingX;
      y = Math.sin(a) * repeat.spacingY;
    } else {
      x = random() * repeat.spacingX;
      y = random() * repeat.spacingY;
    }
    rotation += (random() * 2 - 1) * repeat.rotationJitter;
    return { x, y, rotation, opacity: 1 - random() * repeat.opacityJitter };
  });
}
export const DEFAULT_REPEAT: RepeatPattern = {
  mode: 'grid',
  count: 10,
  columns: 5,
  spacingX: 5,
  spacingY: 5,
  angle: 30,
  seed: 7,
  rotationJitter: 0,
  opacityJitter: 0,
};

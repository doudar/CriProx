export type Gradient = {
  from: string;
  to: string;
  type?: 'linear' | 'radial';
  angle?: number;
  cx?: number;
  cy?: number;
  radius?: number;
  stops?: { offset: number; color: string; opacity: number }[];
};
export type Shadow = {
  type: 'drop' | 'inner' | 'glow';
  color: string;
  opacity: number;
  blur: number;
  x: number;
  y: number;
};
export type RepeatPattern = {
  mode: 'grid' | 'radial' | 'scatter';
  count: number;
  columns: number;
  spacingX: number;
  spacingY: number;
  angle: number;
  seed: number;
  rotationJitter: number;
  opacityJitter: number;
};
export type Appearance = {
  name?: string;
  repeat?: RepeatPattern | null;
  hidden?: boolean;
  locked?: boolean;
  textPath?: { pathId: string; side: 'inner' | 'middle' | 'outer'; offset: number } | null;
  gradient?: Gradient | null;
  effects?: { blur?: number; backgroundBlur?: number; shadows?: Shadow[] } | null;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
  mask?: {
    shape: 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'heart' | 'hexagon';
    feather?: number;
    fade?: 'none' | 'left' | 'right' | 'top' | 'bottom' | 'radial';
  } | null;
  texture?: {
    type: 'image' | 'grain' | 'paper' | 'stone' | 'metal';
    image?: string;
    seed: number;
    scale: number;
    opacity: number;
  } | null;
  adjustments?: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    sharpen?: number;
  } | null;
  parentId?: string | null;
  groupWidth?: number;
  groupHeight?: number;
  matrix?: Matrix;
  curves?: { c1: Point; c2: Point; end: Point }[] | null;
};
export type Point = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverse(m: Matrix): Matrix {
  const d = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
export const transformPoint = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function gradientStops(g: Gradient) {
  return g.stops
    ? [...g.stops].sort((a, b) => a.offset - b.offset)
    : [
        { offset: 0, color: g.from, opacity: 1 },
        { offset: 1, color: g.to, opacity: 1 },
      ];
}

// Shared validation for persisted artwork and the MCP catalogue.
const { z } = require('zod/v4');
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const bounded = (a, b) => z.number().min(a).max(b);
const point = z.strictObject({ x: bounded(0, 1), y: bounded(0, 1) });
const gradient = z
  .strictObject({
    from: hex,
    to: hex,
    type: z.enum(['linear', 'radial']).optional(),
    angle: bounded(-360, 360).optional(),
    cx: bounded(0, 1).optional(),
    cy: bounded(0, 1).optional(),
    radius: bounded(0.01, 2).optional(),
    stops: z
      .array(z.strictObject({ offset: bounded(0, 1), color: hex, opacity: bounded(0, 1) }))
      .min(2)
      .max(16)
      .optional(),
  })
  .nullable();
const shadow = z.strictObject({
  type: z.enum(['drop', 'inner', 'glow']),
  color: hex,
  opacity: bounded(0, 1),
  blur: bounded(0, 20),
  x: bounded(-50, 50),
  y: bounded(-50, 50),
});
const effects = z
  .strictObject({
    blur: bounded(0, 20).optional(),
    backgroundBlur: bounded(0, 20).optional(),
    shadows: z.array(shadow).max(4).optional(),
  })
  .nullable();
const mask = z
  .strictObject({
    shape: z.enum(['rectangle', 'ellipse', 'triangle', 'diamond', 'star', 'heart', 'hexagon']),
    feather: bounded(0, 20).optional(),
    fade: z.enum(['none', 'left', 'right', 'top', 'bottom', 'radial']).optional(),
  })
  .nullable();
const texture = z
  .strictObject({
    type: z.enum(['image', 'grain', 'paper', 'stone', 'metal']),
    image: z
      .string()
      .max(14_000_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
    seed: z.number().int().min(0).max(65535),
    scale: bounded(0.1, 20),
    opacity: bounded(0, 1),
  })
  .refine((t) => t.type !== 'image' || !!t.image, 'Embed an image for a photo texture.')
  .nullable();
const adjustments = z
  .strictObject({
    exposure: bounded(-4, 4).optional(),
    contrast: bounded(0, 3).optional(),
    saturation: bounded(0, 3).optional(),
    temperature: bounded(-1, 1).optional(),
    sharpen: bounded(0, 2).optional(),
  })
  .nullable();
const appearance = {
  name: z.string().max(100).optional(),
  repeat: z
    .strictObject({
      mode: z.enum(['grid', 'radial', 'scatter']),
      count: z.number().int().min(1).max(200),
      columns: z.number().int().min(1).max(200),
      spacingX: bounded(-250, 250),
      spacingY: bounded(-250, 250),
      angle: bounded(-360, 360),
      seed: z.number().int().min(0).max(65535),
      rotationJitter: bounded(0, 180),
      opacityJitter: bounded(0, 1),
    })
    .nullable()
    .optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  textPath: z
    .strictObject({
      pathId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
      side: z.enum(['inner', 'middle', 'outer']),
      offset: bounded(0, 100),
    })
    .nullable()
    .optional(),
  gradient: gradient.optional(),
  effects: effects.optional(),
  mask: mask.optional(),
  texture: texture.optional(),
  adjustments: adjustments.optional(),
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light']).optional(),
  parentId: z
    .string()
    .regex(/^[a-zA-Z0-9-]{1,80}$/)
    .nullable()
    .optional(),
  groupWidth: bounded(0.1, 500).optional(),
  groupHeight: bounded(0.1, 500).optional(),
  matrix: z.tuple(Array.from({ length: 6 }, () => bounded(-2000, 2000))).optional(),
  curves: z
    .array(z.strictObject({ c1: point, c2: point, end: point }))
    .min(1)
    .max(256)
    .nullable()
    .optional(),
};
const schema = z.object(appearance);
exports.appearance = appearance;
exports.parseAppearance = (value) =>
  Object.fromEntries(Object.entries(schema.parse(value)).filter(([, v]) => v != null));

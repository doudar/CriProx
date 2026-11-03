import { newDesign, newElement, validateStickerDesign, type StickerDesign } from './sticker-design';
import { designOutputBounds } from './sticker-contours';

/** Uses the same units as validation: data URL characters, not decoded bytes. */
export function preflightDesign(input: { canvas?: any; elements?: any[]; design?: StickerDesign }) {
  const base = { ...(input.design ?? newDesign()), ...input.canvas };
  const d = {
    ...base,
    ...input.canvas,
    elements: input.elements
      ? input.elements.map((e) => ({ ...newElement(e.kind ?? 'shape', base), ...e }))
      : base.elements,
  } as StickerDesign;
  const checks: {
    metric: string;
    current: number;
    min?: number;
    max: number;
    ok: boolean;
    suggestion?: string;
  }[] = [];
  const check = (metric: string, current: number, max: number, suggestion: string, min = 0) => {
    checks.push({
      metric,
      current,
      min,
      max,
      ok: Number.isFinite(current) && current >= min && current <= max,
      ...(!(Number.isFinite(current) && current >= min && current <= max) ? { suggestion } : {}),
    });
  };
  for (const axis of ['width', 'height'] as const)
    check(
      `canvas.${axis}Mm`,
      d[axis],
      250,
      'Use a 10–250 mm canvas; scale layer positions and sizes by the same ratio to retain proportions.',
      10,
    );
  check(
    'layers',
    d.elements.length,
    500,
    'Remove unused layers or combine artwork into fewer paths; grouping alone does not reduce layer count.',
  );
  check(
    'renderedCopies',
    d.elements.reduce((total, e) => total + (e.repeat?.count ?? 1), 0),
    2000,
    'Reduce repeat counts or remove layers until at most 2,000 copies render.',
  );
  let chars = d.reference?.image.length ?? 0,
    points = 0;
  for (const [index, e] of d.elements.entries()) {
    for (const image of [e.kind === 'image' ? e.image : undefined, e.texture?.image]) {
      if (typeof image !== 'string') continue;
      chars += image.length;
      check(
        `elements[${index}].imageDataUrlCharacters`,
        image.length,
        14_000_000,
        `Re-encode or downsample this image; try linear pixel scale ${Math.min(1, Math.sqrt(14_000_000 / image.length) * 0.9).toFixed(3)} and recheck. Compression varies.`,
      );
    }
    if (e.kind === 'draw') {
      const count = e.points?.length ?? 0,
        curves = e.curves?.length ?? 0;
      points += count + curves * 3;
      check(
        `elements[${index}].points`,
        count,
        2000,
        'Simplify this path to at most 2,000 normalized points.',
        2,
      );
      check(
        `elements[${index}].curveSegments`,
        curves,
        256,
        'Simplify this path to at most 256 cubic segments.',
      );
    }
  }
  check(
    'embeddedDataUrlCharacters',
    chars,
    40_000_000,
    'Downsample or remove embedded images/textures until their combined data URL length is at most 40,000,000 characters.',
  );
  check(
    'totalPointsIncludingCurveControls',
    points,
    100_000,
    'Simplify paths; each cubic segment counts as three additional points.',
  );
  let validationError: string | undefined, render: object | undefined;
  try {
    const clean = validateStickerDesign(d),
      bounds = designOutputBounds(clean);
    const scale = Math.min(600 / 25.4, Math.sqrt(24_000_000 / (bounds.width * bounds.height)));
    render = {
      boundsMm: bounds,
      widthPixels: Math.ceil(bounds.width * scale),
      heightPixels: Math.ceil(bounds.height * scale),
      effectiveDpi: scale * 25.4,
      targetDpi: 600,
      targetPixelBudget: 24_000_000,
      outputDataUrlCharactersMax: 14_000_000,
      note: 'Pixel dimensions round up. PNG compressed size is unknown until rendering; validation success does not guarantee output fits. Reduce image detail or dimensions if the rendered PNG exceeds the limit.',
    };
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }
  return { ok: !validationError && checks.every((c) => c.ok), checks, validationError, render };
}

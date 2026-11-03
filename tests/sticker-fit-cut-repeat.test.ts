import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { newDesign, newElement, designSvg, type StickerDesign } from '../src/lib/sticker-design';
import { fitDesignCut } from '../src/lib/sticker-fit-cut';
import { DEFAULT_REPEAT } from '../src/lib/design-repeat';

// Supply only the browser image/canvas boundary; fitDesignCut still builds and
// rasterizes its real SVG, reads its pixels and constructs the fitted contour.
async function fitWithCanvas(design: StickerDesign) {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  class BrowserImage {
    src = '';
    image!: Image;
    async decode() {
      this.image = await loadImage(Buffer.from(await (await fetch(this.src)).arrayBuffer()));
    }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: BrowserImage });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      fonts: { ready: Promise.resolve() },
      createElement: () => {
        const canvas = createCanvas(1, 1);
        const context = canvas.getContext('2d');
        const drawImage = context.drawImage.bind(context);
        context.drawImage = ((image: BrowserImage, ...args: number[]) =>
          Reflect.apply(drawImage, context, [
            image.image,
            ...args,
          ])) as unknown as typeof context.drawImage;
        return canvas;
      },
    },
  });
  try {
    return await fitDesignCut(design, { borderWidth: 1, strokeWidth: 0, strokeColor: '#000000' });
  } finally {
    for (const [key, descriptor] of [
      ['document', documentDescriptor],
      ['Image', imageDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

async function pixels(design: StickerDesign, artworkOnly: boolean) {
  // Use the entire design rather than the cut bounds so clipped-away copies
  // cannot silently disappear from both sides of the comparison.
  const canvas = createCanvas(1200, 1200);
  const context = canvas.getContext('2d');
  const image = await loadImage(
    Buffer.from(
      designSvg(design, {
        artworkOnly,
        bounds: { x: 0, y: 0, width: 200, height: 200 },
      }),
    ),
  );
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

for (const mode of ['grid', 'radial', 'scatter'] as const) {
  for (const nested of [false, true]) {
    test(`Fit Cut preserves every ${mode} copy${nested ? ' inside transformed nested groups' : ''}`, async () => {
      const design = newDesign(200, 200);
      const shape = {
        ...newElement('shape', design),
        shape: 'rectangle' as const,
        x: 40,
        y: 40,
        width: 7,
        height: 4,
        rotation: 17,
        fill: '#000000',
        strokeWidth: 0,
        repeat: {
          ...DEFAULT_REPEAT,
          mode,
          count: 8,
          columns: 4,
          spacingX: 18,
          spacingY: 16,
          angle: 45,
          rotationJitter: 29,
        },
      };
      if (nested) {
        const outer = {
          ...newElement('group', design),
          id: 'outer',
          x: 130,
          y: 50,
          width: 12,
          height: 9,
          groupWidth: 10,
          groupHeight: 10,
          rotation: 13,
        };
        const inner = {
          ...newElement('group', design),
          id: 'inner',
          parentId: outer.id,
          x: 0,
          y: 0,
          width: 9,
          height: 11,
          groupWidth: 10,
          groupHeight: 10,
          rotation: -23,
          flipX: true,
        };
        design.elements = [outer, inner, { ...shape, parentId: inner.id }];
      } else design.elements = [shape];
      const fitted = await fitWithCanvas(design);
      const before = await pixels(fitted, true),
        after = await pixels(fitted, false);
      let opaque = 0,
        lost = 0;
      for (let i = 3; i < before.length; i += 4) {
        if (before[i] > 250) {
          opaque++;
          if (after[i] < 250) lost++;
        }
      }
      assert.ok(opaque > 3000, `expected visible repeated artwork, got ${opaque} pixels`);
      assert.equal(lost, 0, `${lost} opaque artwork pixels were clipped by the fitted cut`);
      assert.equal(fitted.elements.filter((e) => e.operation === 'cut').length, 1);
    });
  }
}

/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs';
import Upscaler from 'upscaler';
import model from '@upscalerjs/esrgan-thick/4x';

declare const self: DedicatedWorkerGlobalScope;

let engine: InstanceType<typeof Upscaler> | undefined;

self.onmessage = async ({
  data,
}: MessageEvent<{ id: string; original: ImageBitmap; name: string }>) => {
  const { id, original, name } = data;
  const progress = (text: string) => self.postMessage({ id, type: 'progress', text });
  let input: tf.Tensor3D | undefined;
  let output: tf.Tensor3D | undefined;
  try {
    engine ??= new Upscaler({ model });
    const sourceCanvas = new OffscreenCanvas(original.width, original.height);
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) throw new Error('Could not read the artwork image.');
    sourceContext.drawImage(original, 0, 0);
    const sourcePixels = sourceContext.getImageData(0, 0, original.width, original.height);
    const rgb = new Uint8Array(original.width * original.height * 3);
    for (
      let sourceIndex = 0, targetIndex = 0;
      sourceIndex < sourcePixels.data.length;
      sourceIndex += 4
    ) {
      rgb[targetIndex++] = sourcePixels.data[sourceIndex];
      rgb[targetIndex++] = sourcePixels.data[sourceIndex + 1];
      rgb[targetIndex++] = sourcePixels.data[sourceIndex + 2];
    }
    sourceCanvas.width = sourceCanvas.height = 0;

    input = tf.tensor3d(rgb, [original.height, original.width, 3]);
    let lastPercent = -1;
    output = await engine.upscale(input, {
      output: 'tensor',
      progressOutput: 'tensor',
      patchSize: 64,
      padding: 8,
      progress: (fraction: number) => {
        const percent = Math.floor(fraction * 100);
        if (percent >= lastPercent + 5 || percent === 100) {
          lastPercent = percent;
          progress(`Upscaling ${name}… ${percent}%`);
        }
      },
    });
    const [height, width] = output.shape;
    const values = await output.data();
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the upscaled card image.');

    // Resize source alpha separately: the RGB model cannot preserve the artwork's
    // transparent rounded corners on its own.
    context.drawImage(original, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < values.length; sourceIndex += 3) {
      image.data[targetIndex++] = Math.max(0, Math.min(255, Math.round(values[sourceIndex])));
      image.data[targetIndex++] = Math.max(0, Math.min(255, Math.round(values[sourceIndex + 1])));
      image.data[targetIndex++] = Math.max(0, Math.min(255, Math.round(values[sourceIndex + 2])));
      targetIndex++; // leave alpha as rendered from the source
    }
    context.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.98 });
    canvas.width = canvas.height = 0;
    self.postMessage({ id, type: 'complete', blob });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    input?.dispose();
    output?.dispose();
    original.close();
  }
};

export {};

import { get, set } from 'idb-keyval';

// The worker and its model are constructed only after an explicit opt-in.
const MODEL_ID = 'esrgan-thick-4x-1.0.0';
export type UpscaleBackend = 'built-in' | 'upscayl';
let upscaylRunner: ((id: string, input: Uint8Array) => Promise<Uint8Array>) | undefined;
export function setUpscaylRunner(runner: typeof upscaylRunner) {
  upscaylRunner = runner;
}
let worker: Worker | undefined;
const pending = new Map<
  string,
  {
    resolve: (blob: Blob) => void;
    reject: (error: Error) => void;
    progress: (text: string) => void;
  }
>();

function upscaleWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/upscale.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({
    data,
  }: MessageEvent<
    | { id: string; type: 'progress'; text: string }
    | { id: string; type: 'complete'; blob: Blob }
    | { id: string; type: 'error'; message: string }
  >) => {
    const task = pending.get(data.id);
    if (!task) return;
    if (data.type === 'progress') task.progress(data.text);
    else {
      pending.delete(data.id);
      if (data.type === 'complete') task.resolve(data.blob);
      else task.reject(new Error(data.message));
    }
  };
  worker.onerror = (event) => {
    for (const task of pending.values())
      task.reject(new Error(event.message || 'Upscale worker failed.'));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

export async function upscaleArtwork(
  source: string,
  original: ImageBitmap,
  progress: (text: string) => void,
  name: string,
  backend: UpscaleBackend = 'built-in',
  upscaylCacheKey = '',
): Promise<ImageBitmap> {
  const key =
    backend === 'upscayl'
      ? `upscaled:ultramix-balanced-4x:${upscaylCacheKey}:${source}`
      : `upscaled:${MODEL_ID}:${source}`;
  const cached = await get<Blob>(key).catch(() => undefined);
  if (cached) return createImageBitmap(cached);

  if (backend === 'upscayl') {
    if (!upscaylRunner || !upscaylCacheKey) throw new Error('Upscayl is unavailable.');
    progress(`Upscaling ${name} with Upscayl…`);
    const canvas = new OffscreenCanvas(original.width, original.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read the artwork image.');
    context.drawImage(original, 0, 0);
    const input = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    canvas.width = canvas.height = 0;
    const output = await upscaylRunner(crypto.randomUUID(), input);
    const enhanced = await createImageBitmap(
      new Blob([new Uint8Array(output)], { type: 'image/png' }),
    );
    try {
      // Upscayl's RGB model may discard transparency. Retain the source corners.
      const merged = new OffscreenCanvas(enhanced.width, enhanced.height);
      const mergedContext = merged.getContext('2d');
      if (!mergedContext) throw new Error('Could not create the upscaled artwork image.');
      mergedContext.drawImage(original, 0, 0, merged.width, merged.height);
      mergedContext.globalCompositeOperation = 'source-in';
      mergedContext.drawImage(enhanced, 0, 0);
      const blob = await merged.convertToBlob({ type: 'image/png' });
      merged.width = merged.height = 0;
      await set(key, blob).catch(() => {});
      return createImageBitmap(blob);
    } finally {
      enhanced.close();
    }
  }

  progress(`Loading optional upscale model for ${name}…`);
  const id = crypto.randomUUID();
  const blob = await new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    try {
      upscaleWorker().postMessage({ id, original, name }, [original]);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
  await set(key, blob).catch(() => {});
  return createImageBitmap(blob);
}

import { createStore, promisifyRequest, type UseStore } from 'idb-keyval';

export const PREVIEW_DISK_LIMIT = 128 * 1024 * 1024;
const PREVIEW_MEMORY_LIMIT = 32 * 1024 * 1024;
const PREVIEW_ENTRY_LIMIT = 1024;
const INDEX_KEY = 'index';

type CacheRecord = { source: string; bytes: number };
export type PreviewImageStorage = {
  read: (source: string) => Promise<Blob | undefined>;
  write: (source: string, blob: Blob) => Promise<void>;
};

// Records are ordered from least to most recently used. The index contains
// sizes only, so eviction never reads all cached image blobs into memory.
export function previewCacheEvictions(
  records: CacheRecord[],
  byteLimit = PREVIEW_DISK_LIMIT,
  entryLimit = PREVIEW_ENTRY_LIMIT,
) {
  let bytes = records.reduce((sum, record) => sum + record.bytes, 0);
  let count = 0;
  while (bytes > byteLimit || records.length - count > entryLimit) bytes -= records[count++].bytes;
  return { keep: records.slice(count), remove: records.slice(0, count) };
}

export function indexedDbPreviewStorage(
  store: UseStore = createStore('skarix-preview-images-v1', 'images'),
): PreviewImageStorage {
  return {
    async read(source) {
      let blob: Blob | undefined;
      await store('readwrite', (images) => {
        const complete = promisifyRequest(images.transaction);
        const index = images.get(INDEX_KEY);
        index.onsuccess = () => {
          const image = images.get(source);
          image.onsuccess = () => {
            blob = image.result;
            if (blob) {
              const records: CacheRecord[] = index.result || [];
              images.put(
                [
                  ...records.filter((record) => record.source !== source),
                  { source, bytes: blob.size },
                ],
                INDEX_KEY,
              );
            }
          };
        };
        return complete;
      });
      return blob;
    },
    async write(source, blob) {
      if (blob.size > PREVIEW_DISK_LIMIT) return;
      await store('readwrite', (images) => {
        const complete = promisifyRequest(images.transaction);
        const index = images.get(INDEX_KEY);
        index.onsuccess = () => {
          const records: CacheRecord[] = index.result || [];
          const { keep, remove } = previewCacheEvictions([
            ...records.filter((record) => record.source !== source),
            { source, bytes: blob.size },
          ]);
          for (const record of remove) images.delete(record.source);
          images.put(blob, source);
          images.put(keep, INDEX_KEY);
        };
        return complete;
      });
    },
  };
}

async function fetchPreview(source: string): Promise<Blob> {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not load card preview.');
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith('image/'))
    throw new Error('The card preview is not an image.');
  return blob;
}

export class PreviewImageCache {
  private memory = new Map<string, Blob>();
  private memoryBytes = 0;
  private pending = new Map<string, Promise<Blob>>();
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(
    private storage: PreviewImageStorage = indexedDbPreviewStorage(),
    private download: (source: string) => Promise<Blob> = fetchPreview,
    private memoryLimit = PREVIEW_MEMORY_LIMIT,
    private concurrency = 4,
  ) {}

  get(source: string): Promise<Blob> {
    const cached = this.memory.get(source);
    if (cached) {
      this.memory.delete(source);
      this.memory.set(source, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(source);
    if (pending) return pending;
    const load = this.load(source).finally(() => this.pending.delete(source));
    this.pending.set(source, load);
    return load;
  }

  private async load(source: string): Promise<Blob> {
    if (this.active >= this.concurrency)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      // A disabled or full local database must not prevent image viewing.
      let blob = await this.storage.read(source).catch(() => undefined);
      if (!blob) {
        blob = await this.download(source);
        await this.storage.write(source, blob).catch(() => {});
      }
      this.memory.set(source, blob);
      this.memoryBytes += blob.size;
      while (this.memoryBytes > this.memoryLimit || this.memory.size > PREVIEW_ENTRY_LIMIT) {
        const oldest = this.memory.keys().next().value!;
        this.memoryBytes -= this.memory.get(oldest)!.size;
        this.memory.delete(oldest);
      }
      return blob;
    } finally {
      const resume = this.waiting.shift();
      if (resume) resume();
      else this.active--;
    }
  }
}

export const previewImageCache = new PreviewImageCache();

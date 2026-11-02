import { get as read, set, del as remove } from 'idb-keyval';
export { set } from 'idb-keyval';

// Old identifiers are read only for migration; all new writes use Skarix names.
function legacyKey(key: IDBValidKey) {
  return typeof key === 'string' && /^skarix[-:]/.test(key)
    ? key.replace(/^skarix/, 'criprox')
    : key;
}
export async function get<T = unknown>(key: IDBValidKey): Promise<T | undefined> {
  const current = await read<T>(key);
  if (current !== undefined) return current;
  const oldKey = legacyKey(key);
  if (oldKey === key) return undefined;
  const previous = await read<T>(oldKey);
  if (previous !== undefined) await set(key, previous);
  return previous;
}
export async function del(key: IDBValidKey) {
  await remove(key);
  const oldKey = legacyKey(key);
  if (oldKey !== key) await remove(oldKey);
}
export function readLocalSetting(key: string) {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const oldKey = legacyKey(key) as string;
  if (oldKey === key) return null;
  const previous = localStorage.getItem(oldKey);
  if (previous !== null) localStorage.setItem(key, previous);
  return previous;
}

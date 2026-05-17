const store = new Map<string, { value: unknown; expires: number }>();

export const CACHE_TTL_MS = {
  indicators: 30 * 60_000,
  news: 60 * 60_000,
  sentiment: 60 * 60_000,
  analysis: 15 * 60_000,
  ccl: 10 * 60_000,
};

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { store.delete(key); return null; }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return Promise.resolve(hit);
  return fn().then(v => { cacheSet(key, v, ttlMs); return v; });
}

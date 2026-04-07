interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Read cached data if it exists and hasn't expired. Returns null otherwise. */
export function getCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > maxAgeMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/** Store data in localStorage with a timestamp. */
export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Silently ignore — quota exceeded or private browsing
  }
}

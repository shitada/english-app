import { useCallback, useEffect, useState } from 'react';

/**
 * useFavorites — persists a small set of "pinned" card keys to localStorage.
 *
 * Used by the Quick Practice Hub to let users star their favorite practice
 * cards and surface them in a dedicated Favorites tab.
 *
 * Pure helpers (`loadFavorites`, `saveFavorites`, `toggleFavoriteInList`) are
 * exported separately to make the behaviour straightforward to unit-test
 * without needing a DOM renderer.
 */

export const FAVORITES_STORAGE_KEY = 'quick-practice-favorites';

/** Read favorites from localStorage. Returns [] on missing/malformed data. */
export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: keep only strings, dedupe, preserve order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist favorites to localStorage. Failures are silently ignored. */
export function saveFavorites(keys: string[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

/** Pure: toggle membership of `key` in `keys`. Returns a new array. */
export function toggleFavoriteInList(keys: string[], key: string): string[] {
  if (keys.includes(key)) return keys.filter(k => k !== key);
  return [...keys, key];
}

export interface UseFavoritesResult {
  favorites: string[];
  isFavorite: (key: string) => boolean;
  toggle: (key: string) => void;
}

export function useFavorites(): UseFavoritesResult {
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const toggle = useCallback((key: string) => {
    setFavorites(prev => toggleFavoriteInList(prev, key));
  }, []);

  const isFavorite = useCallback(
    (key: string) => favorites.includes(key),
    [favorites],
  );

  return { favorites, isFavorite, toggle };
}

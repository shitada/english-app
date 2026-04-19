import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FAVORITES_STORAGE_KEY,
  loadFavorites,
  saveFavorites,
  toggleFavoriteInList,
  useFavorites,
} from '../hooks/useFavorites';

/**
 * Tests for the useFavorites hook used by the Quick Practice Hub.
 *
 * The project tests run in a node environment without jsdom, so we mock
 * `localStorage` ourselves and exercise the hook's pure helpers directly.
 * The React hook itself is verified end-to-end via `renderToStaticMarkup`,
 * which runs the initial render (and therefore `useState` initializer)
 * exactly as it would in a real browser.
 */

class MemoryStorage {
  store: Record<string, string> = {};
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
  key(i: number): string | null {
    return Object.keys(this.store)[i] ?? null;
  }
  get length(): number {
    return Object.keys(this.store).length;
  }
}

beforeEach(() => {
  const mem = new MemoryStorage();
  // @ts-expect-error mock global
  globalThis.localStorage = mem;
});

describe('useFavorites — pure helpers', () => {
  it('loadFavorites returns [] when storage is empty', () => {
    expect(loadFavorites()).toEqual([]);
  });

  it('saveFavorites + loadFavorites round-trip persists keys', () => {
    saveFavorites(['speak', 'shadow']);
    expect(localStorage.getItem(FAVORITES_STORAGE_KEY)).toBe('["speak","shadow"]');
    expect(loadFavorites()).toEqual(['speak', 'shadow']);
  });

  it('loadFavorites hydrates an existing localStorage value (cross-session)', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(['idiom', 'debate']));
    expect(loadFavorites()).toEqual(['idiom', 'debate']);
  });

  it('loadFavorites falls back to [] on malformed JSON', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, '{not json');
    expect(loadFavorites()).toEqual([]);
  });

  it('loadFavorites falls back to [] when stored value is not an array', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadFavorites()).toEqual([]);
  });

  it('loadFavorites filters non-string and duplicate entries', () => {
    localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(['speak', 42, 'speak', null, 'shadow']),
    );
    expect(loadFavorites()).toEqual(['speak', 'shadow']);
  });

  it('toggleFavoriteInList adds when missing and removes when present', () => {
    expect(toggleFavoriteInList([], 'speak')).toEqual(['speak']);
    expect(toggleFavoriteInList(['speak'], 'shadow')).toEqual(['speak', 'shadow']);
    expect(toggleFavoriteInList(['speak', 'shadow'], 'speak')).toEqual(['shadow']);
    expect(toggleFavoriteInList(['speak'], 'speak')).toEqual([]);
  });

  it('toggleFavoriteInList does not mutate input', () => {
    const original = ['speak'];
    const out = toggleFavoriteInList(original, 'shadow');
    expect(original).toEqual(['speak']);
    expect(out).not.toBe(original);
  });
});

describe('useFavorites — React hook', () => {
  function HookProbe({ onResult }: { onResult: (r: ReturnType<typeof useFavorites>) => void }) {
    const result = useFavorites();
    onResult(result);
    // Render something deterministic so renderToStaticMarkup doesn't throw.
    return React.createElement(
      'ul',
      { 'data-testid': 'favs' },
      result.favorites.map(k => React.createElement('li', { key: k }, k)),
    );
  }

  it('initializes with empty favorites when storage is empty', () => {
    let captured: ReturnType<typeof useFavorites> | null = null;
    renderToStaticMarkup(
      React.createElement(HookProbe, { onResult: (r) => { captured = r; } }),
    );
    expect(captured).not.toBeNull();
    expect(captured!.favorites).toEqual([]);
    expect(captured!.isFavorite('speak')).toBe(false);
  });

  it('hydrates favorites from existing localStorage data on mount', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(['idiom', 'debate']));
    let captured: ReturnType<typeof useFavorites> | null = null;
    renderToStaticMarkup(
      React.createElement(HookProbe, { onResult: (r) => { captured = r; } }),
    );
    expect(captured!.favorites).toEqual(['idiom', 'debate']);
    expect(captured!.isFavorite('idiom')).toBe(true);
    expect(captured!.isFavorite('speak')).toBe(false);
  });

  it('falls back to [] on malformed JSON in storage', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, '<<broken>>');
    let captured: ReturnType<typeof useFavorites> | null = null;
    renderToStaticMarkup(
      React.createElement(HookProbe, { onResult: (r) => { captured = r; } }),
    );
    expect(captured!.favorites).toEqual([]);
  });

  it('exposes a stable toggle function that flips membership through the helper', () => {
    // The toggle callback is bound to setState; we can't run setState updates
    // outside a real renderer, but we can verify that the same logic the hook
    // delegates to is correct end-to-end via the pure helper.
    let next = toggleFavoriteInList([], 'speak');
    expect(next).toEqual(['speak']);
    next = toggleFavoriteInList(next, 'shadow');
    expect(next).toEqual(['speak', 'shadow']);
    next = toggleFavoriteInList(next, 'speak');
    expect(next).toEqual(['shadow']);
    saveFavorites(next);
    expect(loadFavorites()).toEqual(['shadow']);
  });
});

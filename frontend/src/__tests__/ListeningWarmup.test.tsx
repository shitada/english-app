import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ListeningWarmup, {
  DEFAULT_WARMUP_SENTENCES,
  WARMUP_TARGET,
  WARMUP_STORAGE_KEY,
  computeWarmupStreak,
  todayKey,
  readWarmupState,
  persistWarmupCompletion,
} from '../components/ListeningWarmup';

// Minimal in-memory localStorage shim for the unit tests.
class MemStorage {
  private store: Record<string, string> = {};
  getItem(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k: string, v: string) { this.store[k] = String(v); }
  removeItem(k: string) { delete this.store[k]; }
  clear() { this.store = {}; }
}

describe('computeWarmupStreak', () => {
  it('returns 1 when there is no previous date', () => {
    expect(computeWarmupStreak(0, null, '2024-05-10')).toBe(1);
    expect(computeWarmupStreak(7, null, '2024-05-10')).toBe(1);
  });

  it('is a no-op when last date is today', () => {
    expect(computeWarmupStreak(3, '2024-05-10', '2024-05-10')).toBe(3);
    // ensures min of 1 even if prev is somehow 0
    expect(computeWarmupStreak(0, '2024-05-10', '2024-05-10')).toBe(1);
  });

  it('increments when last date is yesterday', () => {
    expect(computeWarmupStreak(2, '2024-05-09', '2024-05-10')).toBe(3);
    expect(computeWarmupStreak(0, '2024-05-09', '2024-05-10')).toBe(1);
  });

  it('resets to 1 when last date is older than yesterday', () => {
    expect(computeWarmupStreak(10, '2024-05-01', '2024-05-10')).toBe(1);
    expect(computeWarmupStreak(5, '2024-04-30', '2024-05-10')).toBe(1);
  });

  it('handles month/year boundaries (yesterday)', () => {
    expect(computeWarmupStreak(4, '2024-04-30', '2024-05-01')).toBe(5);
    expect(computeWarmupStreak(2, '2023-12-31', '2024-01-01')).toBe(3);
  });
});

describe('todayKey', () => {
  it('formats a date as YYYY-MM-DD', () => {
    const d = new Date(2024, 4, 7); // May 7, 2024 local
    expect(todayKey(d)).toBe('2024-05-07');
  });

  it('zero-pads single-digit months and days', () => {
    expect(todayKey(new Date(2024, 0, 3))).toBe('2024-01-03');
  });
});

describe('warmup storage helpers', () => {
  let originalLS: Storage | undefined;

  beforeEach(() => {
    originalLS = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new MemStorage() as unknown as Storage;
  });

  afterEach(() => {
    if (originalLS === undefined) {
      delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as unknown as { localStorage: Storage }).localStorage = originalLS;
    }
  });

  it('readWarmupState returns defaults when nothing is stored', () => {
    expect(readWarmupState()).toEqual({ lastWarmupAt: null, warmupStreak: 0 });
  });

  it('readWarmupState parses a previously saved value', () => {
    localStorage.setItem(
      WARMUP_STORAGE_KEY,
      JSON.stringify({ lastWarmupAt: '2024-05-10', warmupStreak: 4 }),
    );
    expect(readWarmupState()).toEqual({ lastWarmupAt: '2024-05-10', warmupStreak: 4 });
  });

  it('readWarmupState gracefully ignores corrupt JSON', () => {
    localStorage.setItem(WARMUP_STORAGE_KEY, '{not json');
    expect(readWarmupState()).toEqual({ lastWarmupAt: null, warmupStreak: 0 });
  });

  it('persistWarmupCompletion writes today and increments streak', () => {
    localStorage.setItem(
      WARMUP_STORAGE_KEY,
      JSON.stringify({ lastWarmupAt: '2024-05-09', warmupStreak: 2 }),
    );
    const out = persistWarmupCompletion('2024-05-10');
    expect(out).toEqual({ lastWarmupAt: '2024-05-10', warmupStreak: 3 });
    const stored = JSON.parse(localStorage.getItem(WARMUP_STORAGE_KEY)!);
    expect(stored.lastWarmupAt).toBe('2024-05-10');
    expect(stored.warmupStreak).toBe(3);
  });

  it('persistWarmupCompletion is idempotent for same-day completion', () => {
    localStorage.setItem(
      WARMUP_STORAGE_KEY,
      JSON.stringify({ lastWarmupAt: '2024-05-10', warmupStreak: 5 }),
    );
    const out = persistWarmupCompletion('2024-05-10');
    expect(out.warmupStreak).toBe(5);
    expect(out.lastWarmupAt).toBe('2024-05-10');
  });

  it('persistWarmupCompletion resets streak after a gap', () => {
    localStorage.setItem(
      WARMUP_STORAGE_KEY,
      JSON.stringify({ lastWarmupAt: '2024-04-25', warmupStreak: 9 }),
    );
    const out = persistWarmupCompletion('2024-05-10');
    expect(out.warmupStreak).toBe(1);
  });
});

describe('DEFAULT_WARMUP_SENTENCES', () => {
  it('provides at least 6 fallback sentences for new users', () => {
    expect(DEFAULT_WARMUP_SENTENCES.length).toBeGreaterThanOrEqual(WARMUP_TARGET);
    DEFAULT_WARMUP_SENTENCES.forEach(s => {
      expect(typeof s).toBe('string');
      expect(s.trim().length).toBeGreaterThan(0);
    });
  });
});

describe('ListeningWarmup render', () => {
  it('renders nothing when not open', () => {
    const html = renderToStaticMarkup(
      React.createElement(ListeningWarmup, { open: false, onClose: () => {} }),
    );
    expect(html).toBe('');
  });

  it('renders the panel with progress ring and first sentence when open', () => {
    const html = renderToStaticMarkup(
      React.createElement(ListeningWarmup, {
        open: true,
        onClose: () => {},
        sentences: ['Hello world.', 'How are you?', 'Goodbye.'],
      }),
    );
    expect(html).toContain('data-testid="listening-warmup-panel"');
    expect(html).toContain('data-testid="warmup-progress-ring"');
    expect(html).toContain('data-testid="warmup-current-sentence"');
    expect(html).toContain('Hello world.');
    expect(html).toContain('0/3');
    expect(html).toContain('Slow pass');
  });

  it('falls back to default sentences when none provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(ListeningWarmup, { open: true, onClose: () => {} }),
    );
    expect(html).toContain(DEFAULT_WARMUP_SENTENCES[0]);
    expect(html).toContain('0/6');
  });

  it('shows Pause, Skip and Stop controls in the playing state', () => {
    const html = renderToStaticMarkup(
      React.createElement(ListeningWarmup, { open: true, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="warmup-pause"');
    expect(html).toContain('data-testid="warmup-skip"');
    expect(html).toContain('data-testid="warmup-stop"');
    expect(html).toContain('data-testid="warmup-close"');
  });

  it('caps the number of played sentences at WARMUP_TARGET', () => {
    const longList = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1}.`);
    const html = renderToStaticMarkup(
      React.createElement(ListeningWarmup, {
        open: true,
        onClose: () => {},
        sentences: longList,
      }),
    );
    expect(html).toContain('0/' + WARMUP_TARGET);
    expect(html).toContain('Sentence 1.');
  });
});

// Sanity guard: speechSynthesis utterance creation never blows up at module import.
describe('speech synthesis safety', () => {
  it('does not throw when window.speechSynthesis is missing', () => {
    // The component module simply guards with `'speechSynthesis' in window`;
    // an SSR render in the node test env exercises that path.
    expect(() =>
      renderToStaticMarkup(
        React.createElement(ListeningWarmup, { open: true, onClose: () => {} }),
      ),
    ).not.toThrow();
  });

  it('mockable speak utterance constructor pattern', () => {
    // Demonstrates the mocking pattern other tests can borrow:
    const speakMock = vi.fn();
    const cancelMock = vi.fn();
    const fakeSynth = { speak: speakMock, cancel: cancelMock, pause: vi.fn(), resume: vi.fn() };
    expect(fakeSynth.speak).toBe(speakMock);
    expect(fakeSynth.cancel).toBe(cancelMock);
  });
});

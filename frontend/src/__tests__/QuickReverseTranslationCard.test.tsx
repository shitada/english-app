import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isSupported: true,
    volume: 1,
    setVolume: vi.fn(),
    rate: 1,
    setRate: vi.fn(),
  }),
}));

vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    transcript: '',
    interimTranscript: '',
    isListening: false,
    isSupported: true,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

import QuickReverseTranslationCard, {
  REVERSE_TRANSLATION_PROMPTS,
  filterPromptsByDifficulty,
  sampleUniquePrompts,
  filterMissedPrompts,
  computeSummaryStats,
  tokenDiff,
  type AttemptRecord,
} from '../components/QuickReverseTranslationCard';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('REVERSE_TRANSLATION_PROMPTS bank', () => {
  it('has at least 40 prompts split between beginner and intermediate', () => {
    expect(REVERSE_TRANSLATION_PROMPTS.length).toBeGreaterThanOrEqual(40);
    const beg = filterPromptsByDifficulty(REVERSE_TRANSLATION_PROMPTS, 'beginner');
    const inter = filterPromptsByDifficulty(REVERSE_TRANSLATION_PROMPTS, 'intermediate');
    expect(beg.length).toBeGreaterThanOrEqual(10);
    expect(inter.length).toBeGreaterThanOrEqual(10);
  });

  it('has unique ids', () => {
    const ids = REVERSE_TRANSLATION_PROMPTS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has short English prompts (5–14 words)', () => {
    for (const p of REVERSE_TRANSLATION_PROMPTS) {
      const w = p.en.trim().split(/\s+/).length;
      expect(w).toBeGreaterThanOrEqual(3);
      expect(w).toBeLessThanOrEqual(14);
    }
  });
});

describe('sampleUniquePrompts', () => {
  it('returns 5 unique prompts from a pool', () => {
    const pool = filterPromptsByDifficulty(REVERSE_TRANSLATION_PROMPTS, 'beginner');
    const picked = sampleUniquePrompts(pool, 5);
    expect(picked.length).toBe(5);
    const ids = picked.map(p => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('caps at pool size when n is larger', () => {
    const pool = REVERSE_TRANSLATION_PROMPTS.slice(0, 3);
    const picked = sampleUniquePrompts(pool, 10);
    expect(picked.length).toBe(3);
  });

  it('uses provided rng deterministically', () => {
    const pool = filterPromptsByDifficulty(REVERSE_TRANSLATION_PROMPTS, 'beginner');
    const rng = () => 0; // always pick index 0 in Fisher-Yates → reverses pool
    const a = sampleUniquePrompts(pool, 5, rng);
    const b = sampleUniquePrompts(pool, 5, rng);
    expect(a.map(p => p.id)).toEqual(b.map(p => p.id));
  });
});

describe('computeSummaryStats', () => {
  it('returns zeros for empty attempts', () => {
    expect(computeSummaryStats([])).toEqual({
      count: 0, averagePercent: 0, perfectCount: 0, missedCount: 0,
    });
  });

  it('classifies perfect (≥90) and missed (<70) correctly', () => {
    const attempts: AttemptRecord[] = [
      { promptId: 'a', transcript: '', percent: 100 },
      { promptId: 'b', transcript: '', percent: 90 },
      { promptId: 'c', transcript: '', percent: 75 },
      { promptId: 'd', transcript: '', percent: 69 },
      { promptId: 'e', transcript: '', percent: 30 },
    ];
    const s = computeSummaryStats(attempts);
    expect(s.count).toBe(5);
    expect(s.perfectCount).toBe(2);
    expect(s.missedCount).toBe(2);
    expect(s.averagePercent).toBe(Math.round((100 + 90 + 75 + 69 + 30) / 5));
  });
});

describe('filterMissedPrompts', () => {
  const prompts = REVERSE_TRANSLATION_PROMPTS.slice(0, 3);

  it('returns prompts with no attempts', () => {
    const missed = filterMissedPrompts(prompts, []);
    expect(missed.length).toBe(3);
  });

  it('excludes prompts whose best score reached threshold', () => {
    const attempts: AttemptRecord[] = [
      { promptId: prompts[0].id, transcript: '', percent: 95 },
      { promptId: prompts[1].id, transcript: '', percent: 50 },
    ];
    const missed = filterMissedPrompts(prompts, attempts);
    const missedIds = missed.map(p => p.id);
    expect(missedIds).not.toContain(prompts[0].id);
    expect(missedIds).toContain(prompts[1].id);
    expect(missedIds).toContain(prompts[2].id);
  });

  it('uses BEST score across multiple attempts', () => {
    const attempts: AttemptRecord[] = [
      { promptId: prompts[0].id, transcript: '', percent: 40 },
      { promptId: prompts[0].id, transcript: '', percent: 85 }, // best ≥ 70
    ];
    const missed = filterMissedPrompts(prompts, attempts);
    expect(missed.map(p => p.id)).not.toContain(prompts[0].id);
  });

  it('respects custom threshold', () => {
    const attempts: AttemptRecord[] = [
      { promptId: prompts[0].id, transcript: '', percent: 80 },
    ];
    const missedAt90 = filterMissedPrompts(prompts, attempts, 90);
    expect(missedAt90.map(p => p.id)).toContain(prompts[0].id);
  });
});

describe('tokenDiff', () => {
  it('marks all reference words as match when transcript matches', () => {
    const diff = tokenDiff('It is hot today', 'it is hot today');
    expect(diff.every(t => t.status === 'match')).toBe(true);
    expect(diff.length).toBe(4);
  });

  it('marks missing words and adds extras', () => {
    const diff = tokenDiff('I like coffee', 'I love tea coffee');
    const matches = diff.filter(t => t.status === 'match').map(t => t.word);
    const missing = diff.filter(t => t.status === 'missing').map(t => t.word);
    const extras = diff.filter(t => t.status === 'extra').map(t => t.word);
    expect(matches).toContain('i');
    expect(matches).toContain('coffee');
    expect(missing).toContain('like');
    expect(extras.sort()).toEqual(['love', 'tea'].sort());
  });

  it('is punctuation-insensitive', () => {
    const diff = tokenDiff('Hello, world!', 'hello world');
    expect(diff.every(t => t.status === 'match')).toBe(true);
  });
});

describe('QuickReverseTranslationCard render', () => {
  it('renders title and difficulty selector', () => {
    const html = renderToStaticMarkup(React.createElement(QuickReverseTranslationCard));
    expect(html).toContain('Reverse Translation');
    expect(html).toContain('quick-reverse-translation-card');
    expect(html).toContain('qrt-difficulty-beginner');
    expect(html).toContain('qrt-difficulty-intermediate');
    // Defaults to intermediate when no localStorage value present
    expect(html).toMatch(/qrt-difficulty-intermediate" aria-pressed="true"/);
  });
});

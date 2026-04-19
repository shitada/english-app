import { describe, it, expect } from 'vitest';
import {
  STRESS_WORDS,
  pickStressRound,
  selectWeightedRound,
  recordStressAttempt,
  initStressDrill,
  stressDrillReducer,
  stressScore,
  type StressWord,
  type StressStats,
} from '../utils/stressPatterns';

describe('STRESS_WORDS curated list', () => {
  it('has at least 25 entries', () => {
    expect(STRESS_WORDS.length).toBeGreaterThanOrEqual(25);
  });

  it('every entry has a valid stressIndex within syllables range', () => {
    for (const w of STRESS_WORDS) {
      expect(w.syllables.length).toBeGreaterThan(1);
      expect(w.stressIndex).toBeGreaterThanOrEqual(0);
      expect(w.stressIndex).toBeLessThan(w.syllables.length);
      expect(w.word).toMatch(/^[a-z]+$/);
    }
  });
});

describe('pickStressRound', () => {
  it('returns n items', () => {
    const r = pickStressRound(STRESS_WORDS, 6);
    expect(r).toHaveLength(6);
  });

  it('returns deterministic order for the same seed', () => {
    const a = pickStressRound(STRESS_WORDS, 6, 42);
    const b = pickStressRound(STRESS_WORDS, 6, 42);
    expect(a.map((w) => w.word)).toEqual(b.map((w) => w.word));
  });

  it('returns different orders for different seeds (usually)', () => {
    const a = pickStressRound(STRESS_WORDS, 6, 1);
    const b = pickStressRound(STRESS_WORDS, 6, 9999);
    // Highly unlikely to be identical with 30 source words.
    expect(a.map((w) => w.word).join(',')).not.toEqual(b.map((w) => w.word).join(','));
  });

  it('does not mutate the source array', () => {
    const before = STRESS_WORDS.slice();
    pickStressRound(STRESS_WORDS, 6, 7);
    expect(STRESS_WORDS).toEqual(before);
  });

  it('handles edge cases', () => {
    expect(pickStressRound([], 5)).toEqual([]);
    expect(pickStressRound(STRESS_WORDS, 0)).toEqual([]);
    expect(pickStressRound(STRESS_WORDS, 1000).length).toBe(STRESS_WORDS.length);
  });
});

describe('selectWeightedRound', () => {
  const sample: StressWord[] = [
    { word: 'apple',  syllables: ['ap', 'ple'],   stressIndex: 0 },
    { word: 'banana', syllables: ['ba', 'na', 'na'], stressIndex: 1 },
    { word: 'cherry', syllables: ['cher', 'ry'], stressIndex: 0 },
  ];

  it('returns n items deterministically with a seed', () => {
    const a = selectWeightedRound(sample, {}, 2, 5);
    const b = selectWeightedRound(sample, {}, 2, 5);
    expect(a.map((w) => w.word)).toEqual(b.map((w) => w.word));
    expect(a).toHaveLength(2);
  });

  it('weights previously-wrong words ~3x', () => {
    // 'banana' has 3 wrongs → weight ~10. Other words weight 1.
    // Over many seeded picks of size 1, banana should dominate.
    const stats: StressStats = {
      banana: { correct: 0, wrong: 3 },
    };
    let bananaCount = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const r = selectWeightedRound(sample, stats, 1, i + 1);
      if (r[0].word === 'banana') bananaCount++;
    }
    // With weight ~10 vs 1+1 = banana share ≈ 10/12 ≈ 83%.
    // Allow some variance; just ensure it dominates clearly.
    expect(bananaCount / trials).toBeGreaterThan(0.6);
  });

  it('handles empty stats by treating all words equally (no crash)', () => {
    const r = selectWeightedRound(sample, {}, 3, 1);
    expect(r).toHaveLength(3);
    const words = r.map((w) => w.word).sort();
    expect(words).toEqual(['apple', 'banana', 'cherry']);
  });

  it('handles edge cases', () => {
    expect(selectWeightedRound([], {}, 3)).toEqual([]);
    expect(selectWeightedRound(sample, {}, 0)).toEqual([]);
  });
});

describe('recordStressAttempt', () => {
  it('increments correct count', () => {
    const next = recordStressAttempt({}, 'banana', true);
    expect(next.banana).toEqual({ correct: 1, wrong: 0 });
  });

  it('increments wrong count', () => {
    const next = recordStressAttempt({}, 'banana', false);
    expect(next.banana).toEqual({ correct: 0, wrong: 1 });
  });

  it('does not mutate input', () => {
    const stats: StressStats = { banana: { correct: 1, wrong: 0 } };
    const next = recordStressAttempt(stats, 'banana', false);
    expect(stats.banana).toEqual({ correct: 1, wrong: 0 });
    expect(next.banana).toEqual({ correct: 1, wrong: 1 });
  });
});

describe('stressDrillReducer', () => {
  const round: StressWord[] = [
    { word: 'apple',  syllables: ['ap', 'ple'],            stressIndex: 0 },
    { word: 'banana', syllables: ['ba', 'na', 'na'],       stressIndex: 1 },
  ];

  it('records a tap and computes score', () => {
    let s = initStressDrill(round);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 0 }); // correct
    expect(stressScore(s)).toBe(1);
  });

  it('ignores second tap on the same word', () => {
    let s = initStressDrill(round);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 0 });
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 1 });
    expect(s.taps[0]).toBe(0);
  });

  it('advances and ends at summary phase', () => {
    let s = initStressDrill(round);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 0 });
    s = stressDrillReducer(s, { type: 'next' });
    expect(s.index).toBe(1);
    expect(s.phase).toBe('playing');
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 1 });
    s = stressDrillReducer(s, { type: 'next' });
    expect(s.phase).toBe('summary');
    expect(stressScore(s)).toBe(2);
  });

  it('restart resets state with a new round', () => {
    let s = initStressDrill(round);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 0 });
    s = stressDrillReducer(s, { type: 'restart', round: [round[1]] });
    expect(s.index).toBe(0);
    expect(s.taps).toEqual([null]);
    expect(s.phase).toBe('playing');
    expect(s.round).toHaveLength(1);
  });
});

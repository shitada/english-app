import { describe, it, expect } from 'vitest';
import {
  tokenize,
  tokenLevenshtein,
  wordAccuracy,
  diffTokens,
  nextSpan,
  SPAN_LADDER,
  PASS_THRESHOLD,
  MAX_PLAYS_PER_SENTENCE,
} from '../components/SentenceEcho';

describe('tokenize', () => {
  it('lowercases and splits on word boundaries', () => {
    expect(tokenize("Hello, World!")).toEqual(['hello', 'world']);
    expect(tokenize("It's a TEST.")).toEqual(["it's", 'a', 'test']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('tokenLevenshtein', () => {
  it('returns 0 for identical lists', () => {
    expect(tokenLevenshtein(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
  });
  it('counts a single substitution', () => {
    expect(tokenLevenshtein(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
  });
  it('handles empty inputs', () => {
    expect(tokenLevenshtein([], ['a', 'b'])).toBe(2);
    expect(tokenLevenshtein(['a', 'b'], [])).toBe(2);
  });
});

describe('wordAccuracy', () => {
  it('returns 1.0 for a perfect echo', () => {
    expect(wordAccuracy('the cat sat', 'the cat sat')).toBe(1);
  });
  it('returns ~5/6 for one substitution out of six words', () => {
    const acc = wordAccuracy('the cat sat on the mat', 'the cat sat on a mat');
    expect(acc).toBeCloseTo(5 / 6, 3);
  });
  it('returns 0 when target is empty', () => {
    expect(wordAccuracy('', 'anything')).toBe(0);
  });
  it('clamps accuracy to >= 0', () => {
    const acc = wordAccuracy('hi', 'a b c d e f g h i j');
    expect(acc).toBeGreaterThanOrEqual(0);
  });
});

describe('diffTokens', () => {
  it('marks each target token as present (ok) or missing', () => {
    const marks = diffTokens('the cat sat', 'the dog sat');
    expect(marks.map((m) => m.word)).toEqual(['the', 'cat', 'sat']);
    expect(marks.map((m) => m.ok)).toEqual([true, false, true]);
  });
});

describe('nextSpan', () => {
  it('advances up the ladder when passed', () => {
    expect(nextSpan(6, true)).toBe(9);
    expect(nextSpan(9, true)).toBe(12);
    expect(nextSpan(12, true)).toBe(15);
    expect(nextSpan(15, true)).toBe(18);
  });
  it('stays at the same span when not passed', () => {
    expect(nextSpan(9, false)).toBe(9);
  });
  it('caps at the top rung', () => {
    expect(nextSpan(18, true)).toBe(18);
  });
});

describe('module constants', () => {
  it('exposes the documented ladder and thresholds', () => {
    expect([...SPAN_LADDER]).toEqual([6, 9, 12, 15, 18]);
    expect(PASS_THRESHOLD).toBe(0.9);
    expect(MAX_PLAYS_PER_SENTENCE).toBe(2);
  });
});

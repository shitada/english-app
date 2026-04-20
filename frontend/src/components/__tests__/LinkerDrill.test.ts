// Pure-helper test for the Linker Drill scoring function.
// Runs under vitest's default `node` environment (no DOM needed).
import { describe, it, expect } from 'vitest';
import { jaccardScore } from '../LinkerDrill';

describe('jaccardScore', () => {
  it('returns 100 for identical sentences', () => {
    expect(jaccardScore('I studied hard.', 'I studied hard.')).toBe(100);
  });

  it('is case-insensitive and ignores punctuation', () => {
    expect(jaccardScore('I, studied HARD!', 'i studied hard')).toBe(100);
  });

  it('returns 0 for fully disjoint inputs', () => {
    expect(jaccardScore('alpha beta gamma', 'one two three')).toBe(0);
  });

  it('produces a partial score for partial overlap', () => {
    // tokens A unique: {i, studied, hard, however, failed} = 5
    // tokens B unique: {i, studied, hard} = 3
    // intersection = 3, union = 5 -> 60
    const score = jaccardScore('I studied hard however I failed', 'I studied hard');
    expect(score).toBe(60);
  });

  it('returns 0 when both inputs are empty', () => {
    expect(jaccardScore('', '')).toBe(0);
  });

  it('returns 0 when transcript is empty but target is not', () => {
    expect(jaccardScore('', 'one two three')).toBe(0);
  });

  it('clamps output to integer 0-100 range', () => {
    const s = jaccardScore('a b c d', 'a b c d e');
    expect(s).toBe(80);
    expect(Number.isInteger(s)).toBe(true);
  });
});

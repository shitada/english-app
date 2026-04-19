import { describe, it, expect } from 'vitest';
import { scoreSpeakAttempt, pickRandomSet, MINIMAL_PAIR_SETS } from './minimalPairs';

describe('scoreSpeakAttempt', () => {
  it('returns "match" for an exact match (case-insensitive)', () => {
    expect(scoreSpeakAttempt('right', 'right', 'light')).toBe('match');
    expect(scoreSpeakAttempt('RIGHT', 'right', 'light')).toBe('match');
    expect(scoreSpeakAttempt('  Right  ', 'right', 'light')).toBe('match');
  });

  it('returns "match" when target word is one of multiple spoken tokens', () => {
    expect(scoreSpeakAttempt('say right please', 'right', 'light')).toBe('match');
  });

  it('strips punctuation before comparing', () => {
    expect(scoreSpeakAttempt('Right!', 'right', 'light')).toBe('match');
    expect(scoreSpeakAttempt('"right."', 'right', 'light')).toBe('match');
  });

  it('treats simple inflections (rights, righting) as a target match', () => {
    expect(scoreSpeakAttempt('rights', 'right', 'light')).toBe('match');
    expect(scoreSpeakAttempt('righter', 'right', 'light')).toBe('match');
  });

  it('returns "confused" when the user said the OTHER word in the pair', () => {
    expect(scoreSpeakAttempt('light', 'right', 'light')).toBe('confused');
    expect(scoreSpeakAttempt('Light.', 'right', 'light')).toBe('confused');
  });

  it('returns "confused" for the classic L/R, V/B, TH/S confusions', () => {
    expect(scoreSpeakAttempt('berry', 'very', 'berry')).toBe('confused');
    expect(scoreSpeakAttempt('sink', 'think', 'sink')).toBe('confused');
    expect(scoreSpeakAttempt('rice', 'lice', 'rice')).toBe('confused');
  });

  it('returns "unclear" for an empty transcript', () => {
    expect(scoreSpeakAttempt('', 'right', 'light')).toBe('unclear');
    expect(scoreSpeakAttempt('   ', 'right', 'light')).toBe('unclear');
  });

  it('returns "unclear" when transcript matches neither target nor other', () => {
    expect(scoreSpeakAttempt('hello world', 'right', 'light')).toBe('unclear');
    expect(scoreSpeakAttempt('night', 'right', 'light')).toBe('unclear');
  });

  it('prefers target match when both target and other appear', () => {
    // User says "right not light" — credit the production of the target.
    expect(scoreSpeakAttempt('right not light', 'right', 'light')).toBe('match');
  });

  it('does not falsely match when target is a substring of an unrelated longer word', () => {
    // "frightened" is much longer than "right" (>3 char delta) — should not match.
    expect(scoreSpeakAttempt('frightened', 'right', 'light')).toBe('unclear');
  });

  it('handles a null/garbage target gracefully (returns unclear)', () => {
    expect(scoreSpeakAttempt('right', '', 'light')).toBe('unclear');
  });
});

describe('pickRandomSet', () => {
  it('returns one of the curated minimal-pair sets', () => {
    const s = pickRandomSet();
    expect(MINIMAL_PAIR_SETS).toContain(s);
  });
});

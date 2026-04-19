import { describe, it, expect } from 'vitest';
import { wordSimilarity, classifySimilarity, normalizeForCompare } from '../utils/similarity';

describe('similarity', () => {
  describe('normalizeForCompare', () => {
    it('lowercases and strips punctuation', () => {
      expect(normalizeForCompare("Hello, World!")).toEqual(['hello', 'world']);
    });

    it('returns [] for empty / non-string', () => {
      expect(normalizeForCompare('')).toEqual([]);
      // @ts-expect-error testing runtime safety
      expect(normalizeForCompare(null)).toEqual([]);
    });
  });

  describe('wordSimilarity', () => {
    it('identical strings → 1.0', () => {
      expect(wordSimilarity('I would like a cup of coffee', 'I would like a cup of coffee')).toBe(1);
    });

    it('is case-insensitive', () => {
      expect(wordSimilarity('Hello World', 'hello world')).toBe(1);
    });

    it('is punctuation-insensitive', () => {
      expect(wordSimilarity("Let's go, please!", 'lets go please')).toBe(1);
    });

    it('completely different sentences → low score', () => {
      const s = wordSimilarity('I would like a cup of coffee', 'banana xylophone purple monkey dishwasher');
      expect(s).toBeLessThan(0.2);
    });

    it('one missing word → high but not perfect', () => {
      const s = wordSimilarity('I would like a cup of coffee', 'I would like cup of coffee');
      expect(s).toBeGreaterThan(0.8);
      expect(s).toBeLessThan(1);
    });

    it('near-match with one substitution', () => {
      const s = wordSimilarity('I want some tea', 'I want some coffee');
      // 1 substitution out of 4 words = 0.75
      expect(s).toBeCloseTo(0.75, 2);
    });

    it('both empty → 1', () => {
      expect(wordSimilarity('', '')).toBe(1);
    });

    it('one empty → 0', () => {
      expect(wordSimilarity('hello world', '')).toBe(0);
      expect(wordSimilarity('', 'hello world')).toBe(0);
    });

    it('result is bounded in [0, 1]', () => {
      const s = wordSimilarity('a b c', 'x y z q r s t u');
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    });
  });

  describe('classifySimilarity', () => {
    it('≥0.90 → green', () => {
      const v = classifySimilarity(0.95);
      expect(v.tier).toBe('green');
      expect(v.emoji).toBe('🟢');
      expect(v.percent).toBe(95);
    });

    it('0.60..0.89 → yellow', () => {
      const v = classifySimilarity(0.65);
      expect(v.tier).toBe('yellow');
      expect(v.emoji).toBe('🟡');
    });

    it('<0.60 → red', () => {
      const v = classifySimilarity(0.3);
      expect(v.tier).toBe('red');
      expect(v.emoji).toBe('🔴');
      expect(v.label).toContain('try again');
    });

    it('clamps out-of-range values', () => {
      expect(classifySimilarity(-0.5).percent).toBe(0);
      expect(classifySimilarity(1.5).percent).toBe(100);
    });
  });
});

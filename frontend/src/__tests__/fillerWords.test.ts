import { describe, it, expect } from 'vitest';
import { countFillers, highlightFillers, FILLER_REGEX } from '../utils/fillerWords';

describe('fillerWords utility', () => {
  describe('FILLER_REGEX', () => {
    it('matches common filler words', () => {
      const fillers = ['um', 'uh', 'erm', 'er', 'ah', 'like', 'you know', 'basically', 'i mean', 'sort of', 'kind of', 'actually', 'literally', 'right', 'okay so', 'well'];
      for (const filler of fillers) {
        FILLER_REGEX.lastIndex = 0;
        expect(FILLER_REGEX.test(filler), `"${filler}" should match`).toBe(true);
      }
    });

    it('is case-insensitive', () => {
      FILLER_REGEX.lastIndex = 0;
      expect(FILLER_REGEX.test('Um')).toBe(true);
      FILLER_REGEX.lastIndex = 0;
      expect(FILLER_REGEX.test('BASICALLY')).toBe(true);
    });
  });

  describe('countFillers', () => {
    it('returns zero for text with no fillers', () => {
      const result = countFillers('I went to the store and bought milk.');
      expect(result.total).toBe(0);
      expect(result.words.size).toBe(0);
    });

    it('counts a single filler word', () => {
      const result = countFillers('I um went to the store.');
      expect(result.total).toBe(1);
      expect(result.words.get('um')).toBe(1);
    });

    it('counts multiple different filler words', () => {
      const result = countFillers('Um, I basically like went to the store, you know.');
      expect(result.total).toBe(4);
      expect(result.words.get('um')).toBe(1);
      expect(result.words.get('basically')).toBe(1);
      expect(result.words.get('like')).toBe(1);
      expect(result.words.get('you know')).toBe(1);
    });

    it('counts repeated filler words', () => {
      const result = countFillers('um, I um, like um went.');
      expect(result.total).toBe(4);
      expect(result.words.get('um')).toBe(3);
      expect(result.words.get('like')).toBe(1);
    });

    it('is case-insensitive and normalises to lowercase keys', () => {
      const result = countFillers('Um UM um');
      expect(result.total).toBe(3);
      expect(result.words.get('um')).toBe(3);
    });

    it('returns empty map for empty string', () => {
      const result = countFillers('');
      expect(result.total).toBe(0);
      expect(result.words.size).toBe(0);
    });

    it('can be called multiple times without state leaking (global regex reset)', () => {
      const r1 = countFillers('um uh');
      const r2 = countFillers('um uh');
      expect(r1.total).toBe(2);
      expect(r2.total).toBe(2);
    });
  });

  describe('highlightFillers', () => {
    it('wraps filler words in <mark> tags', () => {
      const result = highlightFillers('I um went.');
      expect(result).toContain('<mark');
      expect(result).toContain('um');
      expect(result).toContain('</mark>');
    });

    it('preserves non-filler text unchanged', () => {
      const result = highlightFillers('I went to the store.');
      expect(result).toBe('I went to the store.');
    });

    it('highlights multiple filler words', () => {
      const result = highlightFillers('um like basically');
      const markCount = (result.match(/<mark/g) || []).length;
      expect(markCount).toBe(3);
    });

    it('can be called multiple times without state leaking', () => {
      const r1 = highlightFillers('um');
      const r2 = highlightFillers('um');
      expect(r1).toBe(r2);
      expect(r1).toContain('<mark');
    });
  });
});

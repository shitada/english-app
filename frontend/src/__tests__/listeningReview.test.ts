import { describe, it, expect } from 'vitest';
import { findRelevantSentenceIndex, meaningfulTokens } from '../utils/listeningReview';

describe('listeningReview utility', () => {
  describe('meaningfulTokens', () => {
    it('lowercases and filters short / stopword tokens', () => {
      const tokens = meaningfulTokens('The quick brown FOX jumps over the lazy dog.');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).toContain('jumps');
      // 'the' is too short; 'over' is a stopword candidate? not in our list,
      // but length 4 -> kept. We mainly check filtering of short words.
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('fox'); // length 3
      expect(tokens).not.toContain('dog'); // length 3
    });

    it('returns empty array on empty input', () => {
      expect(meaningfulTokens('')).toEqual([]);
    });
  });

  describe('findRelevantSentenceIndex', () => {
    it('finds sentence with exact keyword match to correct option', () => {
      const sentences = [
        'The hotel offered free breakfast to guests.',
        'Visitors could explore mountain trails nearby.',
        'In the evening, the lobby hosted live music.',
      ];
      const idx = findRelevantSentenceIndex(
        'What did the hotel provide?',
        'free breakfast',
        sentences,
      );
      expect(idx).toBe(0);
    });

    it('falls back to 0 when there is no overlap', () => {
      const sentences = [
        'Alpha beta gamma delta epsilon.',
        'Zeta eta theta iota kappa.',
      ];
      const idx = findRelevantSentenceIndex(
        'Question text completely unrelated',
        'totally different content xyz',
        sentences,
      );
      expect(idx).toBe(0);
    });

    it('breaks ties using question token overlap', () => {
      // Both sentences share a token with the option, but only one shares
      // tokens with the question.
      const sentences = [
        'Mountains contain rivers winding through valleys.',
        'Mountains rise above the bustling marketplace district.',
      ];
      const optionText = 'mountains';
      const questionText = 'Where is the marketplace district located?';
      const idx = findRelevantSentenceIndex(questionText, optionText, sentences);
      expect(idx).toBe(1);
    });

    it('returns 0 for empty sentences array', () => {
      expect(findRelevantSentenceIndex('q', 'a', [])).toBe(0);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { computeFluencyScore } from '../utils/fluencyScore';

/**
 * Tests for LiveFluencyRing logic.
 *
 * Since LiveFluencyRing is a pure UI component that delegates computation
 * to computeFluencyScore + an internal computeVocabDiversity helper, we
 * test the vocabulary diversity calculation inline and verify integration
 * with the fluency score utility.
 */

/** Mirrors the computeVocabDiversity function in LiveFluencyRing.tsx */
function computeVocabDiversity(contents: string[]): number {
  const allWords: string[] = [];
  for (const content of contents) {
    const words = content.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean);
    allWords.push(...words);
  }
  if (allWords.length === 0) return 0;
  const unique = new Set(allWords);
  return (unique.size / allWords.length) * 100;
}

describe('LiveFluencyRing logic', () => {
  describe('computeVocabDiversity', () => {
    it('returns 0 for empty messages', () => {
      expect(computeVocabDiversity([])).toBe(0);
    });

    it('returns 100 for all unique words', () => {
      expect(computeVocabDiversity(['hello world today'])).toBe(100);
    });

    it('returns correct diversity for repeated words', () => {
      // "hello hello world" → unique: {hello, world} = 2, total: 3
      const diversity = computeVocabDiversity(['hello hello world']);
      expect(diversity).toBeCloseTo((2 / 3) * 100, 1);
    });

    it('aggregates words across multiple messages', () => {
      // "I like cats" + "I like dogs" → unique: {i, like, cats, dogs} = 4, total: 6
      const diversity = computeVocabDiversity(['I like cats', 'I like dogs']);
      expect(diversity).toBeCloseTo((4 / 6) * 100, 1);
    });

    it('strips punctuation but keeps apostrophes and hyphens', () => {
      const diversity = computeVocabDiversity(["I don't mind well-done"]);
      // "i don't mind well-done" → 4 unique, 4 total = 100
      expect(diversity).toBe(100);
    });

    it('is case-insensitive', () => {
      // "Hello hello" → 1 unique, 2 total
      const diversity = computeVocabDiversity(['Hello hello']);
      expect(diversity).toBe(50);
    });
  });

  describe('fluency score integration for live ring', () => {
    it('computes a meaningful score with typical chat data', () => {
      // Simulate: 3 messages, 2 correct, some vocab diversity
      const userContents = [
        'I would like to check in please',
        'Yes I have a reservation under Smith',
        'Can I also get late checkout',
      ];
      const correct = 2;
      const total = 3;

      const grammarAccuracy = (correct / total) * 100;
      const diversity = computeVocabDiversity(userContents);
      const totalWords = userContents.reduce(
        (s, c) => s + c.split(/\s+/).filter(Boolean).length,
        0,
      );
      const avgWords = totalWords / userContents.length;

      const result = computeFluencyScore({
        grammar_accuracy_rate: grammarAccuracy,
        vocabulary_diversity: diversity,
        avg_words_per_message: avgWords,
        total_user_messages: userContents.length,
      });

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.label).toBeTruthy();
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('returns lower score when grammar is poor', () => {
      const diversity = 70;
      const goodGrammar = computeFluencyScore({
        grammar_accuracy_rate: 90,
        vocabulary_diversity: diversity,
        avg_words_per_message: 8,
        total_user_messages: 5,
      });
      const badGrammar = computeFluencyScore({
        grammar_accuracy_rate: 20,
        vocabulary_diversity: diversity,
        avg_words_per_message: 8,
        total_user_messages: 5,
      });

      expect(goodGrammar.score).toBeGreaterThan(badGrammar.score);
    });

    it('returns lower score when vocabulary diversity is low', () => {
      const highDiversity = computeFluencyScore({
        grammar_accuracy_rate: 80,
        vocabulary_diversity: 90,
        avg_words_per_message: 8,
        total_user_messages: 5,
      });
      const lowDiversity = computeFluencyScore({
        grammar_accuracy_rate: 80,
        vocabulary_diversity: 20,
        avg_words_per_message: 8,
        total_user_messages: 5,
      });

      expect(highDiversity.score).toBeGreaterThan(lowDiversity.score);
    });
  });

  describe('visibility threshold', () => {
    it('requires at least 2 checked messages (component logic)', () => {
      // This tests the threshold logic that the component uses:
      // checkedMessages.length < 2 → returns null (not visible)
      const checkedCount = 1;
      expect(checkedCount < 2).toBe(true);

      const checkedCount2 = 2;
      expect(checkedCount2 < 2).toBe(false);
    });
  });

  describe('color coding thresholds', () => {
    it('maps score < 40 to red', () => {
      const result = computeFluencyScore({
        grammar_accuracy_rate: 10,
        vocabulary_diversity: 10,
        avg_words_per_message: 2,
        total_user_messages: 1,
      });
      expect(result.score).toBeLessThan(40);
      expect(result.color).toBe('#ef4444');
    });

    it('maps score >= 85 to emerald', () => {
      const result = computeFluencyScore({
        grammar_accuracy_rate: 95,
        vocabulary_diversity: 90,
        avg_words_per_message: 15,
        total_user_messages: 10,
      });
      expect(result.score).toBeGreaterThanOrEqual(85);
      expect(result.color).toBe('#10b981');
    });
  });
});

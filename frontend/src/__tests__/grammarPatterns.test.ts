import { describe, it, expect } from 'vitest';
import { categorizeGrammarError, CATEGORY_ADVICE, type GrammarCategory } from '../utils/grammarPatterns';

describe('grammarPatterns utility', () => {
  describe('categorizeGrammarError', () => {
    it('returns "article" when explanation mentions "article"', () => {
      const result = categorizeGrammarError({
        original: 'I went to store',
        correction: 'I went to the store',
        explanation: 'Missing article before "store".',
      });
      expect(result).toBe('article');
    });

    it('returns "article" when correction introduces "a" or "an"', () => {
      const result = categorizeGrammarError({
        original: 'She is teacher',
        correction: 'She is a teacher',
        explanation: 'You need to add a determiner.',
      });
      expect(result).toBe('article');
    });

    it('returns "tense" when explanation mentions "tense"', () => {
      const result = categorizeGrammarError({
        original: 'I go yesterday',
        correction: 'I went yesterday',
        explanation: 'Use past tense for actions that happened yesterday.',
      });
      expect(result).toBe('tense');
    });

    it('returns "tense" when explanation mentions "past"', () => {
      const result = categorizeGrammarError({
        original: 'He run fast',
        correction: 'He ran fast',
        explanation: 'Use the past form of "run".',
      });
      expect(result).toBe('tense');
    });

    it('returns "tense" for future-related explanations', () => {
      const result = categorizeGrammarError({
        original: 'I go tomorrow',
        correction: 'I will go tomorrow',
        explanation: 'Use future tense for upcoming actions.',
      });
      expect(result).toBe('tense');
    });

    it('returns "preposition" when explanation mentions "preposition"', () => {
      const result = categorizeGrammarError({
        original: 'I arrived to the airport',
        correction: 'I arrived at the airport',
        explanation: 'Wrong preposition — use "at" with "arrive".',
      });
      expect(result).toBe('preposition');
    });

    it('returns "subject-verb agreement" for agreement-related errors', () => {
      const result = categorizeGrammarError({
        original: 'He go to school',
        correction: 'He goes to school',
        explanation: 'Subject-verb agreement: third person singular needs "goes".',
      });
      expect(result).toBe('subject-verb agreement');
    });

    it('returns "subject-verb agreement" when explanation says "subject" and "verb"', () => {
      const result = categorizeGrammarError({
        original: 'The dogs runs',
        correction: 'The dogs run',
        explanation: 'The subject is plural, so the verb should match.',
      });
      expect(result).toBe('subject-verb agreement');
    });

    it('returns "word order" when explanation mentions "order"', () => {
      const result = categorizeGrammarError({
        original: 'Always I eat breakfast',
        correction: 'I always eat breakfast',
        explanation: 'Adverb order — place "always" after the subject.',
      });
      expect(result).toBe('word order');
    });

    it('returns "word order" when explanation mentions "position"', () => {
      const result = categorizeGrammarError({
        original: 'I yesterday went',
        correction: 'I went yesterday',
        explanation: 'The time expression position should be at the end.',
      });
      expect(result).toBe('word order');
    });

    it('returns "plural" when explanation mentions "plural"', () => {
      const result = categorizeGrammarError({
        original: 'I have two cat',
        correction: 'I have two cats',
        explanation: 'Use the plural form after numbers greater than one.',
      });
      expect(result).toBe('plural');
    });

    it('returns "plural" when explanation mentions "singular"', () => {
      const result = categorizeGrammarError({
        original: 'These informations are wrong',
        correction: 'This information is wrong',
        explanation: '"Information" is an uncountable/singular noun.',
      });
      expect(result).toBe('plural');
    });

    it('returns "other" when no category matches', () => {
      const result = categorizeGrammarError({
        original: 'I enjoy to swim',
        correction: 'I enjoy swimming',
        explanation: 'Use the gerund after "enjoy".',
      });
      expect(result).toBe('other');
    });

    it('is case-insensitive', () => {
      const result = categorizeGrammarError({
        original: 'test',
        correction: 'test',
        explanation: 'ARTICLE usage is incorrect.',
      });
      expect(result).toBe('article');
    });

    it('handles empty fields gracefully', () => {
      const result = categorizeGrammarError({
        original: '',
        correction: '',
        explanation: '',
      });
      expect(result).toBe('other');
    });

    it('prioritises earlier category rules (article before tense)', () => {
      // If explanation mentions both "article" and "tense", article wins (checked first)
      const result = categorizeGrammarError({
        original: 'test',
        correction: 'test',
        explanation: 'The article and tense are both wrong.',
      });
      expect(result).toBe('article');
    });
  });

  describe('CATEGORY_ADVICE', () => {
    it('has advice for every known category', () => {
      const categories: GrammarCategory[] = [
        'article',
        'tense',
        'preposition',
        'subject-verb agreement',
        'word order',
        'plural',
        'other',
      ];
      for (const cat of categories) {
        expect(CATEGORY_ADVICE[cat]).toBeDefined();
        expect(CATEGORY_ADVICE[cat].length).toBeGreaterThan(0);
      }
    });

    it('article advice mentions "the" and "a/an"', () => {
      expect(CATEGORY_ADVICE.article).toContain('the');
      expect(CATEGORY_ADVICE.article).toContain('a/an');
    });

    it('tense advice mentions verb tense', () => {
      expect(CATEGORY_ADVICE.tense.toLowerCase()).toContain('tense');
    });
  });
});

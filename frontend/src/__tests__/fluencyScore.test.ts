import { describe, it, expect } from 'vitest';
import {
  computeFluencyScore,
  getFluencyLabel,
  getFluencyColor,
} from '../utils/fluencyScore';
import type { PerformanceData, FluencyBreakdown } from '../utils/fluencyScore';

describe('fluencyScore utility', () => {
  describe('computeFluencyScore', () => {
    it('returns 0 for all-zero performance data', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 0,
        vocabulary_diversity: 0,
        avg_words_per_message: 0,
        total_user_messages: 0,
      };
      const result = computeFluencyScore(perf);
      expect(result.score).toBe(0);
      expect(result.label).toBe('Developing');
    });

    it('returns 100 for perfect performance data', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 100,
        vocabulary_diversity: 100,
        avg_words_per_message: 20, // >=15 caps at 100
        total_user_messages: 15, // >=10 caps at 100
      };
      const result = computeFluencyScore(perf);
      expect(result.score).toBe(100);
      expect(result.label).toBe('Native-like');
    });

    it('computes score matching the backend formula', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 80,
        vocabulary_diversity: 60,
        avg_words_per_message: 10,
        total_user_messages: 5,
      };
      // Expected:
      // grammar:       80 * 0.3 = 24
      // vocabulary:    60 * 0.3 = 18
      // complexity:    min(10/15*100, 100) * 0.25 = 66.667 * 0.25 = 16.667
      // participation: min(5/10*100, 100) * 0.15 = 50 * 0.15 = 7.5
      // total = 24 + 18 + 16.667 + 7.5 = 66.167 → rounded to 66.2
      const result = computeFluencyScore(perf);
      expect(result.score).toBeCloseTo(66.2, 1);
    });

    it('caps avg_words component at 100', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 0,
        vocabulary_diversity: 0,
        avg_words_per_message: 30, // way above 15
        total_user_messages: 0,
      };
      const result = computeFluencyScore(perf);
      // complexity: min(30/15*100, 100) * 0.25 = 100 * 0.25 = 25
      expect(result.score).toBe(25);
    });

    it('caps total_msgs component at 100', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 0,
        vocabulary_diversity: 0,
        avg_words_per_message: 0,
        total_user_messages: 20, // way above 10
      };
      const result = computeFluencyScore(perf);
      // participation: min(20/10*100, 100) * 0.15 = 100 * 0.15 = 15
      expect(result.score).toBe(15);
    });

    it('returns correct sub-score breakdown', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 80,
        vocabulary_diversity: 60,
        avg_words_per_message: 10,
        total_user_messages: 5,
      };
      const result = computeFluencyScore(perf);
      expect(result.subScores.grammar).toBe(24);
      expect(result.subScores.vocabulary).toBe(18);
      expect(result.subScores.complexity).toBeCloseTo(16.7, 1);
      expect(result.subScores.participation).toBe(7.5);
    });

    it('returns raw 0-100 breakdown sub-scores', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 80,
        vocabulary_diversity: 60,
        avg_words_per_message: 10,
        total_user_messages: 5,
      };
      const result = computeFluencyScore(perf);
      const bd: FluencyBreakdown = result.breakdown;
      expect(bd.grammar).toBe(80);
      expect(bd.vocabulary).toBe(60);
      expect(bd.complexity).toBe(67); // Math.round(10/15*100) = 67
      expect(bd.participation).toBe(50); // Math.round(5/10*100) = 50
      expect(bd.total).toBe(Math.round(result.score));
      expect(bd.label).toBe(result.label);
      expect(bd.color).toBe(result.color);
    });

    it('caps breakdown.complexity at 100 for high avg_words', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 0,
        vocabulary_diversity: 0,
        avg_words_per_message: 30,
        total_user_messages: 0,
      };
      const result = computeFluencyScore(perf);
      expect(result.breakdown.complexity).toBe(100);
    });

    it('caps breakdown.participation at 100 for high total_msgs', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 0,
        vocabulary_diversity: 0,
        avg_words_per_message: 0,
        total_user_messages: 20,
      };
      const result = computeFluencyScore(perf);
      expect(result.breakdown.participation).toBe(100);
    });

    it('breakdown fields are all 0 for zero performance', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 0,
        vocabulary_diversity: 0,
        avg_words_per_message: 0,
        total_user_messages: 0,
      };
      const bd = computeFluencyScore(perf).breakdown;
      expect(bd.grammar).toBe(0);
      expect(bd.vocabulary).toBe(0);
      expect(bd.complexity).toBe(0);
      expect(bd.participation).toBe(0);
      expect(bd.total).toBe(0);
    });

    it('breakdown fields are all 100 for perfect performance', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 100,
        vocabulary_diversity: 100,
        avg_words_per_message: 20,
        total_user_messages: 15,
      };
      const bd = computeFluencyScore(perf).breakdown;
      expect(bd.grammar).toBe(100);
      expect(bd.vocabulary).toBe(100);
      expect(bd.complexity).toBe(100);
      expect(bd.participation).toBe(100);
      expect(bd.total).toBe(100);
    });

    it('assigns the correct color from the score', () => {
      const perf: PerformanceData = {
        grammar_accuracy_rate: 80,
        vocabulary_diversity: 60,
        avg_words_per_message: 10,
        total_user_messages: 5,
      };
      const result = computeFluencyScore(perf);
      // score ~66.2 → 'Fluent' → indigo
      expect(result.color).toBe('#6366f1');
    });
  });

  describe('getFluencyLabel', () => {
    it('returns "Developing" for low scores', () => {
      expect(getFluencyLabel(0)).toBe('Developing');
      expect(getFluencyLabel(20)).toBe('Developing');
      expect(getFluencyLabel(39.9)).toBe('Developing');
    });

    it('returns "Conversational" for mid-range scores', () => {
      expect(getFluencyLabel(40)).toBe('Conversational');
      expect(getFluencyLabel(50)).toBe('Conversational');
      expect(getFluencyLabel(64.9)).toBe('Conversational');
    });

    it('returns "Fluent" for high scores', () => {
      expect(getFluencyLabel(65)).toBe('Fluent');
      expect(getFluencyLabel(75)).toBe('Fluent');
      expect(getFluencyLabel(84.9)).toBe('Fluent');
    });

    it('returns "Native-like" for top scores', () => {
      expect(getFluencyLabel(85)).toBe('Native-like');
      expect(getFluencyLabel(100)).toBe('Native-like');
    });
  });

  describe('getFluencyColor', () => {
    it('returns red for low scores', () => {
      expect(getFluencyColor(0)).toBe('#ef4444');
      expect(getFluencyColor(39)).toBe('#ef4444');
    });

    it('returns amber for mid-range scores', () => {
      expect(getFluencyColor(40)).toBe('#f59e0b');
      expect(getFluencyColor(64)).toBe('#f59e0b');
    });

    it('returns indigo for high scores', () => {
      expect(getFluencyColor(65)).toBe('#6366f1');
      expect(getFluencyColor(84)).toBe('#6366f1');
    });

    it('returns emerald for top scores', () => {
      expect(getFluencyColor(85)).toBe('#10b981');
      expect(getFluencyColor(100)).toBe('#10b981');
    });
  });
});

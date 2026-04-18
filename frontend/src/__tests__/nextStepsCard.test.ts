import { describe, it, expect } from 'vitest';
import {
  generateRecommendations,
  type NextStepsData,
  type Recommendation,
} from '../components/conversation/NextStepsCard';

describe('generateRecommendations', () => {
  it('recommends grammar practice when accuracy is below 70%', () => {
    const data: NextStepsData = { grammarAccuracy: 50 };
    const recs = generateRecommendations(data);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].title).toBe('Practice grammar patterns');
    expect(recs[0].reason).toContain('50%');
    expect(recs[0].link).toBe('/pronunciation');
  });

  it('recommends filler reduction when filler count exceeds 3', () => {
    const data: NextStepsData = { fillerCount: 7 };
    const recs = generateRecommendations(data);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].title).toBe('Reduce filler words');
    expect(recs[0].reason).toContain('7');
    expect(recs[0].link).toBe('/');
  });

  it('recommends response speed when avg response time exceeds 15s', () => {
    const data: NextStepsData = { avgResponseTime: 22.5 };
    const recs = generateRecommendations(data);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].title).toBe('Build response speed');
    expect(recs[0].reason).toContain('22.5s');
    expect(recs[0].link).toBe('/pronunciation');
  });

  it('recommends sentence expansion when avg words/msg below 6', () => {
    const data: NextStepsData = { avgWordsPerMessage: 4 };
    const recs = generateRecommendations(data);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].title).toBe('Expand your sentences');
    expect(recs[0].reason).toContain('4');
    expect(recs[0].link).toBe('/pronunciation');
  });

  it('recommends vocab growth when diversity is below 40%', () => {
    const data: NextStepsData = { vocabDiversity: 25 };
    const recs = generateRecommendations(data);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].title).toBe('Grow your vocabulary');
    expect(recs[0].reason).toContain('25%');
    expect(recs[0].link).toBe('/vocabulary');
  });

  it('shows congratulatory messages when all metrics are good', () => {
    const data: NextStepsData = {
      grammarAccuracy: 90,
      fillerCount: 1,
      avgResponseTime: 8,
      avgWordsPerMessage: 12,
      vocabDiversity: 65,
    };
    const recs = generateRecommendations(data);
    expect(recs.length).toBe(2);
    expect(recs[0].emoji).toBe('🎉');
    expect(recs[0].title).toContain('Level up');
    expect(recs[1].emoji).toBe('🌟');
    expect(recs[1].title).toContain('Explore a new topic');
  });

  it('shows congratulatory messages when all data is undefined', () => {
    const data: NextStepsData = {};
    const recs = generateRecommendations(data);
    expect(recs.length).toBe(2);
    expect(recs[0].title).toContain('Level up');
  });

  it('limits recommendations to at most 3', () => {
    const data: NextStepsData = {
      grammarAccuracy: 30,
      fillerCount: 10,
      avgResponseTime: 25,
      avgWordsPerMessage: 3,
      vocabDiversity: 15,
    };
    const recs = generateRecommendations(data);
    expect(recs.length).toBe(3);
  });

  it('preserves priority order: grammar > filler > response speed > expansion > vocab', () => {
    const data: NextStepsData = {
      grammarAccuracy: 30,
      fillerCount: 10,
      avgResponseTime: 25,
      avgWordsPerMessage: 3,
      vocabDiversity: 15,
    };
    const recs = generateRecommendations(data);
    expect(recs[0].title).toBe('Practice grammar patterns');
    expect(recs[1].title).toBe('Reduce filler words');
    expect(recs[2].title).toBe('Build response speed');
  });

  it('does not recommend grammar when accuracy is exactly 70%', () => {
    const data: NextStepsData = { grammarAccuracy: 70 };
    const recs = generateRecommendations(data);
    // 70% is NOT below threshold → should get congratulatory
    expect(recs.every(r => r.title !== 'Practice grammar patterns')).toBe(true);
  });

  it('does not recommend filler reduction when count is exactly 3', () => {
    const data: NextStepsData = { fillerCount: 3 };
    const recs = generateRecommendations(data);
    expect(recs.every(r => r.title !== 'Reduce filler words')).toBe(true);
  });

  it('does not recommend response speed when avg is exactly 15s', () => {
    const data: NextStepsData = { avgResponseTime: 15 };
    const recs = generateRecommendations(data);
    expect(recs.every(r => r.title !== 'Build response speed')).toBe(true);
  });

  it('does not recommend expansion when avg words is exactly 6', () => {
    const data: NextStepsData = { avgWordsPerMessage: 6 };
    const recs = generateRecommendations(data);
    expect(recs.every(r => r.title !== 'Expand your sentences')).toBe(true);
  });

  it('does not recommend vocab growth when diversity is exactly 40%', () => {
    const data: NextStepsData = { vocabDiversity: 40 };
    const recs = generateRecommendations(data);
    expect(recs.every(r => r.title !== 'Grow your vocabulary')).toBe(true);
  });

  it('each recommendation has all required fields', () => {
    const data: NextStepsData = { grammarAccuracy: 50, fillerCount: 5 };
    const recs = generateRecommendations(data);
    recs.forEach((rec: Recommendation) => {
      expect(rec.emoji).toBeTruthy();
      expect(rec.title).toBeTruthy();
      expect(rec.reason).toBeTruthy();
      expect(rec.link).toMatch(/^\//);
      expect(rec.linkLabel).toBeTruthy();
    });
  });
});

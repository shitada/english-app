import { describe, it, expect } from 'vitest';
import {
  classifyAttempt,
  summarizeDrill,
  SHADOW_DRILL_LADDER,
  type ShadowAttempt,
} from '../utils/phraseShadowDrill';

describe('Phrase of the Day shadow drill — ladder constants', () => {
  it('exposes a 3-rung speed ladder Slow→Normal→Fast', () => {
    expect(SHADOW_DRILL_LADDER).toHaveLength(3);
    expect(SHADOW_DRILL_LADDER.map((r) => r.speed)).toEqual(['slow', 'normal', 'fast']);
    expect(SHADOW_DRILL_LADDER.map((r) => r.rate)).toEqual([0.75, 0.95, 1.15]);
  });
});

describe('classifyAttempt', () => {
  it('returns "pending" for null score when not active', () => {
    expect(classifyAttempt(null, false)).toBe('pending');
  });
  it('returns "inProgress" for null score when active', () => {
    expect(classifyAttempt(null, true)).toBe('inProgress');
  });
  it('returns "good" at exactly 80% (boundary)', () => {
    expect(classifyAttempt(80)).toBe('good');
    expect(classifyAttempt(100)).toBe('good');
  });
  it('returns "okay" between 50% and 79%', () => {
    expect(classifyAttempt(50)).toBe('okay');
    expect(classifyAttempt(79)).toBe('okay');
  });
  it('returns "bad" below 50%', () => {
    expect(classifyAttempt(49)).toBe('bad');
    expect(classifyAttempt(0)).toBe('bad');
  });
  it('ignores isActive when a real percent is supplied', () => {
    expect(classifyAttempt(85, true)).toBe('good');
    expect(classifyAttempt(10, true)).toBe('bad');
  });
});

const mkAttempt = (rate: number, percent: number | null): ShadowAttempt => {
  const speed = rate < 0.9 ? 'slow' : rate < 1.05 ? 'normal' : 'fast';
  return { speed, rate, percent };
};

describe('summarizeDrill', () => {
  it('returns zeros when no attempts have been scored yet', () => {
    const s = summarizeDrill([
      mkAttempt(0.75, null),
      mkAttempt(0.95, null),
      mkAttempt(1.15, null),
    ]);
    expect(s).toEqual({ best: 0, avg: 0, mastered: false, completed: false });
  });

  it('not completed while some attempts remain null', () => {
    const s = summarizeDrill([
      mkAttempt(0.75, 90),
      mkAttempt(0.95, 85),
      mkAttempt(1.15, null),
    ]);
    expect(s.completed).toBe(false);
    expect(s.mastered).toBe(false);
    expect(s.best).toBe(90);
    // avg over scored attempts only: (90 + 85) / 2 = 87.5 -> 88
    expect(s.avg).toBe(88);
  });

  it('marks mastered only when ALL three attempts are >=80%', () => {
    const allGood = summarizeDrill([
      mkAttempt(0.75, 80),
      mkAttempt(0.95, 92),
      mkAttempt(1.15, 100),
    ]);
    expect(allGood.completed).toBe(true);
    expect(allGood.mastered).toBe(true);
    expect(allGood.best).toBe(100);
    expect(allGood.avg).toBe(91); // (80+92+100)/3 = 90.66 -> 91

    const oneFail = summarizeDrill([
      mkAttempt(0.75, 80),
      mkAttempt(0.95, 79),
      mkAttempt(1.15, 100),
    ]);
    expect(oneFail.completed).toBe(true);
    expect(oneFail.mastered).toBe(false);
  });

  it('handles a fully-failed drill', () => {
    const s = summarizeDrill([
      mkAttempt(0.75, 0),
      mkAttempt(0.95, 10),
      mkAttempt(1.15, 20),
    ]);
    expect(s.completed).toBe(true);
    expect(s.mastered).toBe(false);
    expect(s.best).toBe(20);
    expect(s.avg).toBe(10);
  });

  it('rounds average to nearest integer', () => {
    const s = summarizeDrill([
      mkAttempt(0.75, 81),
      mkAttempt(0.95, 82),
      mkAttempt(1.15, 84),
    ]);
    // (81+82+84)/3 = 82.33 -> 82
    expect(s.avg).toBe(82);
    expect(s.best).toBe(84);
    expect(s.mastered).toBe(true);
  });
});

describe('classifyAttempt + summarizeDrill — integration of pip statuses', () => {
  it('produces the expected pip status row for a good→okay→bad drill', () => {
    const attempts: ShadowAttempt[] = [
      mkAttempt(0.75, 95),
      mkAttempt(0.95, 65),
      mkAttempt(1.15, 30),
    ];
    const statuses = attempts.map((a) => classifyAttempt(a.percent));
    expect(statuses).toEqual(['good', 'okay', 'bad']);
    const summary = summarizeDrill(attempts);
    expect(summary.completed).toBe(true);
    expect(summary.mastered).toBe(false);
    expect(summary.best).toBe(95);
  });

  it('mid-drill: first done, second active, third pending', () => {
    const statuses = [
      classifyAttempt(88, false),
      classifyAttempt(null, true),
      classifyAttempt(null, false),
    ];
    expect(statuses).toEqual(['good', 'inProgress', 'pending']);
  });
});

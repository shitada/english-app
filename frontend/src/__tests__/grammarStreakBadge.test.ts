import { describe, it, expect } from 'vitest';

/**
 * Tests for the GrammarStreakBadge component logic.
 *
 * Since GrammarStreakBadge is a purely presentational component with no
 * complex calculations, we test the visibility, display, and state-transition
 * rules that the component implements.
 */
describe('GrammarStreakBadge logic', () => {
  /**
   * Mirrors the visibility logic from GrammarStreakBadge:
   * - If broken=true → show "streak broken" flash
   * - If currentStreak < 2 (and not broken) → return null (hidden)
   * - If currentStreak >= 2 → show "🔥 N"
   */
  function badgeVisibility(currentStreak: number, broken: boolean): 'hidden' | 'streak' | 'broken' {
    if (broken) return 'broken';
    if (currentStreak < 2) return 'hidden';
    return 'streak';
  }

  /**
   * Mirrors the color logic: streak >= 5 → green, else amber.
   */
  function streakColor(currentStreak: number): string {
    return currentStreak >= 5 ? 'var(--success, #22c55e)' : 'var(--warning, #f59e0b)';
  }

  /**
   * Mirrors the streak update logic from Conversation.tsx sendMessage:
   * - correct → increment streak
   * - incorrect → reset to 0
   */
  function computeNextStreak(current: number, isCorrect: boolean): number {
    return isCorrect ? current + 1 : 0;
  }

  describe('visibility thresholds', () => {
    it('is hidden when streak is 0', () => {
      expect(badgeVisibility(0, false)).toBe('hidden');
    });

    it('is hidden when streak is 1 (needs 2+)', () => {
      expect(badgeVisibility(1, false)).toBe('hidden');
    });

    it('shows streak when currentStreak is 2', () => {
      expect(badgeVisibility(2, false)).toBe('streak');
    });

    it('shows streak when currentStreak is 10', () => {
      expect(badgeVisibility(10, false)).toBe('streak');
    });

    it('shows broken state when broken flag is true, even if streak is 0', () => {
      expect(badgeVisibility(0, true)).toBe('broken');
    });
  });

  describe('color coding', () => {
    it('uses amber color for streak 2-4', () => {
      expect(streakColor(2)).toBe('var(--warning, #f59e0b)');
      expect(streakColor(3)).toBe('var(--warning, #f59e0b)');
      expect(streakColor(4)).toBe('var(--warning, #f59e0b)');
    });

    it('uses green color for streak 5+', () => {
      expect(streakColor(5)).toBe('var(--success, #22c55e)');
      expect(streakColor(10)).toBe('var(--success, #22c55e)');
    });
  });

  describe('streak computation (sendMessage logic)', () => {
    it('increments streak on correct feedback', () => {
      expect(computeNextStreak(0, true)).toBe(1);
      expect(computeNextStreak(1, true)).toBe(2);
      expect(computeNextStreak(5, true)).toBe(6);
    });

    it('resets streak to 0 on incorrect feedback', () => {
      expect(computeNextStreak(3, false)).toBe(0);
      expect(computeNextStreak(0, false)).toBe(0);
      expect(computeNextStreak(10, false)).toBe(0);
    });

    it('tracks best streak across a session sequence', () => {
      // Simulate a session: correct, correct, correct, wrong, correct, correct
      const feedbackSeq = [true, true, true, false, true, true];
      let current = 0;
      let best = 0;
      for (const isCorrect of feedbackSeq) {
        current = computeNextStreak(current, isCorrect);
        best = Math.max(best, current);
      }
      expect(best).toBe(3); // best was 3 before the error
      expect(current).toBe(2); // rebuilt to 2 after error
    });

    it('handles all-correct session', () => {
      const feedbackSeq = [true, true, true, true, true];
      let current = 0;
      let best = 0;
      for (const isCorrect of feedbackSeq) {
        current = computeNextStreak(current, isCorrect);
        best = Math.max(best, current);
      }
      expect(best).toBe(5);
      expect(current).toBe(5);
    });

    it('handles all-incorrect session', () => {
      const feedbackSeq = [false, false, false];
      let current = 0;
      let best = 0;
      for (const isCorrect of feedbackSeq) {
        current = computeNextStreak(current, isCorrect);
        best = Math.max(best, current);
      }
      expect(best).toBe(0);
      expect(current).toBe(0);
    });
  });

  describe('animation triggers', () => {
    /**
     * Mirrors the animation trigger logic from useEffect:
     * - pulse when currentStreak > prevStreak AND currentStreak >= 2
     * - broken flash when prevStreak >= 2 AND currentStreak === 0
     */
    function animationTrigger(
      prevStreak: number,
      currentStreak: number,
    ): 'pulse' | 'broken' | 'none' {
      if (currentStreak > prevStreak && currentStreak >= 2) return 'pulse';
      if (prevStreak >= 2 && currentStreak === 0) return 'broken';
      return 'none';
    }

    it('triggers pulse when going from 1 to 2', () => {
      expect(animationTrigger(1, 2)).toBe('pulse');
    });

    it('triggers pulse when going from 4 to 5', () => {
      expect(animationTrigger(4, 5)).toBe('pulse');
    });

    it('does not pulse when going from 0 to 1 (below threshold)', () => {
      expect(animationTrigger(0, 1)).toBe('none');
    });

    it('triggers broken flash when streak >= 2 drops to 0', () => {
      expect(animationTrigger(3, 0)).toBe('broken');
      expect(animationTrigger(2, 0)).toBe('broken');
    });

    it('does not trigger broken flash when streak 1 drops to 0', () => {
      expect(animationTrigger(1, 0)).toBe('none');
    });

    it('does not trigger anything when streak stays the same', () => {
      expect(animationTrigger(3, 3)).toBe('none');
    });
  });

  describe('title/tooltip text', () => {
    function tooltipText(currentStreak: number, bestStreak: number): string {
      const isBest = bestStreak <= currentStreak;
      return `Grammar streak: ${currentStreak} in a row${isBest ? ' (session best!)' : ` (best: ${bestStreak})`}`;
    }

    it('shows "session best!" when current equals best', () => {
      expect(tooltipText(5, 5)).toContain('session best!');
    });

    it('shows best value when current is below best', () => {
      expect(tooltipText(2, 5)).toContain('best: 5');
    });
  });
});

// Helpers for the Phrase of the Day shadow drill on Home.tsx.
// Extracted into a standalone module so they can be unit-tested without
// transitively importing the entire Home page tree.

export type ShadowSpeedKey = 'slow' | 'normal' | 'fast';

export interface ShadowAttempt {
  speed: ShadowSpeedKey;
  rate: number;
  percent: number | null; // null = not yet attempted
}

export type AttemptStatus = 'pending' | 'inProgress' | 'good' | 'okay' | 'bad';

export const SHADOW_DRILL_LADDER: Array<{ speed: ShadowSpeedKey; rate: number }> = [
  { speed: 'slow', rate: 0.75 },
  { speed: 'normal', rate: 0.95 },
  { speed: 'fast', rate: 1.15 },
];

/**
 * Classify a single attempt's pip status based on its score.
 * - null + currentlyActive => 'inProgress'
 * - null => 'pending'
 * - >=80 => 'good'
 * - >=50 => 'okay'
 * - else => 'bad'
 */
export function classifyAttempt(percent: number | null, isActive: boolean = false): AttemptStatus {
  if (percent === null) return isActive ? 'inProgress' : 'pending';
  if (percent >= 80) return 'good';
  if (percent >= 50) return 'okay';
  return 'bad';
}

export interface DrillSummary {
  best: number;
  avg: number;
  mastered: boolean;
  completed: boolean;
}

/**
 * Summarize a drill from its attempts. Only completed (non-null) attempts contribute.
 * `mastered` requires all 3 ladder rungs scored >= 80%.
 */
export function summarizeDrill(attempts: ShadowAttempt[]): DrillSummary {
  const scored = attempts.filter((a) => a.percent !== null).map((a) => a.percent as number);
  if (scored.length === 0) {
    return { best: 0, avg: 0, mastered: false, completed: false };
  }
  const best = Math.max(...scored);
  const avg = Math.round(scored.reduce((s, n) => s + n, 0) / scored.length);
  const completed = attempts.length > 0 && scored.length === attempts.length;
  const mastered = completed && scored.every((p) => p >= 80);
  return { best, avg, mastered, completed };
}

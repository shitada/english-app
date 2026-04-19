/**
 * Word-level similarity utilities for shadowing / repeat-after-me drills.
 *
 * `wordSimilarity` returns a value in [0, 1] indicating how closely the
 * `actual` (user's recognized transcript) matches the `expected` (target)
 * sentence. Comparison is:
 *   - case-insensitive
 *   - punctuation-insensitive
 *   - whitespace-collapsed
 *
 * Algorithm: 1 - (Levenshtein word-edit-distance / max(words))
 * This treats word insertions, deletions and substitutions equally.
 */

export function normalizeForCompare(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    // Drop apostrophes inside words ("let's" → "lets") then strip remaining punct.
    .replace(/['’`]/g, '')
    .replace(/[.,!?;:"()\[\]{}\-—–…/\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use a single rolling row.
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Returns a similarity score in [0, 1].
 *   - 1.0 means identical (after normalization).
 *   - 0.0 means completely different.
 * If both inputs are empty, returns 1 (vacuously identical).
 * If exactly one input is empty, returns 0.
 */
export function wordSimilarity(expected: string, actual: string): number {
  const exp = normalizeForCompare(expected);
  const act = normalizeForCompare(actual);
  if (exp.length === 0 && act.length === 0) return 1;
  if (exp.length === 0 || act.length === 0) return 0;
  const dist = levenshtein(exp, act);
  const denom = Math.max(exp.length, act.length);
  const sim = 1 - dist / denom;
  return Math.max(0, Math.min(1, sim));
}

export interface SimilarityVerdict {
  /** integer 0..100 */
  percent: number;
  /** color tier */
  tier: 'green' | 'yellow' | 'red';
  /** emoji indicator */
  emoji: '🟢' | '🟡' | '🔴';
  /** short human label */
  label: string;
}

export function classifySimilarity(score: number): SimilarityVerdict {
  const clamped = Math.max(0, Math.min(1, score));
  const percent = Math.round(clamped * 100);
  if (percent >= 90) {
    return { percent, tier: 'green', emoji: '🟢', label: `${percent}% match` };
  }
  if (percent >= 60) {
    return { percent, tier: 'yellow', emoji: '🟡', label: `${percent}%` };
  }
  return { percent, tier: 'red', emoji: '🔴', label: `${percent}% — try again` };
}

// Utilities for the Listening quiz results phase.
// Pure helpers so they can be unit-tested without DOM.

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'because', 'before',
  'being', 'below', 'between', 'both', 'could', 'does', 'doing', 'down',
  'during', 'each', 'from', 'further', 'have', 'having', 'into', 'just',
  'more', 'most', 'once', 'only', 'other', 'over', 'same', 'should',
  'some', 'such', 'than', 'that', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'under', 'until', 'very', 'were',
  'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
  'yours', 'yourself', 'will', 'shall', 'their', 'theirs', 'been',
  'doesn', 'didn', 'don', 'isn', 'wasn', 'weren', 'aren',
]);

/**
 * Tokenize a string into "meaningful" lowercase tokens of length>=4
 * with stopwords removed.
 */
export function meaningfulTokens(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Find the index of the sentence in `sentences` that best matches the
 * correct option text (and, as a tie-breaker, the question text).
 *
 * Scoring: count of meaningful tokens shared with the correct option text,
 * plus a smaller weight for tokens shared with the question. Highest score
 * wins. If everything is zero, returns 0 (fallback to first sentence).
 */
export function findRelevantSentenceIndex(
  question: string,
  correctOptionText: string,
  sentences: string[]
): number {
  if (!sentences || sentences.length === 0) return 0;
  const optTokens = new Set(meaningfulTokens(correctOptionText));
  const qTokens = new Set(meaningfulTokens(question));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < sentences.length; i++) {
    const sTokens = meaningfulTokens(sentences[i]);
    let optOverlap = 0;
    let qOverlap = 0;
    for (const t of sTokens) {
      if (optTokens.has(t)) optOverlap++;
      if (qTokens.has(t)) qOverlap++;
    }
    // Weight option overlap higher than question overlap (tie-breaker).
    const score = optOverlap * 10 + qOverlap;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestScore <= 0) return 0;
  return bestIdx;
}

/**
 * Fluency score utilities.
 *
 * The composite formula mirrors the backend (app/dal/dashboard.py):
 *   accuracy * 0.3  +  diversity * 0.3
 *   + min(avg_words / 15 * 100, 100) * 0.25
 *   + min(total_msgs / 10 * 100, 100) * 0.15
 */

export interface PerformanceData {
  grammar_accuracy_rate: number;
  vocabulary_diversity: number;
  avg_words_per_message: number;
  total_user_messages: number;
}

/** Raw 0-100 sub-scores for display in the breakdown UI. */
export interface FluencyBreakdown {
  grammar: number;
  vocabulary: number;
  complexity: number;
  participation: number;
  total: number;
  label: string;
  color: string;
}

export interface FluencyResult {
  score: number;
  label: string;
  color: string;
  subScores: {
    grammar: number;
    vocabulary: number;
    complexity: number;
    participation: number;
  };
  /** Raw 0-100 sub-scores (user-friendly breakdown). */
  breakdown: FluencyBreakdown;
}

/** Compute composite fluency score (0-100) from session performance data. */
export function computeFluencyScore(perf: PerformanceData): FluencyResult {
  const accuracy = perf.grammar_accuracy_rate ?? 0;
  const diversity = perf.vocabulary_diversity ?? 0;
  const avgWords = perf.avg_words_per_message ?? 0;
  const totalMsgs = perf.total_user_messages ?? 0;

  // Raw 0-100 sub-scores (for display)
  const grammarRaw = Math.round(accuracy);
  const vocabularyRaw = Math.round(diversity);
  const complexityRaw = Math.round(Math.min((avgWords / 15) * 100, 100));
  const participationRaw = Math.round(Math.min((totalMsgs / 10) * 100, 100));

  // Weighted components (for total)
  const grammarComponent = accuracy * 0.3;
  const vocabComponent = diversity * 0.3;
  const complexityComponent = Math.min(avgWords / 15 * 100, 100) * 0.25;
  const participationComponent = Math.min(totalMsgs / 10 * 100, 100) * 0.15;

  const raw = grammarComponent + vocabComponent + complexityComponent + participationComponent;
  const score = Math.round(Math.min(Math.max(raw, 0), 100) * 10) / 10;

  const label = getFluencyLabel(score);
  const color = getFluencyColor(score);

  return {
    score,
    label,
    color,
    subScores: {
      grammar: Math.round(grammarComponent * 10) / 10,
      vocabulary: Math.round(vocabComponent * 10) / 10,
      complexity: Math.round(complexityComponent * 10) / 10,
      participation: Math.round(participationComponent * 10) / 10,
    },
    breakdown: {
      grammar: grammarRaw,
      vocabulary: vocabularyRaw,
      complexity: complexityRaw,
      participation: participationRaw,
      total: Math.round(score),
      label,
      color,
    },
  };
}

/** Map score to a human-readable fluency level label. */
export function getFluencyLabel(score: number): string {
  if (score >= 85) return 'Native-like';
  if (score >= 65) return 'Fluent';
  if (score >= 40) return 'Conversational';
  return 'Developing';
}

/** Map score to a CSS color string. */
export function getFluencyColor(score: number): string {
  if (score >= 85) return '#10b981'; // emerald
  if (score >= 65) return '#6366f1'; // indigo
  if (score >= 40) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

import { useMemo } from 'react';
import { computeFluencyScore, getFluencyColor } from '../../utils/fluencyScore';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  feedback?: { is_correct: boolean; errors: unknown[]; suggestions: unknown[] } | null;
}

interface LiveFluencyRingProps {
  messages: Message[];
}

/**
 * Compute vocabulary diversity (unique words / total words × 100) from user messages.
 */
function computeVocabDiversity(userMessages: Message[]): number {
  const allWords: string[] = [];
  for (const m of userMessages) {
    const words = m.content.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean);
    allWords.push(...words);
  }
  if (allWords.length === 0) return 0;
  const unique = new Set(allWords);
  return (unique.size / allWords.length) * 100;
}

/**
 * A compact 36×36 SVG ring that shows the live composite fluency score
 * during the conversation chat phase. Appears only after the user's 2nd
 * checked message to avoid misleading early scores.
 */
export function LiveFluencyRing({ messages }: LiveFluencyRingProps) {
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages]);
  const checkedMessages = useMemo(() => userMessages.filter((m) => m.feedback), [userMessages]);

  const fluency = useMemo(() => {
    if (checkedMessages.length < 2) return null;

    const correct = checkedMessages.filter((m) => m.feedback!.is_correct).length;
    const grammarAccuracy = (correct / checkedMessages.length) * 100;

    const diversity = computeVocabDiversity(userMessages);

    const totalWords = userMessages.reduce((sum, m) => sum + m.content.split(/\s+/).filter(Boolean).length, 0);
    const avgWords = userMessages.length > 0 ? totalWords / userMessages.length : 0;

    return computeFluencyScore({
      grammar_accuracy_rate: grammarAccuracy,
      vocabulary_diversity: diversity,
      avg_words_per_message: avgWords,
      total_user_messages: userMessages.length,
    });
  }, [checkedMessages, userMessages]);

  if (!fluency) return null;

  const size = 36;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(fluency.score / 100, 1);
  const dashOffset = circumference * (1 - progress);
  const color = getFluencyColor(fluency.score);

  return (
    <span
      data-testid="live-fluency-ring"
      title={`Fluency: ${fluency.score} — ${fluency.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 8 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border, #e5e7eb)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
        />
        {/* Score number */}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={11}
          fontWeight={700}
          style={{ transition: 'fill 0.6s ease' }}
        >
          {Math.round(fluency.score)}
        </text>
      </svg>
    </span>
  );
}

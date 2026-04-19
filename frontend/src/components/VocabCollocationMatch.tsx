import { useState, useEffect, useCallback } from 'react';
import { Check, X, ArrowRight, Volume2 } from 'lucide-react';
import {
  api,
  getVocabularyCollocations,
  type VocabCollocationItem,
} from '../api';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

export interface VocabCollocationMatchResult {
  total: number;
  correct: number;
  incorrect: number;
}

interface Props {
  topic: string;
  count?: number;
  onComplete: (result: VocabCollocationMatchResult) => void;
  onBack?: () => void;
  /** Test seam — inject pre-fetched items instead of calling the API. */
  initialItems?: VocabCollocationItem[];
}

/**
 * Vocabulary Collocation Match mini-mode (autoresearch #661).
 *
 * Renders a sequence of fill-in-the-blank multiple-choice items where the
 * learner picks the most natural collocate for a target vocabulary word.
 * After each answer the SRS row for that word is updated via the existing
 * /api/vocabulary/answer endpoint, mirroring other vocabulary modes.
 */
export default function VocabCollocationMatch({
  topic,
  count = 5,
  onComplete,
  onBack,
  initialItems,
}: Props) {
  const [items, setItems] = useState<VocabCollocationItem[]>(initialItems ?? []);
  const [loading, setLoading] = useState(!initialItems);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const { speak } = useSpeechSynthesis();

  // Fetch items if not pre-supplied (real usage path).
  useEffect(() => {
    if (initialItems) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getVocabularyCollocations(topic, count)
      .then((res) => {
        if (cancelled) return;
        if (!res.items || res.items.length === 0) {
          setError('No collocation items available for this topic yet.');
        } else {
          setItems(res.items);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load collocation items. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topic, count, initialItems]);

  const current = items[index];
  const revealed = picked !== null;
  const isCorrect = revealed && current && picked === current.correct_index;

  const completedSentence = current
    ? current.prompt_sentence.replace('____', current.options[current.correct_index] ?? '')
    : '';

  const handlePick = useCallback(
    (optionIndex: number) => {
      if (!current || revealed) return;
      const correct = optionIndex === current.correct_index;
      setPicked(optionIndex);
      if (correct) {
        setCorrectCount((c) => c + 1);
      } else {
        setIncorrectCount((c) => c + 1);
      }
      // Speak the completed sentence on reveal.
      const sentence = current.prompt_sentence.replace(
        '____',
        current.options[current.correct_index] ?? '',
      );
      try {
        speak(sentence, 'en-US', 0.9);
      } catch {
        /* ignore speech errors */
      }
      // Update SRS in the background — mirror VocabSpellingBee pattern.
      api.submitAnswer(current.word_id, correct).catch(() => {
        /* ignore */
      });
    },
    [current, revealed, speak],
  );

  const handleNext = useCallback(() => {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setPicked(null);
    } else {
      setCompleted(true);
      onComplete({
        total: items.length,
        correct: correctCount,
        incorrect: incorrectCount,
      });
    }
  }, [index, items.length, correctCount, incorrectCount, onComplete]);

  if (loading) {
    return (
      <div data-testid="vocab-colloc-loading" style={{ padding: 24, textAlign: 'center' }}>
        Loading collocation items…
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="vocab-colloc-error" style={{ padding: 24 }}>
        <p style={{ color: 'var(--error, #b91c1c)' }}>{error}</p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              marginTop: 12, padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
              border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
            }}
          >
            ← Back
          </button>
        )}
      </div>
    );
  }

  if (completed) {
    const total = items.length;
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <div data-testid="vocab-colloc-results">
        <h2 style={{ marginBottom: 16 }}>🔗 Collocation Match — Results</h2>
        <div
          style={{
            padding: 20, borderRadius: 12, marginBottom: 20, textAlign: 'center',
            background: pct >= 70 ? 'var(--success-bg, #d1fae5)' : 'var(--warning-bg, #fef3c7)',
          }}
        >
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{pct}%</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {correctCount}/{total} correct
          </div>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              padding: '12px 24px', borderRadius: 8, cursor: 'pointer',
              border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
            }}
          >
            ← Back to Vocabulary
          </button>
        )}
      </div>
    );
  }

  if (!current) return null;

  return (
    <div data-testid="vocab-colloc-match">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🔗 Collocation Match</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {index + 1} / {items.length}
        </span>
      </div>

      <div
        style={{
          padding: 16, borderRadius: 12, marginBottom: 16,
          background: 'var(--card-bg, #f9fafb)', border: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          Target word: <strong style={{ color: 'var(--text)' }}>{current.word}</strong>
        </div>
        <p
          data-testid="vocab-colloc-prompt"
          style={{ fontSize: '1.1rem', margin: 0, lineHeight: 1.5 }}
        >
          {current.prompt_sentence}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        {current.options.map((opt, i) => {
          const isPicked = picked === i;
          const isAnswer = revealed && i === current.correct_index;
          const wrongPicked = revealed && isPicked && !isAnswer;
          return (
            <button
              key={i}
              type="button"
              data-testid={`vocab-colloc-option-${i}`}
              onClick={() => handlePick(i)}
              disabled={revealed}
              style={{
                padding: '12px 16px', borderRadius: 8,
                cursor: revealed ? 'default' : 'pointer',
                textAlign: 'left',
                border: isAnswer
                  ? '2px solid #16a34a'
                  : wrongPicked
                    ? '2px solid #dc2626'
                    : '2px solid var(--border)',
                background: isAnswer
                  ? 'var(--success-bg, #d1fae5)'
                  : wrongPicked
                    ? 'var(--error-bg, #fee2e2)'
                    : 'var(--bg)',
                color: 'var(--text)',
                fontSize: '1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{opt}</span>
              {isAnswer && <Check size={18} color="#16a34a" />}
              {wrongPicked && <X size={18} color="#dc2626" />}
            </button>
          );
        })}
      </div>

      {revealed && (
        <div
          data-testid="vocab-colloc-feedback"
          style={{
            padding: 12, borderRadius: 8, marginBottom: 16,
            background: isCorrect ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {isCorrect ? <Check size={18} color="#16a34a" /> : <X size={18} color="#dc2626" />}
            <strong>{isCorrect ? 'Correct!' : 'Not quite.'}</strong>
          </div>
          <div style={{ fontSize: '0.9rem', marginBottom: 6 }}>
            <Volume2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            <em>{completedSentence}</em>
          </div>
          {current.explanation && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {current.explanation}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {revealed ? (
          <button
            type="button"
            data-testid="vocab-colloc-next"
            onClick={handleNext}
            style={{
              flex: 1, padding: '12px', borderRadius: 8, cursor: 'pointer',
              border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {index + 1 < items.length ? (
              <>
                Next <ArrowRight size={16} />
              </>
            ) : (
              'See Results'
            )}
          </button>
        ) : (
          onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text)',
              }}
            >
              Quit
            </button>
          )
        )}
      </div>
    </div>
  );
}

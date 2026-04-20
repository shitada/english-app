import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Volume2, Check, X, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '../api';

export interface SpellingChallengeWord {
  id: number;
  word: string;
  meaning: string;
  example_sentence: string;
  difficulty: number;
}

interface SpellingChallengeProps {
  initialWords: SpellingChallengeWord[];
  onBack: () => void;
}

interface AttemptResult {
  word: SpellingChallengeWord;
  typed: string;
  result: 'exact' | 'close' | 'wrong';
  distance: number;
  replays: number;
}

function speak(text: string, rate = 0.9) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* TTS unavailable in test envs — ignore */
  }
}

function renderDiff(typed: string, correct: string) {
  const maxLen = Math.max(typed.length, correct.length);
  const chars: { char: string; color: string }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const c = correct[i] || '';
    const t = typed[i] || '';
    chars.push({
      char: c || '_',
      color: c && t.toLowerCase() === c.toLowerCase() ? 'green' : 'crimson',
    });
  }
  return chars;
}

const RESULT_STYLE: Record<AttemptResult['result'], { bg: string; border: string; color: string; label: string }> = {
  exact: { bg: 'var(--success-bg, #d1fae5)', border: '#10b981', color: '#065f46', label: 'Exact!' },
  close: { bg: 'var(--warning-bg, #fef3c7)', border: '#f59e0b', color: '#92400e', label: 'Close' },
  wrong: { bg: 'var(--error-bg, #fee2e2)', border: '#ef4444', color: '#991b1b', label: 'Try again' },
};

export default function SpellingChallenge({ initialWords, onBack }: SpellingChallengeProps) {
  const [queue, setQueue] = useState<SpellingChallengeWord[]>(initialWords);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<AttemptResult | null>(null);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'play' | 'result'>('play');
  const [replayCount, setReplayCount] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const w = queue[index];

  // Auto-play TTS for each new word.
  useEffect(() => {
    if (phase === 'play' && w && !feedback) {
      speak(w.word);
      setReplayCount(0);
      // Slight delay so autoFocus also restores focus after re-renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase]);

  const handleReplay = useCallback(() => {
    if (!w) return;
    setReplayCount((c) => c + 1);
    speak(w.word);
  }, [w]);

  const handleSubmit = useCallback(async () => {
    if (!w || submitting || feedback) return;
    setSubmitting(true);
    try {
      const res = await api.submitSpellingChallengeAnswer(w.id, input);
      const attempt: AttemptResult = {
        word: w,
        typed: input,
        result: res.result,
        distance: res.distance,
        replays: replayCount,
      };
      setFeedback(attempt);
    } catch {
      // Fall back to a local "wrong" verdict so the round can continue.
      setFeedback({
        word: w,
        typed: input,
        result: 'wrong',
        distance: -1,
        replays: replayCount,
      });
    } finally {
      setSubmitting(false);
    }
  }, [w, input, submitting, feedback, replayCount]);

  const handleNext = useCallback(() => {
    if (!feedback) return;
    setResults((prev) => [...prev, feedback]);
    setFeedback(null);
    setInput('');
    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      setPhase('result');
    }
  }, [feedback, index, queue.length]);

  const handleRetryMissed = useCallback(() => {
    const missed = results.filter((r) => r.result !== 'exact').map((r) => r.word);
    if (missed.length === 0) return;
    setQueue(missed);
    setResults([]);
    setIndex(0);
    setInput('');
    setFeedback(null);
    setPhase('play');
  }, [results]);

  const summary = useMemo(() => {
    const exact = results.filter((r) => r.result === 'exact').length;
    const close = results.filter((r) => r.result === 'close').length;
    const wrong = results.filter((r) => r.result === 'wrong').length;
    const total = results.length || 1;
    return { exact, close, wrong, pct: Math.round((exact / total) * 100) };
  }, [results]);

  if (phase === 'result') {
    const missedCount = summary.close + summary.wrong;
    return (
      <div data-testid="spelling-challenge-results">
        <h2 style={{ marginBottom: 16 }}>📝 Spelling Challenge — Results</h2>
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            marginBottom: 20,
            background: summary.pct >= 70 ? 'var(--success-bg, #d1fae5)' : 'var(--warning-bg, #fef3c7)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{summary.pct}%</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {summary.exact} exact · {summary.close} close · {summary.wrong} wrong
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          {results.map((r, i) => {
            const tone = RESULT_STYLE[r.result];
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {r.result === 'exact' ? (
                  <Check size={16} color="#10b981" />
                ) : r.result === 'close' ? (
                  <AlertTriangle size={16} color="#f59e0b" />
                ) : (
                  <X size={16} color="#ef4444" />
                )}
                <span style={{ fontWeight: 600 }}>{r.word.word}</span>
                <span style={{ color: tone.color, fontSize: '0.75rem', marginLeft: 4 }}>
                  ({tone.label})
                </span>
                {r.result !== 'exact' && (
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    you typed: "{r.typed}"
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {missedCount > 0 && (
            <button
              data-testid="spelling-challenge-retry-missed"
              onClick={handleRetryMissed}
              style={{
                padding: '12px 20px',
                borderRadius: 8,
                cursor: 'pointer',
                border: '2px solid #f59e0b',
                background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                color: '#92400e',
                fontWeight: 600,
              }}
            >
              <RotateCcw size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Retry missed ({missedCount})
            </button>
          )}
          <button
            onClick={onBack}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              cursor: 'pointer',
              border: 'none',
              background: 'var(--primary)',
              color: 'white',
              fontWeight: 600,
            }}
          >
            Back to Vocabulary
          </button>
        </div>
      </div>
    );
  }

  if (!w) return null;
  const tone = feedback ? RESULT_STYLE[feedback.result] : null;
  const showDiff = feedback && feedback.result === 'close';

  return (
    <div data-testid="spelling-challenge">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>📝 Spelling Challenge</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {index + 1} / {queue.length}
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: 6,
          borderRadius: 3,
          background: 'var(--border)',
          marginBottom: 20,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${(index / queue.length) * 100}%`,
            height: '100%',
            background: 'var(--primary)',
            borderRadius: 3,
            transition: 'width 0.3s',
          }}
        />
      </div>

      <div
        style={{
          padding: 20,
          borderRadius: 12,
          marginBottom: 16,
          background: 'var(--card-bg, #f9fafb)',
          border: '1px solid var(--border)',
          textAlign: 'center',
        }}
      >
        <button
          data-testid="spelling-challenge-replay"
          onClick={handleReplay}
          style={{
            padding: '14px 28px',
            borderRadius: 12,
            cursor: 'pointer',
            border: '2px solid #6366f1',
            background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)',
            color: '#3730a3',
            fontWeight: 600,
            fontSize: '1rem',
            marginBottom: 12,
          }}
        >
          <Volume2 size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          {replayCount === 0 ? 'Replay word' : `Replay (${replayCount})`}
        </button>

        <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          Hint: {w.meaning}
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          ref={inputRef}
          data-testid="spelling-challenge-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (feedback) handleNext();
              else if (input.trim()) handleSubmit();
            }
          }}
          placeholder="Type the spelling..."
          disabled={!!feedback || submitting}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 8,
            fontSize: '1.1rem',
            border: tone
              ? `2px solid ${tone.border}`
              : '2px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            boxSizing: 'border-box',
            letterSpacing: '0.05em',
          }}
          aria-label="Type the spelling of the word"
        />
      </div>

      {feedback && tone && (
        <div
          data-testid="spelling-challenge-feedback"
          style={{
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            background: tone.bg,
            color: tone.color,
            border: `1px solid ${tone.border}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: showDiff || feedback.result === 'wrong' ? 8 : 0, fontWeight: 600 }}>
            {feedback.result === 'exact' ? (
              <Check size={18} />
            ) : feedback.result === 'close' ? (
              <AlertTriangle size={18} />
            ) : (
              <X size={18} />
            )}
            <span>{tone.label}</span>
            {feedback.distance > 0 && (
              <span style={{ fontWeight: 400, fontSize: '0.85rem' }}>
                (distance {feedback.distance})
              </span>
            )}
          </div>
          {showDiff && (
            <div style={{ fontSize: '1.1rem', letterSpacing: '0.1em' }}>
              {renderDiff(feedback.typed, feedback.word.word).map((c, i) => (
                <span key={i} style={{ color: c.color, fontWeight: 700 }}>
                  {c.char}
                </span>
              ))}
            </div>
          )}
          {feedback.result === 'wrong' && (
            <div style={{ fontSize: '0.95rem' }}>
              Correct spelling: <strong>{feedback.word.word}</strong>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {!feedback ? (
          <button
            data-testid="spelling-challenge-submit"
            onClick={handleSubmit}
            disabled={!input.trim() || submitting}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 8,
              cursor: 'pointer',
              border: 'none',
              background: 'var(--primary)',
              color: 'white',
              fontWeight: 600,
              opacity: input.trim() && !submitting ? 1 : 0.5,
            }}
          >
            Submit
          </button>
        ) : (
          <button
            data-testid="spelling-challenge-next"
            onClick={handleNext}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 8,
              cursor: 'pointer',
              border: 'none',
              background: 'var(--primary)',
              color: 'white',
              fontWeight: 600,
            }}
          >
            {index + 1 < queue.length ? (
              <>
                <ArrowRight size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Next
              </>
            ) : (
              'See Results'
            )}
          </button>
        )}
        <button
          onClick={onBack}
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            cursor: 'pointer',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            fontWeight: 500,
          }}
        >
          Exit
        </button>
      </div>
    </div>
  );
}

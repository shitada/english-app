import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Headphones, RotateCcw, Volume2 } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  fetchPausePredictSession,
  submitPausePredict,
  completePausePredictSession,
  type PausePredictDifficulty,
  type PausePredictItem,
  type PausePredictSubmitResponse,
} from '../api';

type Phase = 'select' | 'loading' | 'listen' | 'reveal' | 'summary' | 'error';

interface AttemptRecord {
  item: PausePredictItem;
  userAnswer: string;
  result: PausePredictSubmitResponse;
}

const SESSION_SIZE = 5;
const MAX_REPLAYS = 3;

const DIFFICULTIES: {
  id: PausePredictDifficulty;
  emoji: string;
  label: string;
  desc: string;
}[] = [
  { id: 'beginner', emoji: '🌱', label: 'Beginner', desc: 'Everyday short sentences (A2)' },
  { id: 'intermediate', emoji: '🌿', label: 'Intermediate', desc: 'Natural complete sentences (B1)' },
  { id: 'advanced', emoji: '🌲', label: 'Advanced', desc: 'Nuanced language (B2/C1)' },
];

function accuracyColor(pct: number): string {
  if (pct >= 80) return '#10b981';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

export default function PausePredictPage() {
  const tts = useSpeechSynthesis();

  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<PausePredictDifficulty>('beginner');
  const [errorMsg, setErrorMsg] = useState('');

  const [items, setItems] = useState<PausePredictItem[]>([]);
  const [index, setIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [replays, setReplays] = useState(0);
  const [feedback, setFeedback] = useState<PausePredictSubmitResponse | null>(null);
  const [results, setResults] = useState<AttemptRecord[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = items[index] || null;
  const progressLabel = useMemo(
    () => (items.length > 0 ? `${Math.min(index + 1, items.length)} / ${items.length}` : ''),
    [index, items.length],
  );

  const playPrefix = useCallback(() => {
    if (!current) return;
    tts.speak(current.prefix_text, 'en-US');
  }, [current, tts]);

  const playFull = useCallback(() => {
    if (!current) return;
    tts.speak(current.full_sentence, 'en-US');
  }, [current, tts]);

  const startSession = useCallback(
    async (diff: PausePredictDifficulty) => {
      setErrorMsg('');
      setPhase('loading');
      setItems([]);
      setIndex(0);
      setUserAnswer('');
      setReplays(0);
      setFeedback(null);
      setResults([]);
      try {
        const data = await fetchPausePredictSession(diff, SESSION_SIZE);
        if (!data.items || data.items.length === 0) {
          throw new Error('No items returned');
        }
        setItems(data.items);
        setDifficulty(diff);
        setPhase('listen');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load session');
        setPhase('error');
      }
    },
    [],
  );

  // Auto-play prefix when a new listen phase begins
  useEffect(() => {
    if (phase === 'listen' && current) {
      const id = window.setTimeout(() => {
        tts.speak(current.prefix_text, 'en-US');
      }, 250);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [phase, current, tts]);

  useEffect(() => {
    if (phase === 'listen' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [phase, index]);

  const handleReplay = useCallback(() => {
    if (!current || replays >= MAX_REPLAYS) return;
    setReplays((n) => n + 1);
    playPrefix();
  }, [current, replays, playPrefix]);

  const handleSubmit = useCallback(async () => {
    if (!current || !userAnswer.trim()) return;
    try {
      const res = await submitPausePredict({
        item_id: current.id,
        user_answer: userAnswer.trim(),
        expected: current.expected_completion,
        alternatives: current.alternatives,
      });
      setFeedback(res);
      setResults((prev) => [
        ...prev,
        { item: current, userAnswer: userAnswer.trim(), result: res },
      ]);
      setPhase('reveal');
      // Auto-play full sentence on reveal
      window.setTimeout(() => {
        tts.speak(current.full_sentence, 'en-US');
      }, 200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Submit failed');
      setPhase('error');
    }
  }, [current, userAnswer, tts]);

  const handleNext = useCallback(async () => {
    const nextIndex = index + 1;
    if (nextIndex >= items.length) {
      // Summary
      const total = results.length;
      const correct = results.filter((r) => r.result.is_correct).length;
      const close = results.filter((r) => r.result.is_close).length;
      const avgScore =
        total > 0
          ? results.reduce((sum, r) => sum + r.result.score, 0) / total
          : 0;
      try {
        await completePausePredictSession({
          difficulty,
          total,
          correct,
          close,
          avg_score: Number(avgScore.toFixed(4)),
        });
      } catch {
        // non-fatal
      }
      setPhase('summary');
      return;
    }
    setIndex(nextIndex);
    setUserAnswer('');
    setReplays(0);
    setFeedback(null);
    setPhase('listen');
  }, [index, items.length, results, difficulty]);

  const handleReplayMissed = useCallback(() => {
    const missed = results.filter((r) => !r.result.is_correct).map((r) => r.item);
    if (missed.length === 0) return;
    setItems(missed);
    setIndex(0);
    setUserAnswer('');
    setReplays(0);
    setFeedback(null);
    setResults([]);
    setPhase('listen');
  }, [results]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea';

      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        if (phase === 'listen') handleReplay();
        else if (phase === 'reveal') playFull();
      } else if (e.key === 'Enter' && phase === 'listen' && isInput) {
        // Let the form handle it
      } else if (e.key.toLowerCase() === 'n' && phase === 'reveal' && !isInput) {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, handleReplay, handleNext, playFull]);

  // ---- Renders ---------------------------------------------------------

  const summary = useMemo(() => {
    const total = results.length;
    const correct = results.filter((r) => r.result.is_correct).length;
    const close = results.filter((r) => r.result.is_close).length;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const closeRate = total > 0 ? Math.round((close / total) * 100) : 0;
    const avgScore =
      total > 0
        ? results.reduce((sum, r) => sum + r.result.score, 0) / total
        : 0;
    return { total, correct, close, accuracy, closeRate, avgScore };
  }, [results]);

  const missed = useMemo(
    () => results.filter((r) => !r.result.is_correct),
    [results],
  );

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1rem' }}>
      <Link
        to="/"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: 'var(--text-secondary)', textDecoration: 'none',
          fontSize: 14, marginBottom: '1rem',
        }}
      >
        <ArrowLeft size={16} /> Back to home
      </Link>

      <h1
        data-testid="pause-predict-title"
        style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}
      >
        🎧 Pause &amp; Predict
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
        Listen to a sentence cut off before the final word or two, then type the
        completion you expect. Train your top-down prediction.
      </p>

      {phase === 'select' && (
        <section data-testid="pause-predict-select">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Choose difficulty
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                data-testid={`pause-predict-difficulty-${d.id}`}
                onClick={() => setDifficulty(d.id)}
                style={{
                  textAlign: 'left',
                  padding: '1rem',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background: difficulty === d.id ? 'var(--primary-soft, #eef2ff)' : 'var(--surface, #fff)',
                  color: 'var(--text-primary)',
                  border: difficulty === d.id
                    ? '2px solid var(--primary, #6366f1)'
                    : '1px solid var(--border, #e5e7eb)',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>{d.emoji}</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{d.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.desc}</div>
              </button>
            ))}
          </div>
          <button
            data-testid="pause-predict-start"
            onClick={() => startSession(difficulty)}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              background: '#6366f1',
              color: 'white',
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Start drill
          </button>
        </section>
      )}

      {phase === 'loading' && (
        <div data-testid="pause-predict-loading" style={{ textAlign: 'center', padding: '2rem' }}>
          Loading sentences...
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="pause-predict-error"
          style={{
            padding: '1rem',
            border: '1px solid #ef4444',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.08)',
            color: '#ef4444',
            marginBottom: 16,
          }}
        >
          <strong>Error:</strong> {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => setPhase('select')}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                color: 'inherit',
              }}
            >
              Back to start
            </button>
          </div>
        </div>
      )}

      {(phase === 'listen' || phase === 'reveal') && current && (
        <section
          data-testid="pause-predict-drill"
          className="card"
          style={{
            padding: '1.25rem',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 12,
            background: 'var(--surface, #fff)',
          }}
        >
          <div
            data-testid="pause-predict-progress"
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              marginBottom: 10,
            }}
          >
            Item {progressLabel}
          </div>

          {current.context_hint && (
            <div
              data-testid="pause-predict-context"
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                marginBottom: 10,
                fontStyle: 'italic',
              }}
            >
              Context: {current.context_hint}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button
              data-testid="pause-predict-replay"
              onClick={handleReplay}
              disabled={replays >= MAX_REPLAYS || phase !== 'listen'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid var(--border, #e5e7eb)',
                background: 'transparent',
                color: 'inherit',
                cursor: replays >= MAX_REPLAYS || phase !== 'listen' ? 'not-allowed' : 'pointer',
                opacity: replays >= MAX_REPLAYS || phase !== 'listen' ? 0.5 : 1,
              }}
              title="Replay prefix (Space)"
            >
              <Headphones size={16} /> Replay ({MAX_REPLAYS - replays} left)
            </button>
            {phase === 'reveal' && (
              <button
                data-testid="pause-predict-play-full"
                onClick={playFull}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
                title="Play full sentence"
              >
                <Volume2 size={16} /> Play full sentence
              </button>
            )}
          </div>

          {phase === 'listen' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              <label
                htmlFor="pause-predict-answer"
                style={{ display: 'block', fontSize: 13, marginBottom: 6, color: 'var(--text-secondary)' }}
              >
                Type the expected completion (1-3 words):
              </label>
              <input
                id="pause-predict-answer"
                ref={inputRef}
                data-testid="pause-predict-input"
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="your prediction..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 16,
                  borderRadius: 8,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--surface, #fff)',
                  color: 'var(--text-primary)',
                  marginBottom: 12,
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <button
                data-testid="pause-predict-submit"
                type="submit"
                disabled={!userAnswer.trim()}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  background: '#6366f1',
                  color: 'white',
                  border: 'none',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: userAnswer.trim() ? 'pointer' : 'not-allowed',
                  opacity: userAnswer.trim() ? 1 : 0.6,
                }}
              >
                Submit (Enter)
              </button>
            </form>
          )}

          {phase === 'reveal' && feedback && (
            <div data-testid="pause-predict-reveal">
              <div
                data-testid="pause-predict-result"
                style={{
                  padding: '10px 14px',
                  marginBottom: 12,
                  borderRadius: 8,
                  background: feedback.is_correct
                    ? 'rgba(16,185,129,0.12)'
                    : feedback.is_close
                    ? 'rgba(245,158,11,0.12)'
                    : 'rgba(239,68,68,0.12)',
                  color: feedback.is_correct
                    ? '#10b981'
                    : feedback.is_close
                    ? '#f59e0b'
                    : '#ef4444',
                  fontWeight: 600,
                }}
              >
                {feedback.is_correct
                  ? '✓ Correct!'
                  : feedback.is_close
                  ? '~ Close'
                  : '✗ Not quite'}
                <span
                  data-testid="pause-predict-score"
                  style={{ marginLeft: 10, fontWeight: 500 }}
                >
                  Score: {feedback.score.toFixed(2)}
                </span>
              </div>
              <p style={{ fontSize: 14, marginBottom: 10 }}>{feedback.feedback}</p>
              <div
                data-testid="pause-predict-full-sentence"
                style={{
                  padding: '10px 14px',
                  background: 'var(--surface-muted, #f9fafb)',
                  borderRadius: 8,
                  marginBottom: 14,
                  fontSize: 15,
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Full sentence:
                </div>
                <div>{current.full_sentence}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Expected: <strong>{feedback.expected}</strong>
                </div>
              </div>
              <button
                data-testid="pause-predict-next"
                onClick={handleNext}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  background: '#6366f1',
                  color: 'white',
                  border: 'none',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {index + 1 >= items.length ? 'See summary' : 'Next (N)'}
              </button>
            </div>
          )}
        </section>
      )}

      {phase === 'summary' && (
        <section
          data-testid="pause-predict-summary"
          className="card"
          style={{
            padding: '1.25rem',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 12,
            background: 'var(--surface, #fff)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
            Session summary
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Accuracy</div>
              <div
                data-testid="pause-predict-accuracy"
                style={{ fontSize: 24, fontWeight: 700, color: accuracyColor(summary.accuracy) }}
              >
                {summary.accuracy}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Close matches</div>
              <div
                data-testid="pause-predict-close-rate"
                style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}
              >
                {summary.closeRate}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg score</div>
              <div
                data-testid="pause-predict-avg-score"
                style={{ fontSize: 24, fontWeight: 700 }}
              >
                {summary.avgScore.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Items</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.total}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              data-testid="pause-predict-new-session"
              onClick={() => setPhase('select')}
              style={{
                padding: '10px 18px', borderRadius: 8,
                background: '#6366f1', color: 'white',
                border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              New session
            </button>
            {missed.length > 0 && (
              <button
                data-testid="pause-predict-replay-missed"
                onClick={handleReplayMissed}
                style={{
                  padding: '10px 18px', borderRadius: 8,
                  background: 'transparent',
                  border: '1px solid var(--border, #e5e7eb)',
                  color: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <RotateCcw size={14} /> Replay missed ({missed.length})
              </button>
            )}
          </div>

          {results.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                Your predictions
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {results.map((r, i) => (
                  <li
                    key={i}
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 20,
                        color: r.result.is_correct
                          ? '#10b981'
                          : r.result.is_close
                          ? '#f59e0b'
                          : '#ef4444',
                        fontWeight: 700,
                      }}
                    >
                      {r.result.is_correct ? '✓' : r.result.is_close ? '~' : '✗'}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      &ldquo;{r.item.prefix_text} ___&rdquo;
                    </span>
                    {' → '}
                    <strong>{r.userAnswer}</strong>
                    {!r.result.is_correct && (
                      <>
                        {' '}
                        <span style={{ color: 'var(--text-secondary)' }}>
                          (expected: {r.result.expected})
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

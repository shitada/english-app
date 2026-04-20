import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react';
import {
  createTenseContrastSession,
  submitTenseContrastAttempts,
  type TenseContrastItem,
  type TenseContrastAttemptInput,
  type TenseLabel,
} from '../api';

type Phase = 'intro' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AttemptResult {
  item: TenseContrastItem;
  user_answer: string;
  correct: boolean;
  elapsed_ms: number;
}

const SESSION_SIZE = 8;

const TENSE_LABELS: TenseLabel[] = [
  'past_simple',
  'present_perfect',
  'present_perfect_continuous',
];

const TENSE_DISPLAY: Record<TenseLabel, string> = {
  past_simple: 'Past Simple',
  present_perfect: 'Present Perfect',
  present_perfect_continuous: 'Present Perfect Continuous',
};

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

export function normalizeAnswer(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/, '')
    .trim();
}

export function isAnswerCorrect(
  userAnswer: string,
  correctForms: string[],
): boolean {
  const u = normalizeAnswer(userAnswer);
  if (!u) return false;
  return (correctForms || []).some((f) => u === normalizeAnswer(f));
}

function splitBlank(sentence: string): [string, string] {
  const idx = sentence.indexOf('____');
  if (idx < 0) return [sentence, ''];
  return [sentence.slice(0, idx), sentence.slice(idx + 4)];
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function TenseContrast() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [errorMsg, setErrorMsg] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [items, setItems] = useState<TenseContrastItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null);
  const startMsRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = items[index] || null;

  const loadSession = useCallback(async (retryMissed?: TenseContrastItem[]) => {
    setPhase('loading');
    setErrorMsg('');
    setAnswer('');
    setIndex(0);
    setResults([]);
    setLastResult(null);
    try {
      if (retryMissed && retryMissed.length > 0) {
        setSessionId(`tc-retry-${Date.now().toString(36)}`);
        setItems(retryMissed);
      } else {
        const data = await createTenseContrastSession(SESSION_SIZE);
        setSessionId(data.session_id);
        setItems(data.items);
      }
      setPhase('drill');
      startMsRef.current = Date.now();
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to load drill');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (phase === 'drill' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [phase, index]);

  const submitAnswer = () => {
    if (!current) return;
    const trimmed = answer.trim();
    if (!trimmed) return;
    const elapsed_ms = Math.max(0, Date.now() - startMsRef.current);
    const correct = isAnswerCorrect(trimmed, current.correct_form);
    const result: AttemptResult = {
      item: current,
      user_answer: trimmed,
      correct,
      elapsed_ms,
    };
    setLastResult(result);
    setResults((prev) => [...prev, result]);
    setPhase('feedback');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAnswer();
    }
  };

  const persistResults = useCallback(async (finalResults: AttemptResult[]) => {
    if (!sessionId || finalResults.length === 0) return;
    const answers: TenseContrastAttemptInput[] = finalResults.map((r) => ({
      item_id: r.item.id,
      user_answer: r.user_answer,
      correct: r.correct,
      tense_label: r.item.tense_label,
      elapsed_ms: r.elapsed_ms,
    }));
    try {
      await submitTenseContrastAttempts(sessionId, answers);
    } catch {
      /* best-effort */
    }
  }, [sessionId]);

  const nextItem = () => {
    if (index + 1 >= items.length) {
      const final = results;
      void persistResults(final);
      setPhase('summary');
      return;
    }
    setIndex((i) => i + 1);
    setAnswer('');
    setLastResult(null);
    setPhase('drill');
    startMsRef.current = Date.now();
  };

  const missedItems = useMemo(
    () => results.filter((r) => !r.correct).map((r) => r.item),
    [results],
  );

  const byTense = useMemo(() => {
    const buckets: Record<TenseLabel, { total: number; correct: number }> = {
      past_simple: { total: 0, correct: 0 },
      present_perfect: { total: 0, correct: 0 },
      present_perfect_continuous: { total: 0, correct: 0 },
    };
    for (const r of results) {
      const b = buckets[r.item.tense_label];
      if (b) {
        b.total += 1;
        if (r.correct) b.correct += 1;
      }
    }
    return buckets;
  }, [results]);

  const totalCorrect = results.filter((r) => r.correct).length;

  const [before, after] = current ? splitBlank(current.sentence_with_blank) : ['', ''];

  return (
    <div
      data-testid="tense-contrast-page"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '1rem',
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link
          to="/"
          aria-label="Back to home"
          style={{ display: 'flex', color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={20} />
        </Link>
        <h2 data-testid="tense-contrast-title" style={{ margin: 0, flex: 1 }}>
          ⏱️ Tense Contrast Drill
        </h2>
        {phase === 'drill' || phase === 'feedback' ? (
          <div
            data-testid="tense-contrast-progress"
            style={{ fontSize: 13, color: 'var(--text-secondary)' }}
          >
            {Math.min(index + 1, items.length)} / {items.length}
          </div>
        ) : null}
      </div>

      {phase === 'intro' && (
        <div
          data-testid="tense-contrast-intro"
          className="card"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '1rem',
            marginBottom: 16,
            background: 'var(--bg-card)',
          }}
        >
          <p style={{ marginTop: 0 }}>
            8 quick items contrasting <b>past simple</b>, <b>present perfect</b>, and{' '}
            <b>present perfect continuous</b>. Type the correct form of the verb in the
            blank.
          </p>
          <button
            data-testid="tense-contrast-start"
            onClick={() => loadSession()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary, #3b82f6)',
              color: 'white',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Start
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="tense-contrast-loading" style={{ padding: '2rem', textAlign: 'center' }}>
          Loading session…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="tense-contrast-error"
          style={{
            padding: '1rem',
            border: '1px solid #ef4444',
            borderRadius: 8,
            color: '#ef4444',
            marginBottom: 12,
          }}
        >
          {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => loadSession()}>Retry</button>
          </div>
        </div>
      )}

      {(phase === 'drill' || phase === 'feedback') && current && (
        <div
          data-testid="tense-contrast-drill"
          className="card"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '1rem',
            marginBottom: 16,
            background: 'var(--bg-card)',
          }}
        >
          <div
            data-testid="tense-contrast-sentence"
            style={{
              fontSize: 18,
              lineHeight: 1.5,
              marginBottom: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            <span>{before}</span>
            <input
              ref={inputRef}
              data-testid="tense-contrast-input"
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={phase === 'feedback'}
              placeholder="…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{
                minWidth: 120,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                fontSize: 16,
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
              }}
            />
            <span>{after}</span>
          </div>

          <div
            data-testid="tense-contrast-verb"
            style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}
          >
            Verb: <b>{current.verb_lemma}</b>
            {current.cue ? (
              <span style={{ marginLeft: 12 }}>
                Cue: <i>{current.cue}</i>
              </span>
            ) : null}
          </div>

          {phase === 'drill' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                data-testid="tense-contrast-submit"
                onClick={submitAnswer}
                disabled={!answer.trim()}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: answer.trim() ? 'var(--primary, #3b82f6)' : 'var(--border)',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: answer.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Submit
              </button>
            </div>
          )}

          {phase === 'feedback' && lastResult && (
            <div
              data-testid="tense-contrast-feedback"
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 8,
                background: lastResult.correct
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${lastResult.correct ? '#10b981' : '#ef4444'}`,
              }}
            >
              <div
                data-testid="tense-contrast-feedback-result"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  color: lastResult.correct ? '#10b981' : '#ef4444',
                  marginBottom: 6,
                }}
              >
                {lastResult.correct ? <Check size={18} /> : <X size={18} />}
                {lastResult.correct ? 'Correct!' : 'Not quite'}
              </div>
              <div
                data-testid="tense-contrast-accepted"
                style={{ fontSize: 13, marginBottom: 6 }}
              >
                Accepted: {current.correct_form.map((f) => `“${f}”`).join(', ')}
              </div>
              <div
                data-testid="tense-contrast-explanation"
                style={{ fontSize: 13, color: 'var(--text-secondary)' }}
              >
                {current.explanation}
              </div>
              <div style={{ marginTop: 10, textAlign: 'right' }}>
                <button
                  data-testid="tense-contrast-next"
                  onClick={nextItem}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--primary, #3b82f6)',
                    color: 'white',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {index + 1 >= items.length ? 'Finish' : 'Next →'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'summary' && (
        <div
          data-testid="tense-contrast-summary"
          className="card"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '1.25rem',
            background: 'var(--bg-card)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Session complete! 🎉</h3>
          <div
            data-testid="tense-contrast-score"
            style={{ fontSize: 32, fontWeight: 700, margin: '8px 0' }}
          >
            {totalCorrect} / {results.length}
          </div>

          <div style={{ marginTop: 12, marginBottom: 16 }}>
            {TENSE_LABELS.map((t) => {
              const info = byTense[t];
              const pct = info.total > 0 ? Math.round((info.correct / info.total) * 100) : 0;
              return (
                <div
                  key={t}
                  data-testid={`tense-contrast-bar-${t}`}
                  style={{ marginBottom: 10 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      marginBottom: 4,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>{TENSE_DISPLAY[t]}</span>
                    <span>
                      {info.correct} / {info.total} ({pct}%)
                    </span>
                  </div>
                  <div
                    style={{
                      background: 'var(--border, #e5e7eb)',
                      borderRadius: 4,
                      height: 10,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background:
                          pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {missedItems.length > 0 && (
            <div
              data-testid="tense-contrast-missed-list"
              style={{ marginTop: 12 }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Missed items</div>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {missedItems.map((it) => (
                  <li
                    key={it.id}
                    data-testid={`tense-contrast-missed-${it.id}`}
                    style={{ fontSize: 13, marginBottom: 4 }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {it.sentence_with_blank}
                    </span>{' '}
                    — <b>{it.correct_form[0]}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="tense-contrast-restart"
              onClick={() => loadSession()}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--primary, #3b82f6)',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              New session
            </button>
            {missedItems.length > 0 && (
              <button
                data-testid="tense-contrast-retry-missed"
                onClick={() => loadSession(missedItems)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry missed ({missedItems.length})
              </button>
            )}
            <Link
              to="/"
              data-testid="tense-contrast-home"
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Home
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

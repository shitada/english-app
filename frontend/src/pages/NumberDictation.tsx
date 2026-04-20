import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Volume2, RotateCcw, Check, X } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  startNumberDictation,
  answerNumberDictation,
  completeNumberDictation,
  type NumberDictationCategory,
  type NumberDictationItem,
  type NumberDictationAnswerResponse,
} from '../api';

type Phase = 'picker' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface Result {
  item: NumberDictationItem;
  user_answer: string;
  correct: boolean;
  expected_normalized: string;
  user_normalized: string;
}

const CATEGORIES: { id: NumberDictationCategory; label: string; icon: string; desc: string }[] = [
  { id: 'mixed', label: 'Mixed', icon: '🎲', desc: 'A bit of everything (recommended)' },
  { id: 'teens_vs_tens', label: 'Teens vs Tens', icon: '🔢', desc: 'fifteen vs fifty' },
  { id: 'prices', label: 'Prices', icon: '💲', desc: '$3.49, $129.99' },
  { id: 'dates', label: 'Dates', icon: '📅', desc: 'March 3rd, July 21st' },
  { id: 'times', label: 'Times', icon: '⏰', desc: '7:45, 12 o’clock' },
  { id: 'years', label: 'Years', icon: '📆', desc: '1969, 2019, 2024' },
  { id: 'phone', label: 'Phone Numbers', icon: '📞', desc: '415-555-1234' },
];

const SESSION_SIZE = 6;

export default function NumberDictation() {
  const tts = useSpeechSynthesis();
  const [phase, setPhase] = useState<Phase>('picker');
  const [errorMsg, setErrorMsg] = useState('');
  const [category, setCategory] = useState<NumberDictationCategory>('mixed');
  const [sessionId, setSessionId] = useState('');
  const [items, setItems] = useState<NumberDictationItem[]>([]);
  const [index, setIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [feedback, setFeedback] = useState<NumberDictationAnswerResponse | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const current = items[index] || null;

  const speakCurrent = useCallback(() => {
    if (current) {
      try { tts.speak(current.spoken_form); } catch { /* ignore */ }
    }
  }, [current, tts]);

  // Auto-speak each new item
  useEffect(() => {
    if (phase === 'drill' && current) {
      const t = setTimeout(speakCurrent, 250);
      return () => clearTimeout(t);
    }
  }, [phase, current, speakCurrent]);

  const startSession = useCallback(async (cat: NumberDictationCategory, retryItems?: NumberDictationItem[]) => {
    setPhase('loading');
    setErrorMsg('');
    setIndex(0);
    setUserAnswer('');
    setFeedback(null);
    setResults([]);
    try {
      if (retryItems && retryItems.length > 0) {
        setSessionId(`retry-${Date.now()}`);
        setCategory(cat);
        setItems(retryItems);
        setPhase('drill');
        return;
      }
      const data = await startNumberDictation(cat, SESSION_SIZE);
      setSessionId(data.session_id);
      setCategory((data.category as NumberDictationCategory) || cat);
      setItems(data.items);
      setPhase('drill');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Failed to start session');
      setPhase('error');
    }
  }, []);

  const submit = useCallback(async () => {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const resp = await answerNumberDictation(current, userAnswer);
      setFeedback(resp);
      setResults((prev) => [
        ...prev,
        {
          item: current,
          user_answer: userAnswer,
          correct: resp.correct,
          expected_normalized: resp.expected_normalized,
          user_normalized: resp.user_normalized,
        },
      ]);
      setPhase('feedback');
    } catch (e) {
      setErrorMsg((e as Error).message || 'Failed to submit answer');
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }, [current, userAnswer, submitting]);

  const next = useCallback(async () => {
    setFeedback(null);
    setUserAnswer('');
    if (index + 1 >= items.length) {
      // Session done — persist summary
      try {
        await completeNumberDictation(
          sessionId,
          category,
          results.map((r) => ({
            item_id: r.item.id,
            category: r.item.category,
            correct: r.correct,
          })),
        );
      } catch {
        // best-effort; still show summary
      }
      setPhase('summary');
      return;
    }
    setIndex((i) => i + 1);
    setPhase('drill');
  }, [index, items.length, sessionId, category, results]);

  const missedItems = useMemo(
    () => results.filter((r) => !r.correct).map((r) => r.item),
    [results],
  );
  const accuracy = useMemo(() => {
    if (results.length === 0) return 0;
    return Math.round((results.filter((r) => r.correct).length / results.length) * 100);
  }, [results]);
  const byCategory = useMemo(() => {
    const acc: Record<string, { total: number; correct: number }> = {};
    for (const r of results) {
      const c = r.item.category;
      if (!acc[c]) acc[c] = { total: 0, correct: 0 };
      acc[c].total += 1;
      if (r.correct) acc[c].correct += 1;
    }
    return acc;
  }, [results]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }} data-testid="number-dictation-page">
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'inherit', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Home
        </Link>
      </div>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden>🔢</span> Number &amp; Date Dictation
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
        Decode tricky spoken numerics — prices, dates, times, years, and phone numbers.
      </p>

      {phase === 'picker' && (
        <div data-testid="number-dictation-picker" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8, fontSize: 16 }}>Pick a category</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                data-testid={`number-dictation-cat-${c.id}`}
                onClick={() => startSession(c.id)}
                className="card"
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '12px 14px', gap: 4, textAlign: 'left', cursor: 'pointer',
                  border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card-bg, transparent)',
                  color: 'inherit',
                }}
              >
                <div style={{ fontSize: 22 }}>{c.icon}</div>
                <div style={{ fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div style={{ marginTop: 24 }} data-testid="number-dictation-loading">Loading…</div>
      )}

      {phase === 'error' && (
        <div data-testid="number-dictation-error" style={{ marginTop: 24, color: '#ef4444' }}>
          {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setPhase('picker')}>Back</button>
          </div>
        </div>
      )}

      {phase === 'drill' && current && (
        <div style={{ marginTop: 16 }} data-testid="number-dictation-drill">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <span data-testid="number-dictation-progress">{index + 1} / {items.length}</span>
            {' · '}
            <span style={{ textTransform: 'capitalize' }}>{current.category.replace('_', ' ')}</span>
          </div>
          <div className="card" style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 12 }}>
            <button
              type="button"
              onClick={speakCurrent}
              data-testid="number-dictation-play"
              aria-label="Play audio"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              <Volume2 size={16} /> Play
            </button>
            <button
              type="button"
              onClick={speakCurrent}
              data-testid="number-dictation-replay"
              aria-label="Replay audio"
              style={{
                marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'inherit', cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} /> Replay
            </button>

            <div style={{ marginTop: 16 }}>
              <label htmlFor="nd-input" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Type what you heard
              </label>
              <input
                id="nd-input"
                data-testid="number-dictation-input"
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
                style={{
                  display: 'block', width: '100%', marginTop: 6, padding: '10px 12px',
                  fontSize: 18, borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--input-bg, transparent)', color: 'inherit',
                }}
                placeholder="e.g. 3.49 or March 3rd"
              />
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || userAnswer.trim().length === 0}
                data-testid="number-dictation-submit"
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: '#10b981', color: 'white', fontWeight: 600,
                  cursor: submitting || !userAnswer.trim() ? 'not-allowed' : 'pointer',
                  opacity: submitting || !userAnswer.trim() ? 0.5 : 1,
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'feedback' && current && feedback && (
        <div style={{ marginTop: 16 }} data-testid="number-dictation-feedback">
          <div className="card" style={{
            padding: '1rem', border: '1px solid var(--border)', borderRadius: 12,
            background: feedback.correct ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600 }}>
              {feedback.correct
                ? <><Check size={20} color="#10b981" /> <span data-testid="number-dictation-result-icon">✅ Correct!</span></>
                : <><X size={20} color="#ef4444" /> <span data-testid="number-dictation-result-icon">❌ Not quite</span></>}
            </div>
            <div style={{ marginTop: 8, fontSize: 14 }}>
              <div><strong>You wrote:</strong> {userAnswer || <em>(empty)</em>}</div>
              <div><strong>Expected:</strong> {current.expected_text}</div>
            </div>
            {current.hint && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }} data-testid="number-dictation-hint">
                💡 {current.hint}
              </div>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                onClick={next}
                data-testid="number-dictation-next"
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--primary, #3b82f6)', color: 'white', fontWeight: 600, cursor: 'pointer',
                }}
              >
                {index + 1 >= items.length ? 'See results' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <div style={{ marginTop: 16 }} data-testid="number-dictation-summary">
          <div className="card" style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 12 }}>
            <h3 style={{ marginTop: 0 }}>Session complete</h3>
            <div style={{ fontSize: 28, fontWeight: 700 }} data-testid="number-dictation-accuracy">
              {accuracy}%
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {results.filter((r) => r.correct).length} of {results.length} correct
            </div>
            {Object.keys(byCategory).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>By category</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} data-testid="number-dictation-cat-breakdown">
                  {Object.entries(byCategory).map(([cat, s]) => (
                    <li key={cat}>
                      <span style={{ textTransform: 'capitalize' }}>{cat.replace('_', ' ')}</span>
                      : {s.correct} / {s.total}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {missedItems.length > 0 && (
                <button
                  onClick={() => startSession(category, missedItems)}
                  data-testid="number-dictation-retry-missed"
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none',
                    background: '#f59e0b', color: 'white', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Practice missed again ({missedItems.length})
                </button>
              )}
              <button
                onClick={() => startSession(category)}
                data-testid="number-dictation-restart"
                style={{
                  padding: '8px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--primary, #3b82f6)', color: 'white', fontWeight: 600, cursor: 'pointer',
                }}
              >
                New session
              </button>
              <button
                onClick={() => setPhase('picker')}
                data-testid="number-dictation-change-category"
                style={{
                  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'transparent', color: 'inherit', cursor: 'pointer',
                }}
              >
                Change category
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

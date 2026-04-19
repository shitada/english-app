import { useCallback, useEffect, useState } from 'react';
import { Hash, Headphones, RefreshCw, Send } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  getNumbersDrill,
  submitNumbersDrill,
  type NumbersDrillItem,
  type NumbersDrillResultItem,
} from '../api';

type Phase = 'idle' | 'drilling' | 'submitting' | 'done';

function sanitizeForTTS(text: string): string {
  // Speak the natural language form; strip markdown / odd characters but keep
  // commas and digits so the SpeechSynthesis engine reads them naturally.
  return text.replace(/[*_`]/g, '').trim();
}

export default function QuickNumbersDatesCard() {
  const tts = useSpeechSynthesis();

  const [items, setItems] = useState<NumbersDrillItem[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<NumbersDrillResultItem[]>([]);
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const fetchDrill = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setScore(null);
    setAnswers({});
    setPhase('idle');
    try {
      const res = await getNumbersDrill();
      setItems(res.items || []);
      if (res.items && res.items.length > 0) setPhase('drilling');
    } catch {
      setError('Could not load drill. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchDrill();
    }
  }, [initialized, fetchDrill]);

  const speakItem = useCallback((it: NumbersDrillItem) => {
    if (!tts.isSupported) return;
    tts.setRate(slow ? 0.6 : 0.95);
    tts.speak(sanitizeForTTS(it.spoken_text));
  }, [tts, slow]);

  const handleSubmit = useCallback(async () => {
    if (!items.length) return;
    setPhase('submitting');
    try {
      const payload = items.map(it => ({
        id: it.id,
        kind: it.kind,
        expected_answer: it.expected_answer,
        accept_variants: it.accept_variants || [],
        user_answer: (answers[it.id] || '').trim(),
      }));
      const res = await submitNumbersDrill(payload);
      setResults(res.results);
      setScore({ correct: res.correct, total: res.total });
      setPhase('done');
    } catch {
      setError('Submission failed. Please try again.');
      setPhase('drilling');
    }
  }, [items, answers]);

  if (!tts.isSupported) {
    return (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Hash size={20} color="#0ea5e9" />
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Numbers &amp; Dates</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          This drill needs browser speech synthesis, which is not available here.
        </p>
      </div>
    );
  }

  return (
    <div className="card" data-testid="quick-numbers-dates-card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <Hash size={20} color="#0ea5e9" />
        <h3 style={{ margin: 0, fontSize: '1rem', flex: 1 }}>Quick Numbers &amp; Dates</h3>
        <label style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={slow}
            onChange={e => setSlow(e.target.checked)}
            data-testid="qp-numbers-slow-toggle"
          />
          Slow
        </label>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
        Listen to each clip and type the price, year, phone, time, date or quantity you hear.
      </p>

      {loading && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading drill…</p>
      )}

      {error && (
        <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>{error}</p>
      )}

      {!loading && phase !== 'idle' && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {items.map((it, idx) => {
            const result = results.find(r => r.id === it.id);
            const isCorrect = result?.is_correct;
            return (
              <div
                key={it.id}
                data-testid={`qp-numbers-item-${it.id}`}
                style={{
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 8,
                  padding: '0.5rem 0.6rem',
                  background: result
                    ? (isCorrect ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)')
                    : 'var(--bg, #f8fafc)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600,
                    color: 'var(--text-secondary)', textTransform: 'uppercase',
                  }}>
                    #{idx + 1} · {it.kind}
                  </span>
                  <button
                    type="button"
                    onClick={() => speakItem(it)}
                    aria-label={`Play item ${idx + 1}`}
                    style={{
                      marginLeft: 'auto',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--primary, #3b82f6)',
                      display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem',
                    }}
                  >
                    <Headphones size={14} /> Replay
                  </button>
                </div>
                <input
                  type="text"
                  value={answers[it.id] || ''}
                  onChange={e => setAnswers(a => ({ ...a, [it.id]: e.target.value }))}
                  placeholder={it.hint || 'Type what you hear…'}
                  disabled={phase === 'submitting' || phase === 'done'}
                  data-testid={`qp-numbers-input-${it.id}`}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '0.4rem 0.55rem', borderRadius: 6,
                    border: '1px solid var(--border, #d1d5db)',
                    fontSize: '0.9rem',
                    background: 'var(--card-bg, white)',
                    color: 'var(--text, #1e293b)',
                  }}
                />
                {result && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}>
                    <span style={{
                      fontWeight: 600,
                      color: isCorrect ? '#16a34a' : '#dc2626',
                    }}>
                      {isCorrect ? '✓ Correct' : '✗ Incorrect'}
                    </span>
                    {!isCorrect && (
                      <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                        Expected: <strong>{result.expected_answer}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
            {phase !== 'done' ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={phase === 'submitting'}
                className="btn btn-primary"
                data-testid="qp-numbers-submit"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Send size={14} /> {phase === 'submitting' ? 'Checking…' : 'Submit answers'}
              </button>
            ) : (
              <button
                type="button"
                onClick={fetchDrill}
                className="btn btn-primary"
                data-testid="qp-numbers-retry"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <RefreshCw size={14} /> Try another set
              </button>
            )}
            {score && (
              <span
                data-testid="qp-numbers-score"
                style={{
                  alignSelf: 'center', fontSize: '0.95rem', fontWeight: 700,
                  color: score.correct === score.total ? '#16a34a'
                       : score.correct >= Math.ceil(score.total / 2) ? '#f59e0b' : '#dc2626',
                }}
              >
                {score.correct} / {score.total}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

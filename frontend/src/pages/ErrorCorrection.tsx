import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react';
import {
  errorCorrection,
  type ErrorCorrectionCategory,
  type ErrorCorrectionDiffToken,
  type ErrorCorrectionFinishResponse,
  type ErrorCorrectionGradeResponse,
  type ErrorCorrectionItem,
  type ErrorCorrectionLevel,
} from '../api';

type Phase = 'pick' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AttemptRecord {
  item: ErrorCorrectionItem;
  user_answer: string;
  is_correct: boolean;
  reference: string;
  explanation_ja: string;
  diff: ErrorCorrectionDiffToken[];
}

const CATEGORIES: { value: ErrorCorrectionCategory; label: string }[] = [
  { value: 'subject_verb_agreement', label: 'Subject-verb agreement' },
  { value: 'article', label: 'Articles (a/an/the)' },
  { value: 'preposition', label: 'Prepositions' },
  { value: 'tense', label: 'Tense' },
  { value: 'word_order', label: 'Word order' },
  { value: 'plural_countable', label: 'Plural / countable nouns' },
];

const LEVELS: { value: ErrorCorrectionLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

function DiffView({ diff }: { diff: ErrorCorrectionDiffToken[] }) {
  return (
    <div data-testid="error-correction-diff" style={{ fontSize: 15, lineHeight: 1.8 }}>
      {diff.map((tok, i) => {
        const base: React.CSSProperties = { marginRight: 6, padding: '2px 4px', borderRadius: 4 };
        if (tok.status === 'same') {
          return (
            <span key={i} style={base}>
              {tok.token}
            </span>
          );
        }
        if (tok.status === 'insert') {
          return (
            <span
              key={i}
              style={{
                ...base,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#dc2626',
                textDecoration: 'line-through',
              }}
              title="Extra word — should be removed"
            >
              {tok.token}
            </span>
          );
        }
        // delete — missing from user's answer
        return (
          <span
            key={i}
            style={{
              ...base,
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#16a34a',
              fontWeight: 600,
            }}
            title="Missing — should be added"
          >
            {tok.token}
          </span>
        );
      })}
    </div>
  );
}

export default function ErrorCorrection() {
  const [phase, setPhase] = useState<Phase>('pick');
  const [errorMsg, setErrorMsg] = useState('');
  const [category, setCategory] = useState<ErrorCorrectionCategory>('tense');
  const [level, setLevel] = useState<ErrorCorrectionLevel>('beginner');
  const [sessionId, setSessionId] = useState('');
  const [items, setItems] = useState<ErrorCorrectionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [lastResult, setLastResult] = useState<ErrorCorrectionGradeResponse | null>(null);
  const [results, setResults] = useState<AttemptRecord[]>([]);
  const [summary, setSummary] = useState<ErrorCorrectionFinishResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const current = items[index] || null;

  const startDrill = useCallback(async () => {
    setErrorMsg('');
    setIndex(0);
    setUserAnswer('');
    setLastResult(null);
    setResults([]);
    setSummary(null);
    setPhase('loading');
    try {
      const data = await errorCorrection.startDrill(category, level, 5);
      if (!data.items || data.items.length === 0) {
        setErrorMsg('No items returned.');
        setPhase('error');
        return;
      }
      setSessionId(data.session_id);
      setItems(data.items);
      setPhase('drill');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to load drill');
      setPhase('error');
    }
  }, [category, level]);

  const handleSubmit = useCallback(async () => {
    if (!current || !userAnswer.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await errorCorrection.grade(sessionId, current.id, userAnswer.trim());
      setLastResult(res);
      setResults((prev) => [
        ...prev,
        {
          item: current,
          user_answer: userAnswer.trim(),
          is_correct: res.is_correct,
          reference: res.reference,
          explanation_ja: res.explanation_ja,
          diff: res.diff,
        },
      ]);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to grade answer');
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }, [current, userAnswer, sessionId, submitting]);

  const handleNext = useCallback(async () => {
    if (index + 1 >= items.length) {
      try {
        const fin = await errorCorrection.finish(sessionId);
        setSummary(fin);
      } catch {
        /* ignore — show summary based on local results */
      }
      setPhase('summary');
    } else {
      setIndex(index + 1);
      setUserAnswer('');
      setLastResult(null);
      setPhase('drill');
    }
  }, [index, items.length, sessionId]);

  const handleTextKey = useCallback(
    (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const overallPct = useMemo(() => {
    if (summary) return summary.score;
    if (results.length === 0) return 0;
    return Math.round((results.filter((r) => r.is_correct).length / results.length) * 100);
  }, [results, summary]);

  return (
    <div
      data-testid="error-correction-page"
      style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}
    >
      <Link
        to="/"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginBottom: '1rem', fontSize: 14, color: 'var(--text-secondary)',
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={16} /> Home
      </Link>

      <h1
        data-testid="error-correction-title"
        style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}
      >
        ✏️ Error Correction
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Read a sentence with one grammar mistake, then TYPE the corrected
        version. Submit with Enter (Shift+Enter = newline).
      </p>

      {phase === 'pick' && (
        <div data-testid="error-correction-intro">
          <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Category</span>
              <select
                data-testid="error-correction-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ErrorCorrectionCategory)}
                style={{
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border)', fontSize: 14,
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Level</span>
              <select
                data-testid="error-correction-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as ErrorCorrectionLevel)}
                style={{
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border)', fontSize: 14,
                }}
              >
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
          </div>

          <button
            data-testid="error-correction-start"
            onClick={startDrill}
            style={{
              padding: '10px 18px', borderRadius: 8, background: '#6366f1',
              color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer',
              fontSize: 15,
            }}
          >
            Start 5-item drill
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="error-correction-loading" style={{ padding: '2rem 0' }}>
          Loading items…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="error-correction-error"
          style={{ color: '#dc2626', padding: '1rem 0' }}
        >
          {errorMsg}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setPhase('pick')}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', cursor: 'pointer',
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {(phase === 'drill' || phase === 'feedback') && current && (
        <div data-testid="error-correction-drill">
          <div
            data-testid="error-correction-progress"
            style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}
          >
            {index + 1} / {items.length}
          </div>

          <div
            data-testid="error-correction-wrong"
            style={{
              padding: 12, borderRadius: 8, border: '1px solid var(--border)',
              background: 'rgba(239, 68, 68, 0.06)', marginBottom: 8,
              fontSize: 16, fontWeight: 500,
            }}
          >
            {current.wrong}
          </div>

          <div
            data-testid="error-correction-hint"
            style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}
          >
            ヒント: {current.hint_ja}
            {current.error_type && (
              <span style={{ marginLeft: 10, opacity: 0.8 }}>
                ({current.error_type})
              </span>
            )}
          </div>

          <textarea
            data-testid="error-correction-input"
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyDown={handleTextKey}
            placeholder="Type the corrected sentence…"
            rows={3}
            disabled={phase === 'feedback'}
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid var(--border)', fontSize: 15,
              fontFamily: 'inherit', resize: 'vertical',
              background: 'var(--bg-primary)', color: 'inherit',
            }}
          />

          {phase === 'drill' && (
            <div style={{ marginTop: 10 }}>
              <button
                data-testid="error-correction-submit"
                onClick={handleSubmit}
                disabled={!userAnswer.trim() || submitting}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  background: userAnswer.trim() ? '#6366f1' : 'var(--border)',
                  color: 'white', border: 'none',
                  cursor: userAnswer.trim() ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}
              >
                Submit
              </button>
            </div>
          )}

          {phase === 'feedback' && lastResult && (
            <div
              data-testid="error-correction-feedback"
              style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                border: '1px solid var(--border)',
                background: lastResult.is_correct
                  ? 'rgba(34, 197, 94, 0.08)'
                  : 'rgba(239, 68, 68, 0.08)',
              }}
            >
              <div
                data-testid="error-correction-feedback-result"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontWeight: 600, marginBottom: 8,
                  color: lastResult.is_correct ? '#16a34a' : '#dc2626',
                }}
              >
                {lastResult.is_correct ? <Check size={18} /> : <X size={18} />}
                {lastResult.is_correct ? 'Correct!' : 'Not quite.'}
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Reference:
              </div>
              <div
                data-testid="error-correction-reference"
                style={{ fontSize: 15, marginBottom: 10 }}
              >
                {lastResult.reference}
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Diff (red = extra, green = missing):
              </div>
              <DiffView diff={lastResult.diff} />

              {lastResult.explanation_ja && (
                <div
                  data-testid="error-correction-explanation"
                  style={{ marginTop: 10, fontSize: 14, color: 'var(--text-secondary)' }}
                >
                  {lastResult.explanation_ja}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <button
                  data-testid="error-correction-next"
                  onClick={handleNext}
                  style={{
                    padding: '8px 16px', borderRadius: 8, background: '#6366f1',
                    color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {index + 1 >= items.length ? 'See summary' : 'Next'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'summary' && (
        <div data-testid="error-correction-summary">
          <div
            data-testid="error-correction-score"
            style={{ fontSize: 36, fontWeight: 700, marginBottom: 4 }}
          >
            {overallPct}%
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {(summary?.correct ?? results.filter((r) => r.is_correct).length)} /
            {' '}
            {(summary?.total ?? results.length)} correct
          </div>

          {(summary?.mistakes ?? results.filter((r) => !r.is_correct).map((r) => ({
            id: r.item.id,
            wrong: r.item.wrong,
            reference: r.reference,
            error_type: r.item.error_type,
            user_answer: r.user_answer,
            explanation_ja: r.explanation_ja,
          }))).length > 0 && (
            <div
              data-testid="error-correction-mistakes"
              style={{ marginBottom: 16 }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Missed:
              </div>
              <ul style={{ paddingLeft: 18, fontSize: 14, lineHeight: 1.5 }}>
                {(summary?.mistakes ??
                  results
                    .filter((r) => !r.is_correct)
                    .map((r) => ({
                      id: r.item.id,
                      wrong: r.item.wrong,
                      reference: r.reference,
                      error_type: r.item.error_type,
                      user_answer: r.user_answer,
                      explanation_ja: r.explanation_ja,
                    }))
                ).map((m) => (
                  <li key={m.id} style={{ marginBottom: 6 }}>
                    <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>
                      {m.wrong}
                    </span>
                    {' → '}
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>
                      {m.reference}
                    </span>
                    {m.error_type && (
                      <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>
                        ({m.error_type})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="error-correction-retry"
              onClick={() => setPhase('pick')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent', cursor: 'pointer', fontWeight: 600,
              }}
            >
              <RotateCcw size={16} /> Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

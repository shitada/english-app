import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RefreshCw } from 'lucide-react';
import {
  fetchConditionalPrompt,
  gradeConditionalAttempt,
  fetchConditionalHistory,
  type ConditionalPromptResponse,
  type ConditionalGradeResponse,
  type ConditionalHistoryItem,
} from '../api';

type Level = 'beginner' | 'intermediate' | 'advanced';
type Ttype = 0 | 1 | 2 | 3;

const TYPE_LABELS: Record<Ttype, string> = {
  0: 'Type 0 — general truth',
  1: 'Type 1 — real future',
  2: 'Type 2 — unreal present',
  3: 'Type 3 — unreal past',
};

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
const TYPES: Ttype[] = [0, 1, 2, 3];

export default function ConditionalsPage() {
  const [targetType, setTargetType] = useState<Ttype>(2);
  const [level, setLevel] = useState<Level>('intermediate');
  const [prompt, setPrompt] = useState<ConditionalPromptResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [grading, setGrading] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [result, setResult] = useState<ConditionalGradeResponse | null>(null);
  const [history, setHistory] = useState<ConditionalHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchConditionalHistory(20);
      setHistory(data.items);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const onNewPrompt = useCallback(async () => {
    setError(null);
    setResult(null);
    setAnswer('');
    setLoadingPrompt(true);
    try {
      const p = await fetchConditionalPrompt(targetType, level);
      setPrompt(p);
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch prompt');
    } finally {
      setLoadingPrompt(false);
    }
  }, [targetType, level]);

  const onSubmit = useCallback(async () => {
    if (!prompt || !answer.trim()) return;
    setGrading(true);
    setError(null);
    try {
      const r = await gradeConditionalAttempt({
        prompt_id: prompt.prompt_id,
        user_answer: answer.trim(),
      });
      setResult(r);
      loadHistory();
    } catch (err) {
      setError((err as Error).message || 'Failed to grade');
    } finally {
      setGrading(false);
    }
  }, [prompt, answer, loadHistory]);

  const scoreColor = useMemo(() => {
    if (!result) return 'var(--text-secondary)';
    if (result.correct) return '#16a34a';
    if (result.score >= 60) return '#f59e0b';
    return '#dc2626';
  }, [result]);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Link
          to="/"
          data-testid="conditionals-back"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} /> Home
        </Link>
        <h2 style={{ margin: 0, flex: 1 }} data-testid="conditionals-title">
          🔀 Conditional Drill (Type 0/1/2/3)
        </h2>
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>Target type</div>
        <div data-testid="conditionals-type-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`conditionals-type-${t}`}
              onClick={() => setTargetType(t)}
              style={{
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: t === targetType ? '#2563eb' : 'var(--bg-secondary)',
                color: t === targetType ? 'white' : 'var(--text-primary)',
                fontWeight: 600, fontSize: 13,
              }}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 10, fontWeight: 600 }}>Level</div>
        <div data-testid="conditionals-level-picker" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              data-testid={`conditionals-level-${lvl}`}
              onClick={() => setLevel(lvl)}
              style={{
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: lvl === level ? '#0ea5e9' : 'var(--bg-secondary)',
                color: lvl === level ? 'white' : 'var(--text-primary)',
                fontWeight: 600, fontSize: 13, textTransform: 'capitalize',
              }}
            >
              {lvl}
            </button>
          ))}
        </div>

        <button
          type="button"
          data-testid="conditionals-new-prompt"
          onClick={onNewPrompt}
          disabled={loadingPrompt}
          style={{
            padding: '10px 16px', borderRadius: 8,
            background: '#2563eb', color: 'white', border: 'none',
            cursor: loadingPrompt ? 'wait' : 'pointer',
            fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <RefreshCw size={14} />
          {loadingPrompt ? 'Loading…' : prompt ? 'New prompt' : 'Start drill'}
        </button>
      </div>

      {error && (
        <div
          data-testid="conditionals-error"
          style={{ padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b', marginBottom: 12 }}
        >
          {error}
        </div>
      )}

      {prompt && (
        <div className="card" data-testid="conditionals-prompt-card" style={{ padding: '1rem', marginBottom: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Rewrite as {TYPE_LABELS[prompt.target_type as Ttype]}
          </div>
          <div data-testid="conditionals-base-sentence" style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>
            {prompt.base_sentence}
          </div>
          {prompt.hint && (
            <div data-testid="conditionals-hint" style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              💡 {prompt.hint}
            </div>
          )}
          <textarea
            data-testid="conditionals-answer-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            placeholder="Type your conditional rewrite here…"
            style={{
              width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 15,
              fontFamily: 'inherit', resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              data-testid="conditionals-submit"
              onClick={onSubmit}
              disabled={grading || !answer.trim()}
              style={{
                padding: '10px 16px', borderRadius: 8,
                background: '#16a34a', color: 'white', border: 'none',
                cursor: grading || !answer.trim() ? 'not-allowed' : 'pointer',
                opacity: grading || !answer.trim() ? 0.6 : 1,
                fontWeight: 600,
              }}
            >
              {grading ? 'Grading…' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="card" data-testid="conditionals-result" style={{ padding: '1rem', marginBottom: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {result.correct ? (
              <Check size={20} color="#16a34a" data-testid="conditionals-verdict-correct" />
            ) : (
              <X size={20} color="#dc2626" data-testid="conditionals-verdict-incorrect" />
            )}
            <span style={{ fontWeight: 700, fontSize: 16, color: scoreColor }}>
              {result.correct ? 'Correct!' : 'Not quite.'}
            </span>
            <span data-testid="conditionals-score" style={{ marginLeft: 'auto', fontWeight: 700, color: scoreColor }}>
              Score: {result.score}/100
            </span>
          </div>
          {result.detected_type !== null && (
            <div data-testid="conditionals-detected-type" style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Detected type: {result.detected_type}
            </div>
          )}
          {result.model_answer && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Model answer</div>
              <div data-testid="conditionals-model-answer" style={{ fontWeight: 600 }}>{result.model_answer}</div>
            </div>
          )}
          {result.feedback && (
            <div data-testid="conditionals-feedback" style={{ marginBottom: 8 }}>
              {result.feedback}
            </div>
          )}
          {result.issues.length > 0 && (
            <ul data-testid="conditionals-issues" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
              {result.issues.map((iss, i) => (
                <li key={i}>{iss}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card" data-testid="conditionals-history" style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Recent attempts</div>
        {history.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No attempts yet — submit your first rewrite!</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {history.slice(0, 10).map((h) => (
              <li
                key={h.id}
                data-testid="conditionals-history-item"
                style={{
                  padding: '8px 0', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ fontWeight: 700, color: h.correct ? '#16a34a' : '#dc2626' }}>
                  {h.correct ? '✓' : '✗'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>T{h.target_type}</span>
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.user_answer}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{h.score}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

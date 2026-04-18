import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw, Send, FileSearch } from 'lucide-react';
import { getProofreadScenario, evaluateProofread } from '../api';
import type { ProofreadScenarioResponse, ProofreadEvaluateResponse } from '../api';

const DIFFICULTY_KEY = 'quick-practice-difficulty';

export default function QuickProofreadCard() {
  const [scenario, setScenario] = useState<ProofreadScenarioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'editing' | 'evaluating' | 'done'>('idle');
  const [userText, setUserText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ProofreadEvaluateResponse | null>(null);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getDifficulty = () => {
    try {
      const saved = localStorage.getItem(DIFFICULTY_KEY);
      if (saved && ['beginner', 'intermediate', 'advanced'].includes(saved)) return saved;
    } catch { /* ignore */ }
    return 'intermediate';
  };

  const fetchScenario = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await getProofreadScenario(getDifficulty());
      setScenario(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchScenario();
    }
  }, [initialized, fetchScenario]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === DIFFICULTY_KEY && phase === 'idle') {
        fetchScenario();
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [phase, fetchScenario]);

  const handleSubmit = useCallback(async () => {
    if (!scenario || !userText.trim() || submitting) return;
    setSubmitting(true);
    setPhase('evaluating');
    try {
      const res = await evaluateProofread({
        original_paragraph: scenario.paragraph_with_errors,
        user_corrected: userText.trim(),
        error_count: scenario.error_count,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setError(true);
      setPhase('editing');
    } finally {
      setSubmitting(false);
    }
  }, [scenario, userText, submitting]);

  const handleNext = useCallback(() => {
    setPhase('idle');
    setUserText('');
    setResult(null);
    setError(false);
    fetchScenario();
  }, [fetchScenario]);

  const scoreColor = (score: number) => {
    if (score >= 8) return 'var(--success-color, #16a34a)';
    if (score >= 5) return 'var(--accent-color, #4f46e5)';
    return 'var(--error-color, #dc2626)';
  };

  const scoreBarWidth = (score: number) => `${Math.max(0, Math.min(100, score * 10))}%`;

  if (error && !scenario) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <FileSearch size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Proofread</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !scenario ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Could not load proofreading exercise.</p>
      ) : phase === 'idle' || phase === 'editing' ? (
        <>
          {/* Paragraph with errors */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: '8px',
            margin: '0 0 0.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                📝 {scenario.topic}
              </span>
              <span style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'var(--error-bg, #fef2f2)',
                color: 'var(--error-color, #dc2626)',
                fontWeight: 600,
              }}>
                {scenario.error_count} error{scenario.error_count !== 1 ? 's' : ''} to find
              </span>
            </div>
            <p style={{
              fontSize: '0.9rem',
              margin: 0,
              color: 'var(--text)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {scenario.paragraph_with_errors}
            </p>
          </div>

          {/* User correction textarea */}
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.35rem' }}>
            Type the corrected version below:
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <textarea
              ref={textareaRef}
              value={userText}
              onChange={(e) => { setUserText(e.target.value); if (phase === 'idle') setPhase('editing'); }}
              placeholder="Type the corrected paragraph here…"
              rows={5}
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #ddd)',
                fontSize: '0.9rem',
                background: 'var(--bg-primary, #fff)',
                color: 'var(--text-primary)',
                resize: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.6,
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!userText.trim() || submitting}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: '#8b5cf6',
                color: '#fff',
                cursor: userText.trim() && !submitting ? 'pointer' : 'default',
                opacity: userText.trim() && !submitting ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                alignSelf: 'flex-end',
              }}
            >
              <Send size={16} /> {submitting ? '…' : 'Check'}
            </button>
          </div>
          {error && (
            <p style={{ color: 'var(--error-color, #dc2626)', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
              Evaluation failed. Please try again.
            </p>
          )}
        </>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your corrections…</p>
      ) : result ? (
        <>
          {/* Score summary */}
          <div style={{
            padding: '0.75rem',
            borderRadius: '8px',
            background: result.overall_score >= 6 ? 'var(--success-bg, #ecfdf5)' : 'var(--error-bg, #fef2f2)',
            border: `1px solid ${result.overall_score >= 6 ? 'var(--success-border, #86efac)' : 'var(--error-border, #fca5a5)'}`,
            marginBottom: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: scoreColor(result.overall_score) }}>
                {result.overall_score}/10
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                ✅ {result.errors_found} found · ❌ {result.errors_missed} missed
              </span>
            </div>
            {[
              { label: '🎯 Accuracy', score: result.accuracy_score },
              { label: '📖 Grammar', score: result.grammar_score },
              { label: '⭐ Overall', score: result.overall_score },
            ].map(({ label, score }) => (
              <div key={label} style={{ marginBottom: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.15rem' }}>
                  <span>{label}</span>
                  <strong style={{ color: scoreColor(score) }}>{score}/10</strong>
                </div>
                <div style={{
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--border, #e5e7eb)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: scoreBarWidth(score),
                    borderRadius: 3,
                    background: scoreColor(score),
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            ))}
            {result.feedback && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0' }}>
                💡 {result.feedback}
              </p>
            )}
          </div>

          {/* Corrections detail */}
          {result.corrections.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 0.35rem' }}>
                ✏️ Error Details
              </p>
              {result.corrections.map((c, i) => (
                <div key={i} style={{
                  fontSize: '0.8rem',
                  padding: '0.4rem 0.6rem',
                  background: 'var(--bg-secondary, #f9fafb)',
                  borderRadius: '6px',
                  marginBottom: '0.35rem',
                  borderLeft: `3px solid ${c.is_correct ? 'var(--success-color, #16a34a)' : 'var(--error-color, #dc2626)'}`,
                }}>
                  <div style={{ marginBottom: '0.15rem' }}>
                    <span style={{ textDecoration: 'line-through', color: 'var(--error-color, #dc2626)' }}>
                      {c.original}
                    </span>
                    {' → '}
                    <span style={{
                      color: c.is_correct ? 'var(--success-color, #16a34a)' : 'var(--text-secondary)',
                      fontWeight: 600,
                    }}>
                      {c.user_fix}
                    </span>
                    {!c.is_correct && c.correct_fix && (
                      <>
                        {' → '}
                        <span style={{ color: 'var(--success-color, #16a34a)', fontWeight: 600 }}>
                          {c.correct_fix}
                        </span>
                      </>
                    )}
                  </div>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: c.is_correct ? 'var(--success-bg, #ecfdf5)' : 'var(--error-bg, #fef2f2)',
                    color: c.is_correct ? 'var(--success-color, #16a34a)' : 'var(--error-color, #dc2626)',
                    fontWeight: 600,
                  }}>
                    {c.is_correct ? '✓ Found' : '✗ Missed'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Fully corrected version */}
          {result.fully_corrected_version && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.75rem',
              borderLeft: '3px solid #8b5cf6',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Fully Corrected Version
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {result.fully_corrected_version}
              </p>
            </div>
          )}

          <button
            onClick={handleNext}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #ddd)',
              background: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.9rem',
            }}
          >
            <RefreshCw size={14} /> Next Paragraph
          </button>
        </>
      ) : null}
    </div>
  );
}

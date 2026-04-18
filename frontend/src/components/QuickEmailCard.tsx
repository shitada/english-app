import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw, Send, Mail } from 'lucide-react';
import { getEmailScenario, evaluateEmail } from '../api';
import type { EmailScenarioResponse, EmailEvaluateResponse } from '../api';

const DIFFICULTY_KEY = 'quick-practice-difficulty';

export default function QuickEmailCard() {
  const [scenario, setScenario] = useState<EmailScenarioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'evaluating' | 'done'>('idle');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EmailEvaluateResponse | null>(null);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

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
      const res = await getEmailScenario(getDifficulty());
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
    if (!scenario || !subject.trim() || !body.trim() || submitting) return;
    setSubmitting(true);
    setPhase('evaluating');
    try {
      const res = await evaluateEmail({
        scenario: scenario.scenario,
        email_type: scenario.email_type,
        required_elements: scenario.required_elements,
        user_subject: subject.trim(),
        user_body: body.trim(),
      });
      setResult(res);
      setPhase('done');
    } catch {
      setError(true);
      setPhase('typing');
    } finally {
      setSubmitting(false);
    }
  }, [scenario, subject, body, submitting]);

  const handleNext = useCallback(() => {
    setPhase('idle');
    setSubject('');
    setBody('');
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
        <Mail size={20} color="#3b82f6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Email</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !scenario ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Could not load email exercise.</p>
      ) : phase === 'idle' || phase === 'typing' ? (
        <>
          {/* Scenario card */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: '8px',
            margin: '0 0 0.5rem',
          }}>
            <p style={{ fontSize: '0.9rem', margin: '0 0 0.25rem', fontWeight: 600, color: 'var(--text)' }}>
              📧 {scenario.scenario}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.35rem' }}>
              Type: <strong>{scenario.email_type}</strong> · {scenario.tone_guidance}
            </p>
            {/* Required elements checklist */}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 600 }}>Include:</span>
              <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', listStyle: 'none' }}>
                {scenario.required_elements.map((el, i) => (
                  <li key={i} style={{ marginBottom: '0.15rem' }}>
                    ☐ {el}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Subject input */}
          <input
            ref={subjectRef}
            value={subject}
            onChange={(e) => { setSubject(e.target.value); if (phase === 'idle') setPhase('typing'); }}
            placeholder="Subject line…"
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #ddd)',
              fontSize: '0.9rem',
              background: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              marginBottom: '0.5rem',
              boxSizing: 'border-box',
            }}
          />

          {/* Body textarea */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); if (phase === 'idle') setPhase('typing'); }}
              placeholder="Write your email body…"
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
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!subject.trim() || !body.trim() || submitting}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: '#3b82f6',
                color: '#fff',
                cursor: subject.trim() && body.trim() && !submitting ? 'pointer' : 'default',
                opacity: subject.trim() && body.trim() && !submitting ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                alignSelf: 'flex-end',
              }}
            >
              <Send size={16} /> {submitting ? '…' : 'Submit'}
            </button>
          </div>
          {error && (
            <p style={{ color: 'var(--error-color, #dc2626)', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
              Evaluation failed. Please try again.
            </p>
          )}
        </>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your email…</p>
      ) : result ? (
        <>
          {/* Score bars */}
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
            </div>
            {[
              { label: '📋 Format', score: result.format_score },
              { label: '🎭 Tone', score: result.tone_score },
              { label: '📖 Grammar', score: result.grammar_score },
              { label: '✅ Completeness', score: result.completeness_score },
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

          {/* Missing elements */}
          {result.missing_elements.length > 0 && (
            <div style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--error-bg, #fef2f2)',
              borderRadius: '6px',
              marginBottom: '0.75rem',
              borderLeft: '3px solid var(--error-color, #dc2626)',
            }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 0.25rem' }}>
                ⚠️ Missing Elements
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {result.missing_elements.map((el, i) => (
                  <li key={i}>{el}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Corrections */}
          {result.corrections.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 0.35rem' }}>
                ✏️ Corrections
              </p>
              {result.corrections.map((c, i) => (
                <div key={i} style={{
                  fontSize: '0.8rem',
                  padding: '0.4rem 0.6rem',
                  background: 'var(--bg-secondary, #f9fafb)',
                  borderRadius: '6px',
                  marginBottom: '0.35rem',
                  borderLeft: '3px solid #3b82f6',
                }}>
                  <span style={{ textDecoration: 'line-through', color: 'var(--error-color, #dc2626)' }}>{c.original}</span>
                  {' → '}
                  <span style={{ color: 'var(--success-color, #16a34a)', fontWeight: 600 }}>{c.corrected}</span>
                  {c.explanation && (
                    <p style={{ margin: '0.2rem 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {c.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Model email */}
          {(result.model_email_subject || result.model_email_body) && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.75rem',
              borderLeft: '3px solid #3b82f6',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Email
              </p>
              {result.model_email_subject && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: '0 0 0.25rem' }}>
                  <strong>Subject:</strong> {result.model_email_subject}
                </p>
              )}
              {result.model_email_body && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {result.model_email_body}
                </p>
              )}
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
            <RefreshCw size={14} /> Next Email
          </button>
        </>
      ) : null}
    </div>
  );
}

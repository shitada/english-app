import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw, Send, PenLine } from 'lucide-react';
import { getQuickWritePrompt, evaluateQuickWrite } from '../api';
import type { QuickWritePromptResponse, QuickWriteEvaluateResponse } from '../api';

export default function QuickWriteCard() {
  const [prompt, setPrompt] = useState<QuickWritePromptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'evaluating' | 'done'>('idle');
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuickWriteEvaluateResponse | null>(null);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await getQuickWritePrompt();
      setPrompt(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchPrompt();
    }
  }, [initialized, fetchPrompt]);

  const handleSubmit = useCallback(async () => {
    if (!prompt || !input.trim() || submitting) return;
    setSubmitting(true);
    setPhase('evaluating');
    try {
      const res = await evaluateQuickWrite(prompt.scenario, prompt.instruction, input.trim());
      setResult(res);
      setPhase('done');
    } catch {
      setError(true);
      setPhase('typing');
    } finally {
      setSubmitting(false);
    }
  }, [prompt, input, submitting]);

  const handleNext = useCallback(() => {
    setPhase('idle');
    setInput('');
    setResult(null);
    setError(false);
    fetchPrompt();
  }, [fetchPrompt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && phase === 'typing') {
      e.preventDefault();
      handleSubmit();
    }
  }, [phase, handleSubmit]);

  const scoreColor = (score: number) => {
    if (score >= 8) return 'var(--success-color, #16a34a)';
    if (score >= 5) return 'var(--accent-color, #4f46e5)';
    return 'var(--error-color, #dc2626)';
  };

  if (error && !prompt) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <PenLine size={20} color="#f59e0b" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Write</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Could not load writing exercise.</p>
      ) : phase === 'idle' || phase === 'typing' ? (
        <>
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: '8px',
            margin: '0 0 0.5rem',
          }}>
            <p style={{ fontSize: '0.9rem', margin: '0 0 0.25rem', fontWeight: 600, color: 'var(--text)' }}>
              📝 {prompt.scenario}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              {prompt.instruction}
            </p>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
            Suggested limit: ~{prompt.word_limit} words
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); if (phase === 'idle') setPhase('typing'); }}
              onKeyDown={handleKeyDown}
              placeholder="Write your response…"
              rows={3}
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
              disabled={!input.trim() || submitting}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: '#f59e0b',
                color: '#fff',
                cursor: input.trim() && !submitting ? 'pointer' : 'default',
                opacity: input.trim() && !submitting ? 1 : 0.5,
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your writing…</p>
      ) : result ? (
        <>
          {/* Scores */}
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <span>📖 Grammar: <strong style={{ color: scoreColor(result.grammar_score) }}>{result.grammar_score}/10</strong></span>
              <span>📚 Vocabulary: <strong style={{ color: scoreColor(result.vocabulary_score) }}>{result.vocabulary_score}/10</strong></span>
              <span>🎯 Naturalness: <strong style={{ color: scoreColor(result.naturalness_score) }}>{result.naturalness_score}/10</strong></span>
              <span>🎭 Register: <strong style={{ color: scoreColor(result.register_score) }}>{result.register_score}/10</strong></span>
            </div>
            {result.feedback && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                💡 {result.feedback}
              </p>
            )}
          </div>

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
                  borderLeft: '3px solid #f59e0b',
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

          {/* Model response */}
          {result.model_response && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.75rem',
              borderLeft: '3px solid #f59e0b',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Response
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_response}
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
            <RefreshCw size={14} /> Next
          </button>
        </>
      ) : null}
    </div>
  );
}

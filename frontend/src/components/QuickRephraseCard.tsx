import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw, Send, Repeat } from 'lucide-react';
import { api } from '../api';
import type { QuickRephrasePromptResponse } from '../api';

export default function QuickRephraseCard() {
  const [prompt, setPrompt] = useState<QuickRephrasePromptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'done'>('idle');
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    meaning_preserved: boolean;
    naturalness_score: number;
    variety_score: number;
    overall_score: number;
    feedback: string;
  } | null>(null);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.getQuickRephrasePrompt();
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
    try {
      const res = await api.evaluateRephrase(prompt.original_sentence, input.trim());
      setResult(res);
      setPhase('done');
    } catch {
      setError(true);
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
        <Repeat size={20} color="#14b8a6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Rephrase</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Could not load rephrase exercise.</p>
      ) : phase === 'idle' || phase === 'typing' ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
            {prompt.instruction}
          </p>
          <p style={{
            fontSize: '1rem',
            fontStyle: 'italic',
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: '8px',
            margin: '0 0 0.75rem',
            lineHeight: 1.5,
          }}>
            &ldquo;{prompt.original_sentence}&rdquo;
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setPhase('typing'); }}
              onKeyDown={handleKeyDown}
              placeholder="Type your rephrase…"
              rows={2}
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
                background: '#14b8a6',
                color: '#fff',
                cursor: input.trim() && !submitting ? 'pointer' : 'default',
                opacity: input.trim() && !submitting ? 1 : 0.5,
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
      ) : result ? (
        <>
          <div style={{
            padding: '0.75rem',
            borderRadius: '8px',
            background: result.overall_score >= 6 ? 'var(--success-bg, #ecfdf5)' : 'var(--error-bg, #fef2f2)',
            border: `1px solid ${result.overall_score >= 6 ? 'var(--success-border, #86efac)' : 'var(--error-border, #fca5a5)'}`,
            marginBottom: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: scoreColor(result.overall_score) }}>
                {result.overall_score}/10
              </span>
              <span style={{ fontSize: 14 }}>
                {result.meaning_preserved ? '✅ Meaning preserved' : '⚠️ Meaning changed'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <span>🎯 Naturalness: <strong style={{ color: scoreColor(result.naturalness_score) }}>{result.naturalness_score}/10</strong></span>
              <span>🔄 Variety: <strong style={{ color: scoreColor(result.variety_score) }}>{result.variety_score}/10</strong></span>
            </div>
            {result.feedback && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                💡 {result.feedback}
              </p>
            )}
          </div>
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

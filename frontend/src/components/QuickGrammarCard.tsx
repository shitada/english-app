import { useState, useCallback, useEffect, useRef } from 'react';
import { PenLine, RefreshCw, Send, CheckCircle2, XCircle } from 'lucide-react';
import { getRandomGrammarMistake, type GrammarMistake } from '../api';

export default function QuickGrammarCard() {
  const [mistake, setMistake] = useState<GrammarMistake | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'done'>('idle');
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [noMistakes, setNoMistakes] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchMistake = useCallback(async () => {
    setLoading(true);
    setNoMistakes(false);
    try {
      const res = await getRandomGrammarMistake();
      setMistake(res);
    } catch {
      setNoMistakes(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchMistake();
    }
  }, [initialized, fetchMistake]);

  const handleSubmit = useCallback(() => {
    if (!mistake || !input.trim()) return;
    setSubmitting(true);
    const normalizedInput = input.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
    const normalizedCorrect = mistake.corrected_text.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
    setIsCorrect(normalizedInput === normalizedCorrect);
    setPhase('done');
    setSubmitting(false);
  }, [mistake, input]);

  const handleNext = useCallback(() => {
    setPhase('idle');
    setInput('');
    setIsCorrect(false);
    fetchMistake();
  }, [fetchMistake]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && phase === 'typing') {
      handleSubmit();
    }
  }, [phase, handleSubmit]);

  if (noMistakes) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <PenLine size={20} />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Grammar Fix</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !mistake ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No grammar mistakes to review yet.</p>
      ) : phase === 'idle' || phase === 'typing' ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
            Fix the grammar error in this sentence:
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
            "{mistake.original_text}"
          </p>
          {mistake.error_fragment && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
              💡 Hint: check "<strong>{mistake.error_fragment}</strong>"
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setPhase('typing'); }}
              onKeyDown={handleKeyDown}
              placeholder="Type corrected sentence…"
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #ddd)',
                fontSize: '0.9rem',
                background: 'var(--bg-primary, #fff)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || submitting}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--accent-color, #4f46e5)',
                color: '#fff',
                cursor: input.trim() ? 'pointer' : 'default',
                opacity: input.trim() ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <Send size={16} /> Check
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{
            padding: '0.75rem',
            borderRadius: '8px',
            background: isCorrect ? 'var(--success-bg, #ecfdf5)' : 'var(--error-bg, #fef2f2)',
            border: `1px solid ${isCorrect ? 'var(--success-border, #86efac)' : 'var(--error-border, #fca5a5)'}`,
            marginBottom: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              {isCorrect ? <CheckCircle2 size={18} color="var(--success-color, #16a34a)" /> : <XCircle size={18} color="var(--error-color, #dc2626)" />}
              <strong style={{ color: isCorrect ? 'var(--success-color, #16a34a)' : 'var(--error-color, #dc2626)' }}>
                {isCorrect ? 'Correct!' : 'Not quite'}
              </strong>
            </div>
            {!isCorrect && (
              <>
                <p style={{ fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
                  <strong>Your answer:</strong> {input}
                </p>
                <p style={{ fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
                  <strong>Correct:</strong> {mistake.corrected_text}
                </p>
              </>
            )}
            {mistake.explanation && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0' }}>
                📝 {mistake.explanation}
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
      )}
    </div>
  );
}

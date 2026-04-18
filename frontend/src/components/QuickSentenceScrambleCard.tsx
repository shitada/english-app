import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Puzzle } from 'lucide-react';
import { getSentenceScramble } from '../api';
import type { SentenceScrambleResponse } from '../api';

export default function QuickSentenceScrambleCard() {
  const [data, setData] = useState<SentenceScrambleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Words remaining in the bank (indices into data.words)
  const [bankIndices, setBankIndices] = useState<number[]>([]);
  // Words the user has placed (indices into data.words)
  const [sentenceIndices, setSentenceIndices] = useState<number[]>([]);
  // Phase: building | correct | incorrect
  const [phase, setPhase] = useState<'building' | 'correct' | 'incorrect'>('building');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    setPhase('building');
    setSentenceIndices([]);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getSentenceScramble(difficulty);
      setData(res);
      setBankIndices(res.words.map((_, i) => i));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchData();
    }
  }, [initialized, fetchData]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        fetchData();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchData]);

  const handleWordTap = useCallback((idx: number) => {
    if (phase !== 'building') return;
    setBankIndices(prev => prev.filter(i => i !== idx));
    setSentenceIndices(prev => [...prev, idx]);
  }, [phase]);

  const handleWordRemove = useCallback((idx: number) => {
    if (phase !== 'building') return;
    setSentenceIndices(prev => prev.filter(i => i !== idx));
    setBankIndices(prev => [...prev, idx]);
  }, [phase]);

  const handleCheck = useCallback(() => {
    if (!data) return;
    // Build the user's sentence from placed word indices
    const userWords = sentenceIndices.map(i => data.words[i].toLowerCase());
    // Extract correct words from the sentence (strip punctuation)
    const correctWords = data.sentence
      .replace(/[.,!?;:'"()—–\-]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.toLowerCase());

    if (userWords.length === correctWords.length && userWords.every((w, i) => w === correctWords[i])) {
      setPhase('correct');
    } else {
      setPhase('incorrect');
    }
  }, [data, sentenceIndices]);

  const handleRetry = useCallback(() => {
    if (!data) return;
    setPhase('building');
    setSentenceIndices([]);
    setBankIndices(data.words.map((_, i) => i));
  }, [data]);

  const handleNext = useCallback(() => {
    fetchData();
  }, [fetchData]);

  if (error && !data) return null;

  const chipBase: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid var(--border, #d1d5db)',
    background: 'var(--bg-secondary, #f5f5f5)',
    color: 'var(--text, #1f2937)',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    transition: 'all 0.15s',
    userSelect: 'none' as const,
  };

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Puzzle size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Sentence Scramble</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !data ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Could not load exercise.</p>
      ) : (
        <>
          {/* Hint */}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
            💡 {data.hint}
          </p>

          {/* Sentence building area */}
          <div
            aria-label="Sentence building area"
            style={{
              minHeight: 56,
              padding: '10px 12px',
              borderRadius: 10,
              border: `2px dashed ${phase === 'correct' ? 'var(--success-border, #86efac)' : phase === 'incorrect' ? 'var(--error-border, #fca5a5)' : 'var(--border, #d1d5db)'}`,
              background: phase === 'correct'
                ? 'var(--success-bg, #ecfdf5)'
                : phase === 'incorrect'
                  ? 'var(--error-bg, #fef2f2)'
                  : 'var(--card-bg, white)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: '0.75rem',
              transition: 'all 0.2s',
            }}
          >
            {sentenceIndices.length === 0 && phase === 'building' && (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                Tap words below to build the sentence…
              </span>
            )}
            {sentenceIndices.map((idx, pos) => (
              <button
                key={`s-${pos}`}
                onClick={() => handleWordRemove(idx)}
                disabled={phase !== 'building'}
                aria-label={`Remove word: ${data.words[idx]}`}
                style={{
                  ...chipBase,
                  background: 'var(--primary, #3b82f6)',
                  color: '#fff',
                  border: '1px solid var(--primary, #3b82f6)',
                  opacity: phase !== 'building' ? 0.85 : 1,
                  cursor: phase !== 'building' ? 'default' : 'pointer',
                }}
              >
                {data.words[idx]}
              </button>
            ))}
          </div>

          {/* Word bank */}
          <div
            aria-label="Word bank"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: '0.75rem',
              minHeight: 40,
            }}
          >
            {bankIndices.map(idx => (
              <button
                key={`b-${idx}`}
                onClick={() => handleWordTap(idx)}
                disabled={phase !== 'building'}
                aria-label={`Add word: ${data.words[idx]}`}
                style={{
                  ...chipBase,
                  opacity: phase !== 'building' ? 0.5 : 1,
                  cursor: phase !== 'building' ? 'default' : 'pointer',
                }}
              >
                {data.words[idx]}
              </button>
            ))}
          </div>

          {/* Feedback area */}
          {phase === 'correct' && (
            <div style={{
              padding: '0.75rem',
              borderRadius: 8,
              background: 'var(--success-bg, #ecfdf5)',
              border: '1px solid var(--success-border, #86efac)',
              marginBottom: '0.75rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <CheckCircle2 size={20} color="var(--success-color, #16a34a)" />
                <strong style={{ color: 'var(--success-color, #16a34a)' }}>Correct!</strong>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                📖 Grammar point: <strong>{data.grammar_point}</strong>
              </p>
            </div>
          )}

          {phase === 'incorrect' && (
            <div style={{
              padding: '0.75rem',
              borderRadius: 8,
              background: 'var(--error-bg, #fef2f2)',
              border: '1px solid var(--error-border, #fca5a5)',
              marginBottom: '0.75rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <XCircle size={20} color="var(--error-color, #dc2626)" />
                <strong style={{ color: 'var(--error-color, #dc2626)' }}>Not quite!</strong>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0' }}>
                ✅ Correct sentence: <em>{data.sentence}</em>
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                📖 Grammar point: <strong>{data.grammar_point}</strong>
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {phase === 'building' && (
              <button
                onClick={handleCheck}
                disabled={sentenceIndices.length === 0}
                data-testid="scramble-check-btn"
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 8,
                  border: 'none',
                  background: sentenceIndices.length === 0 ? 'var(--border, #d1d5db)' : '#8b5cf6',
                  color: '#fff',
                  cursor: sentenceIndices.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                }}
              >
                ✓ Check
              </button>
            )}
            {phase === 'incorrect' && (
              <button
                onClick={handleRetry}
                data-testid="scramble-retry-btn"
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 8,
                  border: '1px solid var(--border, #d1d5db)',
                  background: 'var(--bg-primary, #fff)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.9rem',
                }}
              >
                🔄 Retry
              </button>
            )}
            {(phase === 'correct' || phase === 'incorrect') && (
              <button
                onClick={handleNext}
                data-testid="scramble-next-btn"
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 8,
                  border: '1px solid var(--border, #d1d5db)',
                  background: 'var(--bg-primary, #fff)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.9rem',
                }}
              >
                <RefreshCw size={14} /> Next
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

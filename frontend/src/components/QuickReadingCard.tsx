import { useState, useCallback, useEffect, useRef } from 'react';
import { BookOpen, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { getReadingComp, type ReadingCompResponse } from '../api';

type Phase = 'idle' | 'answering' | 'done';

export default function QuickReadingCard() {
  const [data, setData] = useState<ReadingCompResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const initialized = useRef(false);

  const fetchPassage = useCallback(async () => {
    setLoading(true);
    setSelectedIndex(null);
    setPhase('idle');
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getReadingComp(difficulty);
      setData(res);
      setPhase('answering');
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Auto-load on first render
  if (!initialized.current) {
    initialized.current = true;
    fetchPassage();
  }

  // React to difficulty changes from the hub
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        fetchPassage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchPassage]);

  const handleSelect = useCallback((index: number) => {
    if (phase !== 'answering' || selectedIndex !== null) return;
    setSelectedIndex(index);
    setPhase('done');
  }, [phase, selectedIndex]);

  const isCorrect = selectedIndex !== null && data ? selectedIndex === data.correct_index : false;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <BookOpen size={20} color="#8b5cf6" />
        <strong style={{ fontSize: 15, color: 'var(--text)' }}>Reading Comprehension</strong>
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading passage…</p>}

      {!loading && data && phase === 'answering' && (
        <div>
          <div style={{
            background: 'var(--bg-secondary, #f9fafb)',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 12,
            lineHeight: 1.6,
            fontSize: 14,
            color: 'var(--text)',
          }}>
            {data.passage}
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>
            {data.question}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                style={{
                  padding: '10px 14px', border: '2px solid var(--border)', borderRadius: 10,
                  background: 'var(--card-bg, white)', cursor: 'pointer',
                  fontSize: 14, color: 'var(--text)', textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                {String.fromCharCode(65 + idx)}. {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && data && phase === 'done' && selectedIndex !== null && (
        <div>
          <div style={{
            background: 'var(--bg-secondary, #f9fafb)',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 12,
            lineHeight: 1.6,
            fontSize: 14,
            color: 'var(--text)',
          }}>
            {data.passage}
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>
            {data.question}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {data.options.map((option, idx) => {
              const isSelected = idx === selectedIndex;
              const isCorrectOption = idx === data.correct_index;
              let borderColor = 'var(--border)';
              let bg = 'var(--card-bg, white)';
              if (isCorrectOption) {
                borderColor = '#22c55e';
                bg = 'rgba(34,197,94,0.08)';
              } else if (isSelected && !isCorrect) {
                borderColor = '#ef4444';
                bg = 'rgba(239,68,68,0.08)';
              }
              return (
                <div
                  key={idx}
                  style={{
                    padding: '10px 14px', border: `2px solid ${borderColor}`, borderRadius: 10,
                    background: bg, fontSize: 14, color: 'var(--text)', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  {isCorrectOption && <CheckCircle size={16} color="#22c55e" />}
                  {isSelected && !isCorrect && <XCircle size={16} color="#ef4444" />}
                  <span>{String.fromCharCode(65 + idx)}. {option}</span>
                </div>
              );
            })}
          </div>

          <div style={{
            padding: '10px 16px', borderRadius: 10, marginBottom: 12,
            background: isCorrect ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {isCorrect
                ? <><CheckCircle size={18} color="#22c55e" /><span style={{ color: '#22c55e', fontWeight: 600 }}>Correct!</span></>
                : <><XCircle size={18} color="#ef4444" /><span style={{ color: '#ef4444', fontWeight: 600 }}>Incorrect</span></>
              }
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              {data.explanation}
            </p>
          </div>

          <button onClick={fetchPassage} style={{
            padding: '8px 16px', border: 'none', borderRadius: 8,
            background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <RefreshCw size={14} /> Next Passage
          </button>
        </div>
      )}
    </div>
  );
}

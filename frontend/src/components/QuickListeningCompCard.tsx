import { useState, useCallback, useRef } from 'react';
import { Headphones, Volume2, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api, type QuickListeningCompResponse } from '../api';

type Phase = 'idle' | 'listening' | 'answering' | 'result';

export default function QuickListeningCompCard() {
  const tts = useSpeechSynthesis();

  const [data, setData] = useState<QuickListeningCompResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const initialized = useRef(false);

  const fetchQuestion = useCallback(async () => {
    setLoading(true);
    setSelectedIndex(null);
    setPhase('idle');
    try {
      const res = await api.getQuickListeningComp();
      setData(res);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Auto-load on first render
  if (!initialized.current) {
    initialized.current = true;
    fetchQuestion();
  }

  const handleListen = useCallback(() => {
    if (!data) return;
    tts.speak(data.passage);
    setPhase('listening');
    // Move to answering after TTS finishes (or a short delay)
    const estimatedDuration = Math.max(3000, data.passage.split(' ').length * 400);
    setTimeout(() => setPhase('answering'), estimatedDuration);
  }, [data, tts]);

  const handleSelect = useCallback((index: number) => {
    if (phase !== 'answering' || selectedIndex !== null) return;
    setSelectedIndex(index);
    setPhase('result');
  }, [phase, selectedIndex]);

  const isCorrect = selectedIndex !== null && data ? selectedIndex === data.correct_index : false;

  if (!tts.isSupported) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Headphones size={20} color="#0ea5e9" />
        <strong style={{ fontSize: 15, color: 'var(--text)' }}>Listening Comprehension</strong>
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading question...</p>}

      {!loading && data && phase === 'idle' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
            Listen to a short passage, then answer a question
          </p>
          <button onClick={handleListen} style={{
            padding: '10px 20px', border: 'none', borderRadius: 10,
            background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
            fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <Volume2 size={18} /> Play Passage
          </button>
        </div>
      )}

      {!loading && data && phase === 'listening' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: 10,
            background: 'rgba(14,165,233,0.1)', color: '#0ea5e9',
            fontSize: 14, fontWeight: 600,
          }}>
            <Volume2 size={18} /> Listening...
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
            Pay attention to the details
          </p>
        </div>
      )}

      {!loading && data && phase === 'answering' && (
        <div>
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
          <button onClick={handleListen} style={{
            marginTop: 10, padding: '6px 12px', border: 'none', borderRadius: 6,
            background: 'transparent', cursor: 'pointer', fontSize: 13,
            color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Volume2 size={14} /> Replay
          </button>
        </div>
      )}

      {!loading && data && phase === 'result' && selectedIndex !== null && (
        <div>
          <div style={{
            padding: '10px 16px', borderRadius: 10, marginBottom: 10,
            background: isCorrect ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {isCorrect
                ? <><CheckCircle size={18} color="#22c55e" /><span style={{ color: '#22c55e', fontWeight: 600 }}>Correct!</span></>
                : <><XCircle size={18} color="#ef4444" /><span style={{ color: '#ef4444', fontWeight: 600 }}>Incorrect</span></>
              }
            </div>
            {!isCorrect && (
              <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text)' }}>
                Your answer: <strong>{String.fromCharCode(65 + selectedIndex)}. {data.options[selectedIndex]}</strong>
              </p>
            )}
            <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text)' }}>
              Correct answer: <strong>{String.fromCharCode(65 + data.correct_index)}. {data.options[data.correct_index]}</strong>
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              {data.explanation}
            </p>
          </div>

          <details style={{ marginBottom: 10 }}>
            <summary style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Show passage
            </summary>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '6px 0 0', lineHeight: 1.5 }}>
              {data.passage}
            </p>
          </details>

          <button onClick={fetchQuestion} style={{
            padding: '8px 16px', border: 'none', borderRadius: 8,
            background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <RefreshCw size={14} /> Next Question
          </button>
        </div>
      )}
    </div>
  );
}

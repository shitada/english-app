import { useState, useCallback, useEffect, useRef } from 'react';
import { Headphones, RefreshCw, Send } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api, checkDictation, type DictationResult } from '../api';

export default function QuickDictationCard() {
  const tts = useSpeechSynthesis();

  const [sentence, setSentence] = useState<{ text: string; topic: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'done'>('idle');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<DictationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSentence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPronunciationSentences('beginner');
      const sentences = res.sentences;
      if (sentences.length > 0) {
        const pick = sentences[Math.floor(Math.random() * sentences.length)];
        setSentence(pick);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchSentence();
    }
  }, [initialized, fetchSentence]);

  const handlePlay = useCallback(() => {
    if (!sentence) return;
    tts.speak(sentence.text);
    setPhase('typing');
    setTimeout(() => inputRef.current?.focus(), 300);
  }, [sentence, tts]);

  const handleCheck = useCallback(async () => {
    if (!sentence || !input.trim()) return;
    setChecking(true);
    try {
      const res = await checkDictation(sentence.text, input.trim());
      setResult(res);
      setPhase('done');
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [sentence, input]);

  const handleNext = useCallback(() => {
    setPhase('idle');
    setInput('');
    setResult(null);
    fetchSentence();
  }, [fetchSentence]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !checking) {
      handleCheck();
    }
  }, [handleCheck, checking]);

  if (!tts.isSupported) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Headphones size={20} color="#6366f1" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Dictation</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading sentence…</p>
      ) : !sentence ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No sentences available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
            Listen to a sentence, then type what you hear.
          </p>
          <button onClick={handlePlay} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Headphones size={16} /> Play Sentence
          </button>
        </div>
      ) : phase === 'typing' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Type what you heard:
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type the sentence…"
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border, #e2e8f0)',
                fontSize: '0.95rem',
                background: 'var(--bg, #f8fafc)',
                color: 'var(--text, #1e293b)',
              }}
              disabled={checking}
              autoComplete="off"
              aria-label="Dictation input"
            />
            <button
              onClick={handleCheck}
              disabled={checking || !input.trim()}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}
            >
              <Send size={14} /> Check
            </button>
          </div>
          <button
            onClick={() => { if (sentence) tts.speak(sentence.text); }}
            style={{
              marginTop: '0.5rem', background: 'none', border: 'none',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
            }}
          >
            <Headphones size={14} /> Replay
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '0.5rem' }}>
            <span style={{
              fontSize: '1.5rem', fontWeight: 700,
              color: (result?.score ?? 0) >= 80 ? '#22c55e' : (result?.score ?? 0) >= 50 ? '#f59e0b' : '#ef4444',
            }}>
              {result?.score ?? 0}%
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              {result?.correct_words}/{result?.total_words} words correct
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.75rem' }}>
            {result?.word_results.map((w, i) => (
              <span key={i} style={{
                padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.9rem',
                background: w.is_correct ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: w.is_correct ? '#16a34a' : '#dc2626',
                textDecoration: w.is_correct ? 'none' : 'line-through',
              }}>
                {w.expected}
              </span>
            ))}
          </div>
          <button onClick={handleNext} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={14} /> Next Sentence
          </button>
        </div>
      )}
    </div>
  );
}

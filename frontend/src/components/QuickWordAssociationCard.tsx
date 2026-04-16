import { useState, useCallback, useEffect, useRef } from 'react';
import { Zap, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { getWordAssociation, evaluateWordAssociation, type WordAssociationPromptResponse, type WordAssociationEvaluateResponse } from '../api';

const MAX_SECONDS = 30;

export default function QuickWordAssociationCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [prompt, setPrompt] = useState<WordAssociationPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<WordAssociationEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getWordAssociation(difficulty);
      setPrompt(res);
    } catch {
      // ignore
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

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        fetchPrompt();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchPrompt]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleFinish = useCallback(async () => {
    stopTimer();
    speech.stop();
    setPhase('evaluating');

    const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    const transcript = speech.transcript || speech.interimTranscript || '';

    if (!prompt || !transcript.trim()) {
      setPhase('idle');
      return;
    }

    try {
      const res = await evaluateWordAssociation(prompt.seed_word, transcript, elapsed);
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [prompt, speech, stopTimer]);

  const handleFinishRef = useRef(handleFinish);
  handleFinishRef.current = handleFinish;

  const handleStart = useCallback(async () => {
    if (!prompt) return;
    speech.reset();
    setSecondsLeft(MAX_SECONDS);
    startTimeRef.current = Date.now();
    setPhase('speaking');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          handleFinishRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [prompt, speech]);

  const handleNewPrompt = useCallback(() => {
    setPhase('idle');
    setResult(null);
    speech.reset();
    fetchPrompt();
  }, [fetchPrompt, speech]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (!speech.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  // Count words from live transcript for running display
  const liveWordCount = (speech.transcript || '').trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Zap size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Word Association</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading category…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No category available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 700, textAlign: 'center' }}>
            🏷️ {prompt.seed_word}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', textAlign: 'center' }}>
            {prompt.category}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: '0 0 0.5rem', textAlign: 'center', fontStyle: 'italic' }}>
            💡 {prompt.hint}
          </p>
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '0.75rem', marginBottom: '0.75rem',
          }}>
            <span style={{
              background: '#8b5cf610', color: '#8b5cf6', borderRadius: '1rem',
              padding: '0.2rem 0.6rem', fontSize: '0.8rem', fontWeight: 600,
            }}>
              🎯 Target: {prompt.target_count} words
            </span>
            <span style={{
              background: '#3b82f610', color: '#3b82f6', borderRadius: '1rem',
              padding: '0.2rem 0.6rem', fontSize: '0.8rem', fontWeight: 600,
            }}>
              ⏱️ {MAX_SECONDS}s
            </span>
          </div>
          <button onClick={handleStart} className="btn btn-primary" style={{ width: '100%' }}>
            <Mic size={16} /> Start Speaking ({MAX_SECONDS}s)
          </button>
        </div>
      ) : phase === 'speaking' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem', textAlign: 'center' }}>
            🏷️ {prompt.seed_word}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', justifyContent: 'center' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: secondsLeft <= 5 ? '#ef4444' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {secondsLeft}s
            </span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'center', marginBottom: '0.5rem',
          }}>
            <span style={{
              background: '#8b5cf610', color: '#8b5cf6', borderRadius: '1rem',
              padding: '0.2rem 0.6rem', fontSize: '0.85rem', fontWeight: 700,
            }}>
              Words: {liveWordCount} / {prompt.target_count}
            </span>
          </div>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <button onClick={handleFinish} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done
          </button>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your words…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Valid', value: `${result?.valid_count ?? 0}`, isCount: true },
              { label: 'Sophist.', score: result?.sophistication_score ?? 0 },
              { label: 'Relevance', score: result?.relevance_score ?? 0 },
              { label: 'Overall', score: result?.overall_score ?? 0 },
            ].map((item) => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                {'isCount' in item ? (
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#8b5cf6' }}>{item.value}</div>
                ) : (
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(item.score!) }}>{item.score}/10</div>
                )}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.missed_words && result.missed_words.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: '3px solid #8b5cf6',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                💡 Words you could also try
              </p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {result.missed_words.map((w) => (
                  <span key={w} style={{
                    background: '#8b5cf610', color: '#8b5cf6', borderRadius: '1rem',
                    padding: '0.15rem 0.5rem', fontSize: '0.8rem', fontWeight: 600,
                  }}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPrompt} className="btn btn-primary">
              <RefreshCw size={14} /> New Category
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

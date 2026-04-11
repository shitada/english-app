import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { api } from '../api';

interface Prompt {
  prompt: string;
  context_hint: string;
  difficulty: string;
}

interface Result {
  overall_score: number;
  fluency_score: number;
  grammar_score: number;
  feedback: string;
  wpm: number;
}

const MAX_SECONDS = 15;

export default function QuickSpeakCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getQuickSpeakPrompt('intermediate');
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
      const res = await api.evaluateQuickSpeak(prompt.prompt, transcript, elapsed);
      setResult({
        overall_score: res.overall_score,
        fluency_score: res.fluency_score,
        grammar_score: res.grammar_score,
        feedback: res.feedback,
        wpm: res.wpm,
      });
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [prompt, speech, stopTimer]);

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
          handleFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [prompt, speech, handleFinish]);

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

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Mic size={20} color="#6366f1" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Speak</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading prompt…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No prompts available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', margin: '0 0 0.25rem', fontWeight: 600 }}>
            {prompt.prompt}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.75rem', fontStyle: 'italic' }}>
            {prompt.context_hint}
          </p>
          <button onClick={handleStart} className="btn btn-primary">
            <Mic size={16} /> Speak ({MAX_SECONDS}s)
          </button>
        </div>
      ) : phase === 'speaking' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {prompt.prompt}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {secondsLeft}s
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your response…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result?.overall_score ?? 0 },
              { label: 'Fluency', score: result?.fluency_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>{result?.wpm ?? 0}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>WPM</div>
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            {result?.feedback}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPrompt} className="btn btn-primary">
              <RefreshCw size={14} /> New Prompt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

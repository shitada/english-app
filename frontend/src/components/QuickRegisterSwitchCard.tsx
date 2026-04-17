import { useState, useCallback, useEffect, useRef } from 'react';
import { Languages, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { getRegisterSwitchPrompt, evaluateRegisterSwitch, type RegisterSwitchPromptResponse, type RegisterSwitchEvaluateResponse } from '../api';

const MAX_SECONDS = 20;

const REGISTER_BADGES: Record<string, { emoji: string; label: string; color: string }> = {
  formal: { emoji: '🎩', label: 'Formal', color: '#6366f1' },
  neutral: { emoji: '💬', label: 'Neutral', color: '#3b82f6' },
  casual: { emoji: '😎', label: 'Casual', color: '#f97316' },
};

export default function QuickRegisterSwitchCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [prompt, setPrompt] = useState<RegisterSwitchPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<RegisterSwitchEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getRegisterSwitchPrompt(difficulty);
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
      const res = await evaluateRegisterSwitch({
        situation: prompt.situation,
        target_register: prompt.target_register,
        transcript,
        duration_seconds: elapsed,
      });
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
    setPhase('recording');

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

  const badge = REGISTER_BADGES[prompt?.target_register ?? 'neutral'] ?? REGISTER_BADGES.neutral;
  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Languages size={20} color="#6366f1" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Register Switch</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading situation…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No situation available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '1rem', margin: '0 0 0.5rem', fontWeight: 700 }}>
            {prompt.situation}
          </p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.25rem 0.6rem', borderRadius: 12,
            background: badge.color + '18', border: `1px solid ${badge.color}40`,
            marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.9rem' }}>{badge.emoji}</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: badge.color }}>{badge.label}</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0.25rem 0 0.75rem', fontStyle: 'italic' }}>
            💡 {prompt.context_hint}
          </p>
          <button onClick={handleStart} className="btn btn-primary" data-testid="register-switch-start-btn">
            <Mic size={16} /> Respond in {badge.label} Register ({MAX_SECONDS}s)
          </button>
        </div>
      ) : phase === 'recording' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.25rem' }}>
            {prompt.situation}
          </p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: badge.color + '18', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.85rem' }}>{badge.emoji}</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: badge.color }}>{badge.label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: badge.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <button onClick={handleFinish} className="btn btn-secondary" data-testid="register-switch-stop-btn" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done
          </button>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your register…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Register', score: result?.register_accuracy_score ?? 0 },
              { label: 'Vocabulary', score: result?.vocabulary_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Politeness', score: result?.politeness_score ?? 0 },
              { label: 'Overall', score: result?.overall_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.model_response && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: `3px solid ${badge.color}`,
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Response ({badge.emoji} {badge.label})
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_response}
              </p>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPrompt} className="btn btn-primary" data-testid="register-switch-next-btn">
              <RefreshCw size={14} /> New Situation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

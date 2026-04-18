import { useState, useCallback, useEffect, useRef } from 'react';
import { Heart, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { getEmotionResponse, evaluateEmotionResponse, type EmotionResponsePromptResponse, type EmotionResponseEvaluateResponse } from '../api';

const MAX_SECONDS = 15;

const EMOTION_EMOJI: Record<string, string> = {
  sympathy: '💙',
  excitement: '🎉',
  congratulation: '🎊',
  apology: '🙏',
  surprise: '😲',
  encouragement: '💪',
};

export default function QuickEmotionResponseCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [prompt, setPrompt] = useState<EmotionResponsePromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<EmotionResponseEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getEmotionResponse(difficulty);
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

    const transcript = speech.transcript || speech.interimTranscript || '';

    if (!prompt || !transcript.trim()) {
      setPhase('idle');
      return;
    }

    try {
      const res = await evaluateEmotionResponse(prompt.situation, prompt.expected_emotion, transcript);
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

  const handleNewScenario = useCallback(() => {
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
  const emotionEmoji = prompt ? (EMOTION_EMOJI[prompt.expected_emotion] || '💬') : '💬';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Heart size={20} color="#e11d48" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Emotion Response</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading scenario…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No scenario available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', margin: '0 0 0.5rem', fontWeight: 600 }}>
            {emotionEmoji} {prompt.situation}
          </p>
          <div style={{
            display: 'inline-block', fontSize: '0.75rem', padding: '0.2rem 0.5rem',
            background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '0.75rem',
            color: 'var(--text-secondary)', marginBottom: '0.5rem',
          }}>
            Expected: {prompt.expected_emotion}
          </div>
          {prompt.hint_phrases.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>
                💡 Hint phrases:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {prompt.hint_phrases.map((p, i) => (
                  <span key={i} style={{
                    fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                    background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '0.75rem',
                    color: 'var(--text-secondary)', fontStyle: 'italic',
                  }}>
                    "{p}"
                  </span>
                ))}
              </div>
            </div>
          )}
          <button onClick={handleStart} className="btn btn-primary">
            <Mic size={16} /> Respond ({MAX_SECONDS}s)
          </button>
        </div>
      ) : phase === 'speaking' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {emotionEmoji} {prompt.situation}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#e11d48', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
              { label: 'Emotion', score: result?.emotional_appropriateness_score ?? 0 },
              { label: 'Variety', score: result?.expression_variety_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
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
              padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
              borderLeft: '3px solid #e11d48',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Response
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_response}
              </p>
            </div>
          )}
          {result?.useful_phrases && result.useful_phrases.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                📝 Useful Phrases
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {result.useful_phrases.map((p, i) => (
                  <span key={i} style={{
                    fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                    background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '0.75rem',
                    color: 'var(--text-secondary)',
                  }}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewScenario} className="btn btn-primary">
              <RefreshCw size={14} /> New Scenario
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

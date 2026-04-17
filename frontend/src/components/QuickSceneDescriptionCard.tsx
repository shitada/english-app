import { useState, useCallback, useEffect, useRef } from 'react';
import { ImageIcon, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { getSceneDescription, evaluateSceneDescription, type SceneDescriptionPromptResponse, type SceneDescriptionEvaluateResponse } from '../api';

const MAX_SECONDS = 30;

export default function QuickSceneDescriptionCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [prompt, setPrompt] = useState<SceneDescriptionPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<SceneDescriptionEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getSceneDescription(difficulty);
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
      const res = await evaluateSceneDescription(prompt.scene, transcript, elapsed);
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

  const handleNewScene = useCallback(() => {
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
        <ImageIcon size={20} color="#0ea5e9" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Scene Description</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading scene…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No scene available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', margin: '0 0 0.5rem', fontWeight: 600 }}>
            🎨 {prompt.scene}
          </p>
          {prompt.key_vocabulary.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
              {prompt.key_vocabulary.map((v, i) => (
                <span key={i} style={{
                  fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                  background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '0.75rem',
                  color: 'var(--text-secondary)',
                }}>
                  {v}
                </span>
              ))}
            </div>
          )}
          {prompt.suggested_details.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                💡 Try to describe:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {prompt.suggested_details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={handleStart} className="btn btn-primary">
            <Mic size={16} /> Describe Scene ({MAX_SECONDS}s)
          </button>
        </div>
      ) : phase === 'speaking' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            🎨 {prompt.scene}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your description…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Vocabulary', score: result?.descriptive_vocabulary_score ?? 0 },
              { label: 'Spatial', score: result?.spatial_language_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Fluency', score: result?.fluency_score ?? 0 },
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
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.model_description && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: '3px solid #0ea5e9',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Description
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_description}
              </p>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewScene} className="btn btn-primary">
              <RefreshCw size={14} /> New Scene
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

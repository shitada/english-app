import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Headphones, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getSpotErrorPrompt, evaluateSpotError } from '../api';
import type { SpotErrorPrompt, SpotErrorEvaluation } from '../api';

const MAX_SECONDS = 20;

export default function QuickSpotErrorCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [prompt, setPrompt] = useState<SpotErrorPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'recording' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<SpotErrorEvaluation | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getSpotErrorPrompt(difficulty);
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
        stopTimer();
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
      const res = await evaluateSpotError({
        error_sentence: prompt.error_sentence,
        correct_sentence: prompt.correct_sentence,
        user_correction: transcript,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [prompt, speech, stopTimer]);

  const startRecording = useCallback(async () => {
    if (!prompt) return;
    speech.reset();
    setSecondsLeft(MAX_SECONDS);
    setPhase('recording');

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

  const handleListen = useCallback(() => {
    if (!prompt) return;
    setPhase('listening');
    tts.speak(prompt.error_sentence);
  }, [prompt, tts]);

  // When TTS finishes speaking, transition from listening to recording
  useEffect(() => {
    if (phase === 'listening' && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        if (phase === 'listening') {
          startRecording();
        }
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [phase, tts.isSpeaking, startRecording]);

  const handleNewPrompt = useCallback(() => {
    setPhase('idle');
    setResult(null);
    speech.reset();
    fetchPrompt();
  }, [fetchPrompt, speech]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <AlertTriangle size={20} color="#f59e0b" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Spot the Error</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No exercises available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Listen to a sentence with a grammar error, then speak the corrected version.
          </p>
          <div style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: 6,
            marginBottom: '0.5rem',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
          }}>
            💡 Hint: {prompt.hint}
            <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>({prompt.error_type})</span>
          </div>
          <button
            onClick={handleListen}
            data-testid="spot-error-listen-btn"
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <Headphones size={16} /> Listen & Correct
          </button>
        </div>
      ) : phase === 'listening' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Headphones size={18} color="white" />
            </div>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
              Listening for the error…
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Can you spot the grammar mistake?
          </p>
        </div>
      ) : phase === 'recording' ? (
        <div>
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
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Speak the corrected sentence!
          </p>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <button
            onClick={handleFinish}
            data-testid="spot-error-stop-btn"
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <Square size={14} /> Done
          </button>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your correction…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result?.overall_score ?? 0 },
              { label: 'Accuracy', score: result?.correction_accuracy_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Natural', score: result?.naturalness_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          <div style={{ padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Error sentence:</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--error-color, #dc2626)', textDecoration: 'line-through' }}>"{prompt.error_sentence}"</div>
          </div>
          {result?.model_correction && (
            <div style={{ padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Correct version:</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--success-color, #16a34a)' }}>"{result.model_correction}"</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => { setResult(null); setPhase('idle'); }}
              className="btn btn-secondary"
            >
              Try Again
            </button>
            <button
              onClick={handleNewPrompt}
              data-testid="spot-error-next-btn"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <RefreshCw size={14} /> New Sentence
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

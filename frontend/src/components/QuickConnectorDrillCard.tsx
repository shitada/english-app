import { useState, useCallback, useEffect, useRef } from 'react';
import { RefreshCw, Mic, Square, Link2 } from 'lucide-react';
import { getConnectorDrillExercises, evaluateConnectorDrill } from '../api';
import type { ConnectorDrillExercise, ConnectorDrillEvaluation } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

export default function QuickConnectorDrillCard() {
  const [exercise, setExercise] = useState<ConnectorDrillExercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<ConnectorDrillEvaluation | null>(null);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { transcript, isListening: listening, isSupported: supported, start: startListening, stop: stopListening, reset: resetSpeech } = useSpeechRecognition();

  const fetchExercise = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getConnectorDrillExercises(difficulty, 1);
      if (res.exercises.length > 0) {
        setExercise(res.exercises[0]);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchExercise();
    }
  }, [initialized, fetchExercise]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        setError(false);
        setCountdown(15);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        fetchExercise();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchExercise]);

  const handleStartRecording = useCallback(async () => {
    if (!supported) return;
    setPhase('recording');
    setCountdown(15);
    resetSpeech();
    await startListening();
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          stopListening();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [supported, startListening, stopListening, resetSpeech]);

  const handleStopRecording = useCallback(() => {
    stopListening();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [stopListening]);

  // Auto-stop when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && phase === 'recording') {
      handleStopRecording();
    }
  }, [countdown, phase, handleStopRecording]);

  // Evaluate when recording stops and we have a transcript
  useEffect(() => {
    if (phase === 'recording' && !listening && transcript && exercise) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setPhase('evaluating');
      evaluateConnectorDrill({
        sentence_a: exercise.sentence_a,
        sentence_b: exercise.sentence_b,
        connector: exercise.connector,
        user_response: transcript,
      }).then(res => {
        setResult(res);
        setPhase('done');
      }).catch(() => {
        setError(true);
        setPhase('idle');
      });
    }
  }, [listening, transcript, phase, exercise]);

  const handleNext = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setError(false);
    setCountdown(15);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    fetchExercise();
  }, [fetchExercise]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const scoreColor = (score: number) => {
    if (score >= 8) return 'var(--success-color, #16a34a)';
    if (score >= 5) return 'var(--accent-color, #4f46e5)';
    return 'var(--error-color, #dc2626)';
  };

  if (error && !exercise) return null;
  if (!supported) return null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Link2 size={20} color="#0ea5e9" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Connector Drill</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !exercise ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Could not load connector exercise.</p>
      ) : phase === 'idle' ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
            Combine these sentences using <strong style={{ color: 'var(--primary, #3b82f6)' }}>{exercise.connector}</strong>
            <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', opacity: 0.7 }}>({exercise.connector_type})</span>
          </p>
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: '8px',
            margin: '0 0 0.5rem',
            lineHeight: 1.5,
          }}>
            <p style={{ fontSize: '0.95rem', margin: '0 0 0.25rem' }}>A: &ldquo;{exercise.sentence_a}&rdquo;</p>
            <p style={{ fontSize: '0.95rem', margin: 0 }}>B: &ldquo;{exercise.sentence_b}&rdquo;</p>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem', fontStyle: 'italic' }}>
            💡 {exercise.hint}
          </p>
          <button
            onClick={handleStartRecording}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: 'none',
              background: '#0ea5e9',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.9rem',
            }}
          >
            <Mic size={16} /> Speak Answer
          </button>
        </>
      ) : phase === 'recording' ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
            Combine using <strong style={{ color: 'var(--primary, #3b82f6)' }}>{exercise.connector}</strong>
          </p>
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f5f5f5)',
            borderRadius: '8px',
            margin: '0 0 0.75rem',
            lineHeight: 1.5,
          }}>
            <p style={{ fontSize: '0.95rem', margin: '0 0 0.25rem' }}>A: &ldquo;{exercise.sentence_a}&rdquo;</p>
            <p style={{ fontSize: '0.95rem', margin: 0 }}>B: &ldquo;{exercise.sentence_b}&rdquo;</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <button
              onClick={handleStopRecording}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: '#ef4444',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.9rem',
              }}
            >
              <Square size={16} /> Stop
            </button>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              ⏱️ {countdown}s
            </span>
          </div>
          {transcript && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              {transcript}
            </p>
          )}
        </>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating…</p>
      ) : result ? (
        <>
          <div style={{
            padding: '0.75rem',
            borderRadius: '8px',
            background: result.overall_score >= 6 ? 'var(--success-bg, #ecfdf5)' : 'var(--error-bg, #fef2f2)',
            border: `1px solid ${result.overall_score >= 6 ? 'var(--success-border, #86efac)' : 'var(--error-border, #fca5a5)'}`,
            marginBottom: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: scoreColor(result.overall_score) }}>
                {result.overall_score}/10
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <span>🔗 Connector: <strong style={{ color: scoreColor(result.connector_usage_score) }}>{result.connector_usage_score}/10</strong></span>
              <span>📝 Grammar: <strong style={{ color: scoreColor(result.grammar_score) }}>{result.grammar_score}/10</strong></span>
              <span>🎯 Naturalness: <strong style={{ color: scoreColor(result.naturalness_score) }}>{result.naturalness_score}/10</strong></span>
            </div>
            {result.model_answer && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0' }}>
                ✅ Model: <em>{result.model_answer}</em>
              </p>
            )}
            {result.feedback && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                💡 {result.feedback}
              </p>
            )}
          </div>
          <button
            onClick={handleNext}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #ddd)',
              background: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.9rem',
            }}
          >
            <RefreshCw size={14} /> Try Another
          </button>
        </>
      ) : null}
    </div>
  );
}

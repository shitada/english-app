import { useState, useCallback, useEffect, useRef } from 'react';
import { Headphones, Mic, RefreshCw, Square, Eye, EyeOff } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api } from '../api';

interface Prompt {
  question: string;
  difficulty: string;
  topic_hint: string;
}

interface Result {
  comprehension_score: number;
  relevance_score: number;
  grammar_score: number;
  fluency_score: number;
  overall_score: number;
  feedback: string;
  model_answer: string;
}

const MAX_SECONDS = 20;

export default function QuickListenRespondCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'recording' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [showQuestion, setShowQuestion] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await api.getListenRespondPrompt(difficulty);
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
        setShowQuestion(false);
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
      const res = await api.evaluateListenRespond(prompt.question, transcript, elapsed);
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
    startTimeRef.current = Date.now();
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
    setShowQuestion(false);
    tts.speak(prompt.question);
  }, [prompt, tts]);

  // When TTS finishes speaking, transition from listening to recording
  useEffect(() => {
    if (phase === 'listening' && !tts.isSpeaking) {
      // Small delay to ensure TTS has fully stopped
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
    setShowQuestion(false);
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
        <Headphones size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Listen & Respond</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading question…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No questions available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Listen to a question, then speak your answer. Topic: <strong>{prompt.topic_hint}</strong>
          </p>
          <button onClick={handleListen} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Headphones size={16} /> Listen & Respond
          </button>
        </div>
      ) : phase === 'listening' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Headphones size={18} color="white" />
            </div>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
              Listening to question…
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Pay attention — you'll need to respond!
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
            Now respond to what you heard!
          </p>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleFinish} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Square size={14} /> Done
            </button>
            <button
              onClick={() => setShowQuestion(!showQuestion)}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
            >
              {showQuestion ? <EyeOff size={14} /> : <Eye size={14} />}
              {showQuestion ? 'Hide' : 'Show'} Question
            </button>
          </div>
          {showQuestion && (
            <p style={{ color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500, marginTop: '0.5rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
              "{prompt.question}"
            </p>
          )}
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your response…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result?.overall_score ?? 0 },
              { label: 'Comprehension', score: result?.comprehension_score ?? 0 },
              { label: 'Relevance', score: result?.relevance_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Fluency', score: result?.fluency_score ?? 0 },
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
          {result?.model_answer && (
            <div style={{ padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Example answer:</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>"{result.model_answer}"</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setShowQuestion(false); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPrompt} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <RefreshCw size={14} /> New Question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

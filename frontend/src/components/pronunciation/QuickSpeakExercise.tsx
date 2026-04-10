import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, RotateCcw, RefreshCw } from 'lucide-react';
import { api } from '../../api';

interface Props {
  speechRecognition: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
  };
}

interface Prompt {
  prompt: string;
  context_hint: string;
  difficulty: string;
  suggested_phrases: string[];
}

interface EvalResult {
  fluency_score: number;
  relevance_score: number;
  grammar_score: number;
  vocabulary_score: number;
  overall_score: number;
  word_count: number;
  wpm: number;
  feedback: string;
  suggestions: string[];
}

type Phase = 'prompt' | 'speaking' | 'result';

const DURATION = 30;

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'var(--success, #22c55e)' : score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border, #e5e7eb)' }}>
        <div style={{ height: '100%', borderRadius: 3, background: color, width: `${pct}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export function QuickSpeakExercise({ speechRecognition }: Props) {
  const [phase, setPhase] = useState<Phase>('prompt');
  const [promptData, setPromptData] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getQuickSpeakPrompt();
      setPromptData(data);
    } catch {
      setError('Failed to load prompt. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!promptData && !loading) fetchPrompt();
  }, [promptData, loading, fetchPrompt]);

  const startSpeaking = useCallback(() => {
    setPhase('speaking');
    setTimeLeft(DURATION);
    startTimeRef.current = Date.now();
    speechRecognition.startListening();

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speechRecognition]);

  const finishSpeaking = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    speechRecognition.stopListening();

    const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
    const transcript = speechRecognition.transcript;

    if (!transcript.trim() || !promptData) {
      setError('No speech detected. Please try again.');
      setPhase('prompt');
      return;
    }

    setEvaluating(true);
    setPhase('result');
    try {
      const evalResult = await api.evaluateQuickSpeak(promptData.prompt, transcript, Math.max(1, duration));
      setResult(evalResult);
    } catch {
      setError('Evaluation failed. Please try again.');
    } finally {
      setEvaluating(false);
    }
  }, [speechRecognition, promptData]);

  // Auto-finish when timer reaches 0
  useEffect(() => {
    if (timeLeft === 0 && phase === 'speaking') {
      finishSpeaking();
    }
  }, [timeLeft, phase, finishSpeaking]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const handleNewPrompt = useCallback(() => {
    setPhase('prompt');
    setPromptData(null);
    setResult(null);
    setError('');
    setTimeLeft(DURATION);
  }, []);

  const handleRetry = useCallback(() => {
    setPhase('prompt');
    setResult(null);
    setError('');
    setTimeLeft(DURATION);
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ color: 'var(--text-secondary)' }}>Generating speaking prompt…</p>
      </div>
    );
  }

  if (error && phase === 'prompt') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ color: 'var(--danger, #ef4444)', marginBottom: 12 }}>{error}</p>
        <button className="btn btn-primary" onClick={fetchPrompt}>Try Again</button>
      </div>
    );
  }

  if (phase === 'prompt' && promptData) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>🗣️</span>
          <h3 style={{ margin: 0 }}>Quick Speak</h3>
          <span style={{
            marginLeft: 'auto', padding: '2px 8px', borderRadius: 12,
            fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
            background: 'var(--primary-bg, #eef2ff)', color: 'var(--primary, #6366f1)',
          }}>
            {promptData.difficulty}
          </span>
        </div>

        <div style={{
          padding: 16, borderRadius: 8, marginBottom: 16,
          background: 'var(--bg-secondary, #f5f5f5)',
          borderLeft: '3px solid var(--primary, #6366f1)',
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
            {promptData.prompt}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            💡 {promptData.context_hint}
          </p>
        </div>

        {promptData.suggested_phrases.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Useful phrases:
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {promptData.suggested_phrases.map((p, i) => (
                <span key={i} style={{
                  padding: '3px 8px', borderRadius: 12, fontSize: 12,
                  background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
                }}>
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={startSpeaking} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Mic size={18} /> Start Speaking (30s)
          </button>
          <button onClick={handleNewPrompt} style={{
            padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)',
            background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)',
          }}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'speaking') {
    const progress = ((DURATION - timeLeft) / DURATION) * 100;
    return (
      <div className="card" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{
            width: 100, height: 100, borderRadius: '50%', margin: '0 auto 12px',
            background: `conic-gradient(var(--primary, #6366f1) ${progress}%, var(--border, #e5e7eb) ${progress}%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 84, height: 84, borderRadius: '50%',
              background: 'var(--card-bg, #fff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 700, color: timeLeft <= 5 ? 'var(--danger, #ef4444)' : 'var(--text)',
            }}>
              {timeLeft}s
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--danger, #ef4444)' }}>
            <Mic size={20} style={{ animation: 'streak-pulse 1s infinite' }} />
            <span style={{ fontWeight: 600 }}>Recording…</span>
          </div>
        </div>

        <div style={{
          padding: 16, borderRadius: 8, marginBottom: 16,
          background: 'var(--bg-secondary, #f5f5f5)', minHeight: 60,
          fontSize: 14, lineHeight: 1.6, textAlign: 'left',
        }}>
          {speechRecognition.transcript || <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Start speaking…</span>}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          {speechRecognition.transcript.split(/\s+/).filter(Boolean).length} words
        </div>

        <button className="btn btn-primary" onClick={finishSpeaking} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <MicOff size={16} /> Done
        </button>
      </div>
    );
  }

  if (phase === 'result') {
    if (evaluating) {
      return (
        <div className="card" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: 32 }}>
          <p style={{ color: 'var(--text-secondary)' }}>Evaluating your speaking…</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="card" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: 32 }}>
          <p style={{ color: 'var(--danger, #ef4444)', marginBottom: 12 }}>{error}</p>
          <button className="btn btn-primary" onClick={handleRetry}>Try Again</button>
        </div>
      );
    }

    if (!result) return null;

    return (
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h3 style={{ textAlign: 'center', marginBottom: 16 }}>Speaking Results</h3>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: result.overall_score >= 7 ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)' }}>
              {result.overall_score.toFixed(1)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Overall</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700 }}>{result.word_count}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Words</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700 }}>{result.wpm}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>WPM</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <ScoreBar label="Fluency" score={result.fluency_score} />
          <ScoreBar label="Relevance" score={result.relevance_score} />
          <ScoreBar label="Grammar" score={result.grammar_score} />
          <ScoreBar label="Vocabulary" score={result.vocabulary_score} />
        </div>

        <div style={{
          padding: 12, borderRadius: 6, marginBottom: 16,
          background: 'var(--bg-secondary, #f5f5f5)',
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.5 }}>{result.feedback}</p>
          {result.suggestions.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
              {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleRetry} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Try Again
          </button>
          <button onClick={handleNewPrompt} style={{
            flex: 1, padding: '0.5rem 1rem', borderRadius: 6,
            border: '1px solid var(--border)', background: 'transparent',
            cursor: 'pointer', color: 'var(--text)', fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <RefreshCw size={14} /> New Prompt
          </button>
        </div>
      </div>
    );
  }

  return null;
}

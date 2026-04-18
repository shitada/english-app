import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeftRight, Mic, RefreshCw, Square, Volume2 } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getSynonymSwapPrompt, evaluateSynonymSwap, type SynonymSwapPromptResponse, type SynonymSwapEvaluateResponse } from '../api';

const MAX_SECONDS = 15;

type Phase = 'idle' | 'listening' | 'recording' | 'evaluating' | 'done';

export default function QuickSynonymSwapCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [prompt, setPrompt] = useState<SynonymSwapPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SynonymSwapEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<Phase>('idle');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getSynonymSwapPrompt(difficulty);
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
      const res = await evaluateSynonymSwap({
        original_sentence: prompt.sentence,
        target_word: prompt.target_word,
        user_transcript: transcript,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [prompt, speech, stopTimer]);

  const handleFinishRef = useRef(handleFinish);
  handleFinishRef.current = handleFinish;

  const startRecording = useCallback(() => {
    speech.reset();
    setSecondsLeft(MAX_SECONDS);
    setPhase('recording');
    speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          handleFinishRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech]);

  const handleListen = useCallback(() => {
    if (!prompt) return;
    setPhase('listening');
    tts.speak(prompt.sentence);
  }, [prompt, tts]);

  // When TTS finishes speaking, transition from listening to recording
  useEffect(() => {
    if (phase === 'listening' && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        if (phaseRef.current === 'listening') {
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

  /** Highlight the target word in the sentence */
  const renderSentence = (sentence: string, targetWord: string) => {
    const regex = new RegExp(`(\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)`, 'gi');
    const parts = sentence.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <span key={i} style={{
          background: '#f59e0b20',
          color: '#d97706',
          fontWeight: 700,
          padding: '0.1rem 0.3rem',
          borderRadius: 4,
          textDecoration: 'underline',
          textDecorationStyle: 'wavy',
          textUnderlineOffset: '3px',
        }}>
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <ArrowLeftRight size={20} color="#f59e0b" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Synonym Swap</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading sentence…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No sentence available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '1rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>
            {renderSentence(prompt.sentence, prompt.target_word)}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
            💡 {prompt.context_hint}
          </p>
          <div style={{
            display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem',
          }}>
            {prompt.example_synonyms.map((s) => (
              <span key={s} style={{
                background: '#f59e0b10', color: '#d97706', borderRadius: '1rem',
                padding: '0.15rem 0.5rem', fontSize: '0.8rem', fontWeight: 600,
              }}>
                {s}
              </span>
            ))}
          </div>
          <button onClick={handleListen} className="btn btn-primary" style={{ width: '100%' }}>
            <Volume2 size={16} /> Listen & Speak
          </button>
        </div>
      ) : phase === 'listening' ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '1rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>
            {renderSentence(prompt.sentence, prompt.target_word)}
          </p>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            margin: '0.75rem 0',
          }}>
            <Volume2 size={20} color="#3b82f6" style={{ animation: 'pulse 1.5s infinite' }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Listening…</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Replace "<strong>{prompt.target_word}</strong>" with a synonym when you speak
          </p>
        </div>
      ) : phase === 'recording' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.9rem', margin: '0 0 0.5rem', lineHeight: 1.6 }}>
            {renderSentence(prompt.sentence, prompt.target_word)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', justifyContent: 'center' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{
              fontSize: '1.5rem', fontWeight: 700,
              color: secondsLeft <= 5 ? '#ef4444' : 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
            }}>
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your synonym swap…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Synonym', score: result?.synonym_accuracy_score ?? 0 },
              { label: 'Context', score: result?.context_fit_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Overall', score: result?.overall_score ?? 0 },
            ].map((item) => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(item.score) }}>{item.score}/10</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.suggested_synonyms && result.suggested_synonyms.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: '3px solid #f59e0b',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                💡 Other synonyms you could try
              </p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {result.suggested_synonyms.map((w) => (
                  <span key={w} style={{
                    background: '#f59e0b10', color: '#d97706', borderRadius: '1rem',
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
              <RefreshCw size={14} /> Try Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

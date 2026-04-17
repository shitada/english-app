import { useState, useCallback, useEffect, useRef } from 'react';
import { Swords, Mic, RefreshCw, Square, Volume2 } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { fetchDebateTopic, evaluateDebate, type DebateTopicResponse, type DebateEvaluateResponse } from '../api';

const ROUND_SECONDS = 30;

type Phase = 'idle' | 'round1_speaking' | 'counter_playing' | 'round2_speaking' | 'evaluating' | 'done';

export default function QuickDebateCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [topic, setTopic] = useState<DebateTopicResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<DebateEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [round1Transcript, setRound1Transcript] = useState('');
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const phaseRef = useRef<Phase>('idle');

  // Keep phaseRef in sync
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const loadTopic = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await fetchDebateTopic(difficulty);
      setTopic(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      loadTopic();
    }
  }, [initialized, loadTopic]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        setRound1Transcript('');
        loadTopic();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [loadTopic]);

  const finishRound2 = useCallback(async () => {
    stopTimer();
    speech.stop();
    setPhase('evaluating');

    const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    const r2 = speech.transcript || speech.interimTranscript || '';

    if (!topic || !round1Transcript.trim() || !r2.trim()) {
      setPhase('idle');
      return;
    }

    try {
      const res = await evaluateDebate({
        statement: topic.statement,
        counter_argument: topic.counter_argument,
        user_round1_transcript: round1Transcript,
        user_round2_transcript: r2,
        total_duration_seconds: elapsed,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [topic, round1Transcript, speech, stopTimer]);

  const finishRound2Ref = useRef(finishRound2);
  finishRound2Ref.current = finishRound2;

  const startRound2 = useCallback(async () => {
    speech.reset();
    setSecondsLeft(ROUND_SECONDS);
    setPhase('round2_speaking');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          finishRound2Ref.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech]);

  const startRound2Ref = useRef(startRound2);
  startRound2Ref.current = startRound2;

  const playCounterArgument = useCallback(() => {
    if (!topic) return;
    setPhase('counter_playing');

    // Wait for TTS to finish, then start Round 2
    const checkInterval = setInterval(() => {
      // We need to check if TTS is done — use a polling approach
      // since the hook doesn't provide a callback
    }, 200);

    // Use utterance end event by watching isSpeaking
    const watchInterval = setInterval(() => {
      // Once speaking stops (after it started), transition to round 2
    }, 200);

    tts.speak(topic.counter_argument);

    // Poll for TTS completion
    let wasPlaying = false;
    const pollId = setInterval(() => {
      if (tts.isSpeaking) {
        wasPlaying = true;
      } else if (wasPlaying) {
        clearInterval(pollId);
        clearInterval(checkInterval);
        clearInterval(watchInterval);
        if (phaseRef.current === 'counter_playing') {
          startRound2Ref.current();
        }
      }
    }, 200);

    // Safety timeout: if TTS doesn't trigger, start round 2 after 15s
    setTimeout(() => {
      clearInterval(pollId);
      clearInterval(checkInterval);
      clearInterval(watchInterval);
      if (phaseRef.current === 'counter_playing') {
        startRound2Ref.current();
      }
    }, 15000);
  }, [topic, tts]);

  const finishRound1 = useCallback(() => {
    stopTimer();
    speech.stop();
    const t = speech.transcript || speech.interimTranscript || '';
    setRound1Transcript(t);

    if (!t.trim()) {
      setPhase('idle');
      return;
    }

    playCounterArgument();
  }, [speech, stopTimer, playCounterArgument]);

  const finishRound1Ref = useRef(finishRound1);
  finishRound1Ref.current = finishRound1;

  const handleStart = useCallback(async () => {
    if (!topic) return;
    speech.reset();
    setRound1Transcript('');
    setResult(null);
    setSecondsLeft(ROUND_SECONDS);
    startTimeRef.current = Date.now();
    setPhase('round1_speaking');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          finishRound1Ref.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [topic, speech]);

  const handleNewTopic = useCallback(() => {
    stopTimer();
    tts.stop();
    speech.reset();
    setPhase('idle');
    setResult(null);
    setRound1Transcript('');
    loadTopic();
  }, [loadTopic, speech, tts, stopTimer]);

  useEffect(() => {
    return () => {
      stopTimer();
      tts.stop();
    };
  }, [stopTimer, tts]);

  if (!speech.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Swords size={20} color="#dc2626" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Debate</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading debate topic…</p>
      ) : !topic ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No topic available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '1rem', margin: '0 0 0.5rem', fontWeight: 700 }}>
            "{topic.statement}"
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.75rem', fontStyle: 'italic' }}>
            💡 {topic.context_hint}
          </p>
          <div style={{
            background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8,
            padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
            fontSize: '0.8rem', color: 'var(--text-secondary)',
          }}>
            <strong>How it works:</strong> Speak your argument (30s) → Listen to a counter-argument → Respond (30s)
          </div>
          <button onClick={handleStart} className="btn btn-primary" data-testid="debate-start-btn">
            <Mic size={16} /> Start Debate ({ROUND_SECONDS}s per round)
          </button>
        </div>
      ) : phase === 'round1_speaking' ? (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: '#3b82f618', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3b82f6' }}>Round 1 — Your Argument</span>
          </div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
            "{topic.statement}"
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <button onClick={finishRound1} className="btn btn-secondary" data-testid="debate-round1-stop-btn" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done — Hear Counter
          </button>
        </div>
      ) : phase === 'counter_playing' ? (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: '#f9731618', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f97316' }}>Counter-Argument</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Volume2 size={18} color="white" />
            </div>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Playing counter-argument…</span>
          </div>
          <p style={{ color: 'var(--text)', fontSize: '0.9rem', fontStyle: 'italic', margin: '0.5rem 0' }}>
            "{topic.counter_argument}"
          </p>
        </div>
      ) : phase === 'round2_speaking' ? (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: '#dc262618', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#dc2626' }}>Round 2 — Your Rebuttal</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
            They said: "{topic.counter_argument}"
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <button onClick={() => finishRound2Ref.current()} className="btn btn-secondary" data-testid="debate-round2-stop-btn" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done
          </button>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your debate…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Argument', score: result?.argument_structure_score ?? 0 },
              { label: 'Rebuttal', score: result?.rebuttal_quality_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Vocab', score: result?.vocabulary_score ?? 0 },
              { label: 'Coherence', score: result?.coherence_score ?? 0 },
              { label: 'Overall', score: result?.overall_score ?? 0 },
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
          {result?.model_argument && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
              borderLeft: '3px solid #3b82f6',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Argument
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_argument}
              </p>
            </div>
          )}
          {result?.model_rebuttal && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: '3px solid #dc2626',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Rebuttal
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_rebuttal}
              </p>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setRound1Transcript(''); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewTopic} className="btn btn-primary" data-testid="debate-next-btn">
              <RefreshCw size={14} /> New Topic
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

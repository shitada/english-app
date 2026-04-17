import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Timer, TrendingUp, RotateCcw, ChevronRight, Zap } from 'lucide-react';
import { getFluencySprintTopic, evaluateFluencySprint, type FluencySprintTopic, type FluencySprintResult } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

type Phase = 'idle' | 'round1' | 'round2' | 'round3' | 'evaluating' | 'results';

const ROUND_DURATIONS = [60, 40, 20] as const;
const ROUND_LABELS = ['Round 1 — 60s', 'Round 2 — 40s', 'Round 3 — 20s'] as const;

const PERSONAL_BEST_KEY = 'fluency-sprint-personal-best';

function getPersonalBest(): number | null {
  try {
    const stored = localStorage.getItem(PERSONAL_BEST_KEY);
    return stored ? parseFloat(stored) : null;
  } catch {
    return null;
  }
}

function setPersonalBest(score: number): void {
  try {
    localStorage.setItem(PERSONAL_BEST_KEY, String(score));
  } catch {
    // ignore localStorage errors
  }
}

export default function FluencySprintCard() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [topic, setTopic] = useState<FluencySprintTopic | null>(null);
  const [difficulty, setDifficulty] = useState('intermediate');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [result, setResult] = useState<FluencySprintResult | null>(null);
  const [personalBest, setPersonalBestState] = useState<number | null>(getPersonalBest());

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { transcript, interimTranscript, isListening, isSupported, start, stop, reset } = useSpeechRecognition({ continuous: true });

  const currentRoundIndex = phase === 'round1' ? 0 : phase === 'round2' ? 1 : phase === 'round3' ? 2 : -1;

  const fetchTopic = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await getFluencySprintTopic(difficulty);
      setTopic(t);
    } catch {
      setError('Failed to load topic. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [difficulty]);

  const startRound = useCallback((roundPhase: Phase, duration: number) => {
    reset();
    setPhase(roundPhase);
    setTimeLeft(duration);
    start();

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [start, reset]);

  // Handle round end when timer hits 0
  useEffect(() => {
    if (timeLeft === 0 && currentRoundIndex >= 0) {
      stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [timeLeft, currentRoundIndex, stop]);

  // Capture transcript when stopping (timeLeft hit 0)
  useEffect(() => {
    if (timeLeft !== 0 || currentRoundIndex < 0 || isListening) return;

    const finalTranscript = (transcript + ' ' + interimTranscript).trim();
    setTranscripts(prev => {
      const updated = [...prev];
      updated[currentRoundIndex] = finalTranscript;
      return updated;
    });

    // Move to next round or evaluate
    if (currentRoundIndex < 2) {
      const nextPhase = (['round1', 'round2', 'round3'] as Phase[])[currentRoundIndex + 1];
      const nextDuration = ROUND_DURATIONS[currentRoundIndex + 1];
      // Small delay before next round
      setTimeout(() => startRound(nextPhase, nextDuration), 1500);
    } else {
      setPhase('evaluating');
    }
  }, [timeLeft, currentRoundIndex, isListening, transcript, interimTranscript, startRound]);

  // Evaluate when all rounds complete
  useEffect(() => {
    if (phase !== 'evaluating' || !topic) return;

    const doEvaluate = async () => {
      try {
        const res = await evaluateFluencySprint(
          topic.topic,
          transcripts,
          [...ROUND_DURATIONS],
        );
        setResult(res);

        // Update personal best (highest WPM in round 3)
        const round3Wpm = res.rounds[2]?.wpm ?? 0;
        if (personalBest === null || round3Wpm > personalBest) {
          setPersonalBest(round3Wpm);
          setPersonalBestState(round3Wpm);
        }

        setPhase('results');
      } catch {
        setError('Evaluation failed. Please try again.');
        setPhase('idle');
      }
    };
    doEvaluate();
  }, [phase, topic, transcripts, personalBest]);

  const handleStart = async () => {
    if (!topic) {
      await fetchTopic();
    }
    setTranscripts([]);
    setResult(null);
    setError(null);
  };

  // Start round 1 once topic is loaded and we're ready
  useEffect(() => {
    if (topic && phase === 'idle' && transcripts.length === 0 && !result) {
      startRound('round1', ROUND_DURATIONS[0]);
    }
  }, [topic, phase, transcripts, result, startRound]);

  const handleReset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stop();
    reset();
    setPhase('idle');
    setTopic(null);
    setTranscripts([]);
    setResult(null);
    setError(null);
  };

  const handleNewTopic = () => {
    handleReset();
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const isRoundActive = currentRoundIndex >= 0;

  return (
    <div data-testid="fluency-sprint-card" style={{
      background: 'var(--card-bg, #ffffff)',
      border: '1px solid var(--border, #e5e7eb)',
      borderRadius: 12,
      padding: '1.25rem',
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
        <Zap size={20} style={{ color: 'var(--primary, #6366f1)' }} />
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary, #111827)' }}>
          4-3-2 Fluency Sprint
        </h3>
        {personalBest !== null && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-secondary, #6b7280)',
            background: 'var(--bg-secondary, #f3f4f6)',
            padding: '2px 8px',
            borderRadius: 8,
          }}>
            PB: {personalBest} WPM
          </span>
        )}
      </div>

      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary, #6b7280)' }}>
        Speak about one topic 3 times with decreasing time limits. Build fluency through repetition!
      </p>

      {error && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--danger-bg, #fef2f2)',
          color: 'var(--danger, #ef4444)',
          borderRadius: 8,
          fontSize: '0.85rem',
          marginBottom: '0.75rem',
        }}>
          {error}
        </div>
      )}

      {/* Idle phase */}
      {phase === 'idle' && !topic && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {(['beginner', 'intermediate', 'advanced'] as const).map(d => (
              <button
                key={d}
                data-testid={`fluency-sprint-difficulty-${d}`}
                onClick={() => setDifficulty(d)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: difficulty === d ? 'var(--primary, #6366f1)' : 'var(--card-bg, #ffffff)',
                  color: difficulty === d ? '#fff' : 'var(--text-primary, #111827)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  textTransform: 'capitalize',
                }}
              >
                {d}
              </button>
            ))}
          </div>
          {!isSupported && (
            <p style={{ fontSize: '0.8rem', color: 'var(--warning, #f59e0b)' }}>
              Speech recognition is not supported in this browser.
            </p>
          )}
          <button
            data-testid="fluency-sprint-start"
            onClick={handleStart}
            disabled={loading || !isSupported}
            style={{
              width: '100%',
              padding: '0.6rem',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary, #6366f1)',
              color: '#fff',
              cursor: loading ? 'wait' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
              opacity: loading || !isSupported ? 0.6 : 1,
            }}
          >
            {loading ? 'Loading topic…' : 'Start Sprint'}
          </button>
        </div>
      )}

      {/* Active round phase */}
      {isRoundActive && (
        <div>
          {topic && (
            <div style={{
              padding: '0.75rem',
              background: 'var(--bg-secondary, #f3f4f6)',
              borderRadius: 8,
              marginBottom: '0.75rem',
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary, #111827)', marginBottom: 4 }}>
                {topic.topic}
              </div>
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>
                {topic.guiding_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Round indicators */}
          <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem' }}>
            {ROUND_LABELS.map((label, i) => (
              <div
                key={i}
                data-testid={`fluency-sprint-round-${i + 1}`}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontSize: '0.75rem',
                  fontWeight: i === currentRoundIndex ? 700 : 400,
                  background: i < currentRoundIndex
                    ? 'var(--success, #10b981)'
                    : i === currentRoundIndex
                    ? 'var(--primary, #6366f1)'
                    : 'var(--bg-secondary, #f3f4f6)',
                  color: i <= currentRoundIndex ? '#fff' : 'var(--text-secondary, #6b7280)',
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Timer and mic status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: '0.75rem' }}>
            <Timer size={20} style={{ color: timeLeft <= 5 ? 'var(--danger, #ef4444)' : 'var(--primary, #6366f1)' }} />
            <span
              data-testid="fluency-sprint-timer"
              style={{
                fontSize: '2rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: timeLeft <= 5 ? 'var(--danger, #ef4444)' : 'var(--text-primary, #111827)',
              }}
            >
              {timeLeft}s
            </span>
            {isListening ? (
              <Mic size={20} style={{ color: 'var(--danger, #ef4444)' }} />
            ) : (
              <MicOff size={20} style={{ color: 'var(--text-secondary, #6b7280)' }} />
            )}
          </div>

          {/* Live transcript */}
          <div style={{
            minHeight: 60,
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-secondary, #f3f4f6)',
            borderRadius: 8,
            fontSize: '0.85rem',
            color: 'var(--text-primary, #111827)',
          }}>
            {transcript}
            {interimTranscript && (
              <span style={{ color: 'var(--text-secondary, #6b7280)', fontStyle: 'italic' }}>
                {interimTranscript}
              </span>
            )}
            {!transcript && !interimTranscript && (
              <span style={{ color: 'var(--text-secondary, #6b7280)', fontStyle: 'italic' }}>
                Start speaking…
              </span>
            )}
          </div>
        </div>
      )}

      {/* Evaluating phase */}
      {phase === 'evaluating' && (
        <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
          <div style={{
            width: 32,
            height: 32,
            border: '3px solid var(--primary, #6366f1)',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            margin: '0 auto 0.75rem',
            animation: 'spin 1s linear infinite',
          }} />
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>
            Analyzing your fluency…
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Results phase */}
      {phase === 'results' && result && (
        <div data-testid="fluency-sprint-results">
          {/* WPM progression */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <TrendingUp size={16} style={{ color: 'var(--primary, #6366f1)' }} />
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary, #111827)' }}>
                WPM Progression
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {result.rounds.map((r, i) => {
                const maxWpm = Math.max(...result.rounds.map(rd => rd.wpm), 1);
                const barHeight = Math.max(20, (r.wpm / maxWpm) * 80);
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      height: 100,
                    }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary, #111827)', marginBottom: 4 }}>
                        {r.wpm}
                      </span>
                      <div style={{
                        width: '100%',
                        height: barHeight,
                        background: i === 2
                          ? 'var(--success, #10b981)'
                          : i === 1
                          ? 'var(--primary, #6366f1)'
                          : 'var(--text-secondary, #6b7280)',
                        borderRadius: 4,
                        opacity: 0.8,
                      }} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)', marginTop: 4 }}>
                      R{i + 1} ({ROUND_DURATIONS[i]}s)
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>
                      {r.word_count} words
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fluency improvement score */}
          <div style={{
            padding: '0.75rem',
            background: result.fluency_improvement_score > 0
              ? 'var(--success-bg, #f0fdf4)'
              : 'var(--bg-secondary, #f3f4f6)',
            borderRadius: 8,
            textAlign: 'center',
            marginBottom: '0.75rem',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: result.fluency_improvement_score > 0 ? 'var(--success, #10b981)' : 'var(--text-primary, #111827)' }}>
              {result.fluency_improvement_score > 0 ? '+' : ''}{result.fluency_improvement_score}%
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>
              Fluency Improvement (R1 → R3)
            </div>
          </div>

          {/* Feedback */}
          <div style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-secondary, #f3f4f6)',
            borderRadius: 8,
            fontSize: '0.85rem',
            color: 'var(--text-primary, #111827)',
            marginBottom: '0.75rem',
          }}>
            {result.feedback}
          </div>

          {/* Strengths */}
          {result.strengths.length > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success, #10b981)', marginBottom: 4 }}>
                Strengths
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-primary, #111827)' }}>
                {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Tips */}
          {result.tips.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary, #6366f1)', marginBottom: 4 }}>
                Tips
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-primary, #111827)' }}>
                {result.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="fluency-sprint-retry"
              onClick={() => {
                setTranscripts([]);
                setResult(null);
                setPhase('idle');
                // Reuse same topic — startRound will fire from useEffect
              }}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: 8,
                border: '1px solid var(--border, #e5e7eb)',
                background: 'var(--card-bg, #ffffff)',
                color: 'var(--text-primary, #111827)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <RotateCcw size={14} /> Same Topic
            </button>
            <button
              data-testid="fluency-sprint-new-topic"
              onClick={handleNewTopic}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: 8,
                border: 'none',
                background: 'var(--primary, #6366f1)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              New Topic <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

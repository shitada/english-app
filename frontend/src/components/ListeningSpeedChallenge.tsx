import { useState, useCallback, useEffect, useRef } from 'react';
import { Volume2, ArrowLeft, Trophy, Zap, CheckCircle, XCircle } from 'lucide-react';
import type { ListeningQuizQuestion } from '../api';

export interface SpeedChallengeProps {
  passage: string;
  questions: ListeningQuizQuestion[];
  onBack: () => void;
}

const SPEED_LADDER = [0.8, 1.0, 1.15, 1.3, 1.5] as const;

const SPEED_LABELS: Record<number, string> = {
  0.8: 'Warm-up',
  1.0: 'Normal',
  1.15: 'Brisk',
  1.3: 'Fast',
  1.5: 'Turbo',
};

const TIER_MESSAGES: Record<number, { emoji: string; message: string }> = {
  0: { emoji: '🔇', message: 'Keep practicing — you\'ll get there!' },
  1: { emoji: '🎧', message: 'Solid start! Normal speed down.' },
  2: { emoji: '🔥', message: 'Great ears! Brisk speed mastered.' },
  3: { emoji: '🏆', message: 'Native-speed listener!' },
  4: { emoji: '⚡', message: 'Turbo listener — incredible!' },
};

function getTierMessage(levelReached: number) {
  if (levelReached >= 4) return TIER_MESSAGES[4];
  if (levelReached >= 3) return TIER_MESSAGES[3];
  if (levelReached >= 2) return TIER_MESSAGES[2];
  if (levelReached >= 1) return TIER_MESSAGES[1];
  return TIER_MESSAGES[0];
}

const STORAGE_KEY = 'listening-speed-challenge-pb';

type ChallengePhase = 'ready' | 'playing' | 'question' | 'correct' | 'wrong' | 'complete';

export function ListeningSpeedChallenge({ passage, questions, onBack }: SpeedChallengeProps) {
  const [currentLevel, setCurrentLevel] = useState(0);
  const [phase, setPhase] = useState<ChallengePhase>('ready');
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [maxSpeedReached, setMaxSpeedReached] = useState(0);
  const [personalBest, setPersonalBest] = useState<number>(0);
  const isSpeakingRef = useRef(false);

  // Load personal best from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setPersonalBest(parseFloat(stored));
    } catch { /* ignore */ }
  }, []);

  const savePersonalBest = useCallback((speed: number) => {
    try {
      const current = parseFloat(localStorage.getItem(STORAGE_KEY) || '0');
      if (speed > current) {
        localStorage.setItem(STORAGE_KEY, String(speed));
        setPersonalBest(speed);
      }
    } catch { /* ignore */ }
  }, []);

  // Get question for current level (cycle through if fewer questions than levels)
  const currentQuestion = questions[currentLevel % questions.length];
  const currentSpeed = SPEED_LADDER[currentLevel] ?? SPEED_LADDER[SPEED_LADDER.length - 1];

  const playPassage = useCallback(() => {
    window.speechSynthesis.cancel();
    setPhase('playing');
    isSpeakingRef.current = true;

    const utterance = new SpeechSynthesisUtterance(passage);
    utterance.lang = 'en-US';
    utterance.rate = currentSpeed;
    utterance.onend = () => {
      isSpeakingRef.current = false;
      setPhase('question');
    };
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      setPhase('question');
    };
    window.speechSynthesis.speak(utterance);
  }, [passage, currentSpeed]);

  const startChallenge = useCallback(() => {
    setCurrentLevel(0);
    setSelectedOption(null);
    setMaxSpeedReached(0);
    playPassage();
  }, [playPassage]);

  const handleSubmit = useCallback(() => {
    if (selectedOption === null || !currentQuestion) return;
    const isCorrect = selectedOption === currentQuestion.correct_index;

    if (isCorrect) {
      const reachedSpeed = SPEED_LADDER[currentLevel];
      setMaxSpeedReached(reachedSpeed);

      if (currentLevel >= SPEED_LADDER.length - 1) {
        // Completed all levels!
        savePersonalBest(reachedSpeed);
        setPhase('complete');
      } else {
        setPhase('correct');
      }
    } else {
      const reachedSpeed = currentLevel > 0 ? SPEED_LADDER[currentLevel - 1] : 0;
      setMaxSpeedReached(reachedSpeed);
      savePersonalBest(reachedSpeed);
      setPhase('wrong');
    }
  }, [selectedOption, currentQuestion, currentLevel, savePersonalBest]);

  const advanceLevel = useCallback(() => {
    setSelectedOption(null);
    setCurrentLevel(prev => prev + 1);
    // We need to play at the next speed level — use a small timeout so state updates
    setTimeout(() => {
      window.speechSynthesis.cancel();
      const nextLevel = currentLevel + 1;
      const nextSpeed = SPEED_LADDER[nextLevel] ?? SPEED_LADDER[SPEED_LADDER.length - 1];
      setPhase('playing');
      isSpeakingRef.current = true;

      const utterance = new SpeechSynthesisUtterance(passage);
      utterance.lang = 'en-US';
      utterance.rate = nextSpeed;
      utterance.onend = () => {
        isSpeakingRef.current = false;
        setPhase('question');
      };
      utterance.onerror = () => {
        isSpeakingRef.current = false;
        setPhase('question');
      };
      window.speechSynthesis.speak(utterance);
    }, 300);
  }, [currentLevel, passage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  const gaugePct = phase === 'complete'
    ? 100
    : (maxSpeedReached > 0
      ? ((SPEED_LADDER.indexOf(maxSpeedReached as typeof SPEED_LADDER[number]) + 1) / SPEED_LADDER.length) * 100
      : 0);

  const isResultPhase = phase === 'wrong' || phase === 'complete';
  const tierInfo = getTierMessage(
    isResultPhase
      ? (maxSpeedReached > 0 ? SPEED_LADDER.indexOf(maxSpeedReached as typeof SPEED_LADDER[number]) + 1 : 0)
      : 0
  );

  return (
    <div className="card" style={{ maxWidth: 600, margin: '0 auto' }} data-testid="speed-challenge">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => { window.speechSynthesis.cancel(); onBack(); }}
          data-testid="speed-challenge-back"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '0.3rem 0.6rem', borderRadius: 6,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
          }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={20} color="var(--warning, #f59e0b)" /> Speed Challenge
        </h3>
      </div>

      {/* Speed Ladder Progress */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }} data-testid="speed-ladder">
        {SPEED_LADDER.map((speed, idx) => {
          const isActive = currentLevel === idx && !isResultPhase;
          const isCompleted = phase === 'complete' ? idx <= currentLevel : idx < currentLevel;
          const isFailed = phase === 'wrong' && idx === currentLevel;
          return (
            <div
              key={speed}
              data-testid={`speed-level-${speed}`}
              style={{
                flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 8,
                border: `2px solid ${
                  isFailed ? 'var(--danger, #ef4444)'
                  : isActive ? 'var(--primary, #6366f1)'
                  : isCompleted ? 'var(--success, #22c55e)'
                  : 'var(--border)'
                }`,
                background: isCompleted ? 'var(--success-bg, #f0fdf4)'
                  : isActive ? 'rgba(99,102,241,0.08)'
                  : isFailed ? 'var(--danger-bg, #fef2f2)'
                  : 'transparent',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{
                fontSize: 14, fontWeight: 700,
                color: isCompleted ? 'var(--success, #22c55e)'
                  : isActive ? 'var(--primary, #6366f1)'
                  : isFailed ? 'var(--danger, #ef4444)'
                  : 'var(--text-secondary)',
              }}>
                {speed}x
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                {SPEED_LABELS[speed]}
              </div>
              {isCompleted && <CheckCircle size={14} color="var(--success, #22c55e)" style={{ marginTop: 2 }} />}
              {isFailed && <XCircle size={14} color="var(--danger, #ef4444)" style={{ marginTop: 2 }} />}
            </div>
          );
        })}
      </div>

      {/* Ready Phase */}
      {phase === 'ready' && (
        <div style={{ textAlign: 'center' }} data-testid="speed-challenge-ready">
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Listen to the passage at increasing speeds and answer a question at each level.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Get it right to advance. Get it wrong and the challenge ends!
          </p>
          {personalBest > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              borderRadius: 20, background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border)',
              fontSize: 13, marginBottom: 16,
            }} data-testid="personal-best-badge">
              <Trophy size={14} color="var(--warning, #f59e0b)" />
              Personal Best: <strong>{personalBest}x</strong>
            </div>
          )}
          <div>
            <button
              className="btn btn-primary"
              onClick={startChallenge}
              data-testid="start-speed-challenge"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, padding: '0.7rem 2rem' }}
            >
              <Zap size={18} /> Start Challenge
            </button>
          </div>
        </div>
      )}

      {/* Playing Phase */}
      {phase === 'playing' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }} data-testid="speed-challenge-playing">
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(99,102,241,0.1)', marginBottom: 12,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}>
            <Volume2 size={32} color="var(--primary, #6366f1)" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            Listening at {currentSpeed}x…
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Level {currentLevel + 1} of {SPEED_LADDER.length} — {SPEED_LABELS[currentSpeed]}
          </p>
        </div>
      )}

      {/* Question Phase */}
      {phase === 'question' && currentQuestion && (
        <div data-testid="speed-challenge-question">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
            padding: '6px 12px', borderRadius: 8,
            background: 'var(--bg-secondary, #f9fafb)', fontSize: 13, color: 'var(--text-secondary)',
          }}>
            <Zap size={14} color="var(--warning, #f59e0b)" />
            Speed: <strong>{currentSpeed}x</strong> — Level {currentLevel + 1}/{SPEED_LADDER.length}
          </div>
          <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>
            {currentQuestion.question}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {currentQuestion.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => setSelectedOption(i)}
                data-testid={`speed-option-${i}`}
                style={{
                  padding: '0.6rem 1rem', borderRadius: 8, textAlign: 'left',
                  border: `2px solid ${selectedOption === i ? 'var(--primary, #6366f1)' : 'var(--border)'}`,
                  background: selectedOption === i ? 'rgba(99,102,241,0.08)' : 'transparent',
                  color: 'var(--text)', cursor: 'pointer',
                  fontWeight: selectedOption === i ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                  fontSize: 11, fontWeight: 700,
                  background: selectedOption === i ? 'var(--primary, #6366f1)' : 'var(--bg-secondary, #f0f0f0)',
                  color: selectedOption === i ? '#fff' : 'var(--text-secondary)',
                }}>{i + 1}</span>
                {opt}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={selectedOption === null}
            data-testid="speed-submit"
            style={{ opacity: selectedOption === null ? 0.5 : 1 }}
          >
            Submit Answer
          </button>
        </div>
      )}

      {/* Correct Feedback — brief before advancing */}
      {phase === 'correct' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }} data-testid="speed-challenge-correct">
          <CheckCircle size={48} color="var(--success, #22c55e)" />
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--success, #22c55e)', margin: '8px 0' }}>
            Correct!
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {currentSpeed}x cleared — next up: {SPEED_LADDER[currentLevel + 1]}x
          </p>
          <button
            className="btn btn-primary"
            onClick={advanceLevel}
            data-testid="speed-next-level"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Zap size={16} /> Next Level
          </button>
        </div>
      )}

      {/* Result Screens (wrong or complete) */}
      {isResultPhase && (
        <div style={{ textAlign: 'center', padding: '10px 0' }} data-testid="speed-challenge-result">
          <div style={{ fontSize: 48, marginBottom: 4 }}>{tierInfo.emoji}</div>
          <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            {phase === 'complete' ? 'Challenge Complete!' : 'Challenge Over'}
          </p>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {tierInfo.message}
          </p>

          {/* Speed Gauge */}
          <div style={{ maxWidth: 360, margin: '0 auto 16px' }} data-testid="speed-gauge">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Max Comprehension Speed</span>
              <span style={{ fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
                {maxSpeedReached > 0 ? `${maxSpeedReached}x` : '—'}
              </span>
            </div>
            <div style={{
              height: 12, borderRadius: 6,
              background: 'var(--border, #e5e7eb)', overflow: 'hidden',
            }}>
              <div
                data-testid="speed-gauge-fill"
                style={{
                  height: '100%', borderRadius: 6,
                  width: `${gaugePct}%`,
                  background: gaugePct >= 80 ? 'var(--success, #22c55e)'
                    : gaugePct >= 40 ? 'var(--primary, #6366f1)'
                    : 'var(--warning, #f59e0b)',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
              {SPEED_LADDER.map(s => <span key={s}>{s}x</span>)}
            </div>
          </div>

          {/* Personal Best */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 20, background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border)',
            fontSize: 14, marginBottom: 20,
          }} data-testid="personal-best-result">
            <Trophy size={16} color="var(--warning, #f59e0b)" />
            Personal Best: <strong>{personalBest > 0 ? `${personalBest}x` : '—'}</strong>
            {maxSpeedReached > 0 && maxSpeedReached >= personalBest && maxSpeedReached > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--success, #22c55e)',
                padding: '2px 6px', borderRadius: 4, background: 'var(--success-bg, #f0fdf4)',
              }}>NEW!</span>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={startChallenge}
              data-testid="speed-retry"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Zap size={14} /> Try Again
            </button>
            <button
              className="btn"
              onClick={() => { window.speechSynthesis.cancel(); onBack(); }}
              data-testid="speed-back-to-results"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <ArrowLeft size={14} /> Back to Results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

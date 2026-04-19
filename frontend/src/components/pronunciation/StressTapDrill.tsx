import { useReducer, useEffect, useState, useCallback, useMemo } from 'react';
import { Volume2, RotateCcw, ArrowRight, Check, X } from 'lucide-react';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import {
  STRESS_WORDS,
  initStressDrill,
  stressDrillReducer,
  stressScore,
  selectWeightedRound,
  loadStressStats,
  saveStressStats,
  recordStressAttempt,
  type StressWord,
  type StressStats,
} from '../../utils/stressPatterns';

const ROUND_SIZE = 6;
const SLOW_RATE = 0.7;

export interface StressTapDrillProps {
  /** Optional override of the curated word list (used by tests). */
  wordsOverride?: StressWord[];
  /** Optional callback when the round completes. */
  onComplete?: (correct: number, total: number) => void;
  /** Optional back handler for embedding inside Pronunciation page chrome. */
  onBack?: () => void;
}

/**
 * Word-Stress "Stress Tap" mini-game.
 *
 * Each word is split into syllable pills. The user taps the pill they
 * believe carries the PRIMARY stress; we grade immediately, play the
 * word via TTS, and after `ROUND_SIZE` words show a summary.
 */
export function StressTapDrill({ wordsOverride, onComplete, onBack }: StressTapDrillProps) {
  const tts = useSpeechSynthesis();
  const sourceWords = wordsOverride ?? STRESS_WORDS;

  const [stats, setStats] = useState<StressStats>(() => loadStressStats());
  const initialRound = useMemo(
    () => selectWeightedRound(sourceWords, stats, ROUND_SIZE),
    // intentionally only computed once per mount; restart re-derives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [state, dispatch] = useReducer(stressDrillReducer, initialRound, initStressDrill);

  const current = state.round[state.index];
  const tapped = current ? state.taps[state.index] : null;
  const answered = tapped != null;
  const isCorrect = answered && current && tapped === current.stressIndex;

  // Auto-play the word on grade so the user hears the correct stress pattern.
  useEffect(() => {
    if (answered && current) {
      tts.speak(current.word);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, state.index]);

  // Persist + notify on round completion.
  useEffect(() => {
    if (state.phase === 'summary' && state.round.length > 0) {
      const score = stressScore(state);
      onComplete?.(score, state.round.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const handleTap = useCallback(
    (pillIndex: number) => {
      if (!current || answered) return;
      const correct = pillIndex === current.stressIndex;
      dispatch({ type: 'tap', pillIndex });
      setStats((prev) => {
        const next = recordStressAttempt(prev, current.word, correct);
        saveStressStats(next);
        return next;
      });
    },
    [current, answered],
  );

  const handleNext = useCallback(() => {
    dispatch({ type: 'next' });
  }, []);

  const handleRestart = useCallback(() => {
    const fresh = selectWeightedRound(sourceWords, stats, ROUND_SIZE);
    dispatch({ type: 'restart', round: fresh });
  }, [sourceWords, stats]);

  if (!current && state.phase !== 'summary') {
    // Empty source — defensive.
    return (
      <div className="card" data-testid="stress-tap-empty">
        <p>No stress-pattern words available.</p>
        {onBack && (
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
        )}
      </div>
    );
  }

  if (state.phase === 'summary') {
    const score = stressScore(state);
    return (
      <div className="card" data-testid="stress-tap-summary">
        <h3 style={{ marginBottom: 12, textAlign: 'center' }}>Stress Tap — Round Complete</h3>
        <p style={{ textAlign: 'center', fontSize: 24, marginBottom: 16 }}>
          <strong>{score}</strong> / {state.round.length}
        </p>
        <ul style={{ listStyle: 'none', padding: 0, marginBottom: 16 }}>
          {state.round.map((w, i) => {
            const t = state.taps[i];
            const ok = t != null && t === w.stressIndex;
            return (
              <li
                key={`${w.word}-${i}`}
                data-testid="stress-tap-summary-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderBottom: '1px solid var(--border)',
                }}
              >
                <span aria-hidden>{ok ? '✅' : '❌'}</span>
                <span style={{ fontWeight: 600 }}>{w.word}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  ({w.syllables.map((s, j) => j === w.stressIndex ? s.toUpperCase() : s).join('·')})
                </span>
              </li>
            );
          })}
        </ul>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleRestart}
            data-testid="stress-tap-restart"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={16} /> New Round
          </button>
          {onBack && (
            <button className="btn btn-secondary" onClick={onBack}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  // Active question.
  return (
    <div className="card" data-testid="stress-tap-drill">
      <h3 style={{ marginBottom: 8, textAlign: 'center' }}>Stress Tap</h3>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Tap the syllable that carries the <strong>primary stress</strong>.
      </p>

      <div
        style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12, marginBottom: 8 }}
        data-testid="stress-tap-progress"
      >
        Word {state.index + 1} / {state.round.length}
      </div>

      <div
        style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}
        role="group"
        aria-label={`Syllables of ${current.word}`}
      >
        {current.syllables.map((syl, i) => {
          let bg = 'var(--bg-secondary)';
          let color = 'var(--text-primary)';
          if (answered) {
            if (i === current.stressIndex) { bg = '#16a34a'; color = 'white'; }
            else if (i === tapped)         { bg = '#dc2626'; color = 'white'; }
          }
          return (
            <button
              key={i}
              type="button"
              data-testid={`stress-tap-pill-${i}`}
              aria-pressed={tapped === i}
              disabled={answered}
              onClick={() => handleTap(i)}
              style={{
                padding: '12px 18px',
                fontSize: 22,
                fontWeight: 600,
                borderRadius: 999,
                border: '2px solid var(--border)',
                background: bg,
                color,
                cursor: answered ? 'default' : 'pointer',
                minWidth: 56,
              }}
            >
              {syl}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
        <button
          className="btn btn-secondary"
          onClick={() => tts.speak(current.word)}
          disabled={tts.isSpeaking}
          data-testid="stress-tap-play"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Volume2 size={16} /> Play
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => tts.speak(current.word, 'en-US', SLOW_RATE)}
          disabled={tts.isSpeaking}
          data-testid="stress-tap-replay-slow"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Volume2 size={16} /> Replay slow
        </button>
      </div>

      {answered && (
        <div
          data-testid="stress-tap-feedback"
          aria-live="polite"
          style={{
            textAlign: 'center',
            marginBottom: 12,
            color: isCorrect ? '#16a34a' : '#dc2626',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            justifyContent: 'center',
            width: '100%',
          }}
        >
          {isCorrect ? <Check size={18} /> : <X size={18} />}
          {isCorrect ? 'Correct!' : `Stress is on "${current.syllables[current.stressIndex]}"`}
          {current.meaning && (
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-secondary)' }}>
              — {current.meaning}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          className="btn btn-primary"
          onClick={handleNext}
          disabled={!answered}
          data-testid="stress-tap-next"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {state.index >= state.round.length - 1 ? 'See results' : 'Next'} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

export default StressTapDrill;

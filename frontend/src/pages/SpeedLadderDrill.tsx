import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Play, RotateCcw, Check, X } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  startSpeedLadder,
  answerSpeedLadder,
  type SpeedLadderStartResponse,
  type SpeedLadderQuestion,
} from '../api';

type Phase = 'idle' | 'loading' | 'listening' | 'quiz' | 'feedback' | 'summary' | 'error';

interface StepResult {
  speed: number;
  correct: boolean;
}

const SPEED_ICONS: Record<string, string> = {
  '0.8': '🐢',
  '1': '🚶',
  '1.25': '🏃',
};

export function speedKey(speed: number): string {
  return `${Number(speed.toFixed(2))}`;
}

export function speedLabel(speed: number): string {
  const icon = SPEED_ICONS[speedKey(speed)] ?? '🔊';
  return `${icon} ${speed}×`;
}

export function summarize(results: StepResult[]): {
  totalCorrect: number;
  total: number;
  accuracyBySpeed: Record<string, number>;
  recommendation: string;
} {
  const total = results.length;
  const totalCorrect = results.filter((r) => r.correct).length;
  const bySpeed: Record<string, { c: number; t: number }> = {};
  for (const r of results) {
    const k = speedKey(r.speed);
    if (!bySpeed[k]) bySpeed[k] = { c: 0, t: 0 };
    bySpeed[k].t += 1;
    if (r.correct) bySpeed[k].c += 1;
  }
  const accuracyBySpeed: Record<string, number> = {};
  for (const [k, v] of Object.entries(bySpeed)) {
    accuracyBySpeed[k] = v.t ? v.c / v.t : 0;
  }
  // Recommendation — find the first speed the learner missed.
  const ordered = [...results].sort((a, b) => a.speed - b.speed);
  const firstMiss = ordered.find((r) => !r.correct);
  let recommendation: string;
  if (!firstMiss) {
    recommendation = 'Excellent! You kept up with every speed. Try a harder passage next.';
  } else if (firstMiss.speed <= 0.8) {
    recommendation = 'Slow down and re-listen: focus on the overall gist before details.';
  } else if (firstMiss.speed <= 1.0) {
    recommendation = 'Your baseline speed needs more reps — practice at 1.0× to build comfort.';
  } else {
    recommendation = 'You handle normal speed well. Push into 1.25× with more practice.';
  }
  return { totalCorrect, total, accuracyBySpeed, recommendation };
}

export default function SpeedLadderDrill() {
  const tts = useSpeechSynthesis();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [session, setSession] = useState<SpeedLadderStartResponse | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const [playing, setPlaying] = useState(false);

  const currentQuestion: SpeedLadderQuestion | null = useMemo(() => {
    if (!session) return null;
    return session.questions[stepIndex] ?? null;
  }, [session, stepIndex]);

  const handleStart = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    try {
      const data = await startSpeedLadder();
      setSession(data);
      setStepIndex(0);
      setResults([]);
      setChosenIndex(null);
      setLastCorrect(null);
      setPhase('listening');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start drill');
      setPhase('error');
    }
  }, []);

  const handlePlay = useCallback(() => {
    if (!session || !currentQuestion) return;
    try {
      setPlaying(true);
      tts.speak(session.passage_text, 'en-US', currentQuestion.speed);
    } catch {
      /* ignore */
    }
    // Reset the playing state after a heuristic duration.
    const est = Math.max(
      3000,
      (session.passage_text.length / Math.max(0.5, currentQuestion.speed)) * 55,
    );
    setTimeout(() => setPlaying(false), est);
  }, [session, currentQuestion, tts]);

  const handleReveal = useCallback(() => {
    setPhase('quiz');
  }, []);

  const handleChoose = useCallback(async (idx: number) => {
    if (!session || !currentQuestion) return;
    setChosenIndex(idx);
    try {
      const resp = await answerSpeedLadder({
        session_id: session.session_id,
        question_id: currentQuestion.id,
        choice_index: idx,
        speed: currentQuestion.speed,
        correct_index: currentQuestion.correct_index,
        explanation: currentQuestion.explanation,
      });
      setLastCorrect(resp.correct);
      setResults((prev) => [
        ...prev,
        { speed: currentQuestion.speed, correct: resp.correct },
      ]);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save answer');
      setPhase('error');
    }
  }, [session, currentQuestion]);

  const handleNext = useCallback(() => {
    if (!session) return;
    const next = stepIndex + 1;
    if (next >= session.questions.length) {
      setPhase('summary');
    } else {
      setStepIndex(next);
      setChosenIndex(null);
      setLastCorrect(null);
      setPhase('listening');
    }
  }, [session, stepIndex]);

  const handleRestart = useCallback(() => {
    setSession(null);
    setResults([]);
    setStepIndex(0);
    setChosenIndex(null);
    setLastCorrect(null);
    setPhase('idle');
  }, []);

  useEffect(() => {
    return () => {
      try { tts.stop(); } catch { /* ignore */ }
    };
  }, [tts]);

  // Stop any speech on phase transitions.
  useEffect(() => {
    if (phase === 'summary' || phase === 'idle') {
      try { tts.stop(); } catch { /* ignore */ }
    }
  }, [phase, tts]);

  const summary = phase === 'summary' ? summarize(results) : null;

  return (
    <div className="speed-ladder-page" style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, color: 'var(--text-secondary)', textDecoration: 'none' }}>
        <ArrowLeft size={16} /> Home
      </Link>

      <h1 data-testid="speed-ladder-title" style={{ fontSize: 24, marginBottom: 8 }}>
        🐢🚶🏃 Listening Speed Ladder
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
        The same passage is played three times at 0.8×, 1.0×, and 1.25×.
        Answer one question after each playback.
      </p>

      {phase === 'idle' && (
        <div className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <button
            data-testid="speed-ladder-start"
            onClick={handleStart}
            style={{ padding: '10px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
          >
            Start drill
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="speed-ladder-loading">Loading passage…</div>
      )}

      {phase === 'error' && (
        <div style={{ color: 'var(--danger, #ef4444)' }} data-testid="speed-ladder-error">
          {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 12 }}>
            <button onClick={handleRestart}>Back</button>
          </div>
        </div>
      )}

      {phase === 'listening' && session && currentQuestion && (
        <div className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }} data-testid="speed-ladder-listen">
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Step {stepIndex + 1} of {session.questions.length}: {speedLabel(currentQuestion.speed)}
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Listen carefully — when ready, reveal the question.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handlePlay}
              data-testid="speed-ladder-play"
              disabled={playing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              <Play size={14} /> {playing ? 'Playing…' : 'Play'}
            </button>
            <button
              onClick={handleReveal}
              data-testid="speed-ladder-reveal"
              style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}
            >
              Reveal question
            </button>
          </div>
        </div>
      )}

      {phase === 'quiz' && currentQuestion && (
        <div className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }} data-testid="speed-ladder-quiz">
          <div style={{ fontSize: 15, marginBottom: 4, color: 'var(--text-secondary)' }}>
            {speedLabel(currentQuestion.speed)} — question {stepIndex + 1}
          </div>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{currentQuestion.prompt}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {currentQuestion.choices.map((choice, idx) => (
              <button
                key={idx}
                onClick={() => handleChoose(idx)}
                data-testid={`speed-ladder-choice-${idx}`}
                disabled={chosenIndex !== null}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {String.fromCharCode(65 + idx)}. {choice}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'feedback' && currentQuestion && (
        <div className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }} data-testid="speed-ladder-feedback">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {lastCorrect ? <Check size={18} color="#10b981" /> : <X size={18} color="#ef4444" />}
            <strong>{lastCorrect ? 'Correct!' : 'Not quite.'}</strong>
          </div>
          <div style={{ marginBottom: 8 }}>
            Correct answer: <strong>{String.fromCharCode(65 + currentQuestion.correct_index)}. {currentQuestion.choices[currentQuestion.correct_index]}</strong>
          </div>
          {currentQuestion.explanation && (
            <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>{currentQuestion.explanation}</div>
          )}
          <button
            onClick={handleNext}
            data-testid="speed-ladder-next"
            style={{ padding: '8px 14px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            {stepIndex + 1 >= (session?.questions.length ?? 0) ? 'See results' : 'Next speed'}
          </button>
        </div>
      )}

      {phase === 'summary' && summary && (
        <div className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }} data-testid="speed-ladder-summary">
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>Results</h2>
          <div style={{ fontSize: 16, marginBottom: 16 }}>
            {summary.totalCorrect} / {summary.total} correct
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {Object.entries(summary.accuracyBySpeed)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([k, acc]) => (
                <div key={k} data-testid={`speed-ladder-bar-${k}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80 }}>{speedLabel(Number(k))}</div>
                  <div style={{ flex: 1, background: 'var(--surface, #eee)', borderRadius: 6, height: 16, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.round(acc * 100)}%`,
                        height: '100%',
                        background: acc >= 0.999 ? '#10b981' : acc >= 0.5 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                  <div style={{ width: 48, textAlign: 'right' }}>{Math.round(acc * 100)}%</div>
                </div>
              ))}
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 16 }} data-testid="speed-ladder-recommendation">
            {summary.recommendation}
          </div>
          <button
            onClick={handleRestart}
            data-testid="speed-ladder-restart"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            <RotateCcw size={14} /> Try another
          </button>
        </div>
      )}
    </div>
  );
}

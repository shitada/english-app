import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ear, Volume2, RefreshCw, CheckCircle, XCircle, ArrowLeft, Gauge } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api, type MinimalPairListeningRound } from '../api';
import { pickRandomSet } from '../utils/minimalPairs';

const ROUNDS_PER_SESSION = 5;

interface RoundResult {
  round: MinimalPairListeningRound;
  chosen: 'a' | 'b';
  correct: boolean;
}

type Phase = 'loading' | 'idle' | 'answering' | 'feedback' | 'done' | 'error';

export default function MinimalPairs() {
  const tts = useSpeechSynthesis();
  const [contrast, setContrast] = useState<string>('');
  const [rounds, setRounds] = useState<MinimalPairListeningRound[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  const startSession = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    setCurrentIdx(0);
    setResults([]);
    try {
      const data = await api.startMinimalPairListening(ROUNDS_PER_SESSION);
      setContrast(data.contrast);
      setRounds(data.rounds);
      setPhase('idle');
    } catch {
      // Offline fallback — pick a curated set client-side
      const fallback = pickRandomSet();
      setContrast(fallback.contrast);
      const picks: MinimalPairListeningRound[] = [];
      const pool = [...fallback.pairs];
      for (let i = 0; i < ROUNDS_PER_SESSION; i++) {
        const p = pool[i % pool.length];
        picks.push({
          word_a: p.word_a, word_b: p.word_b,
          ipa_a: p.ipa_a, ipa_b: p.ipa_b,
          contrast: fallback.contrast,
          play: Math.random() < 0.5 ? 'a' : 'b',
        });
      }
      setRounds(picks);
      setPhase('idle');
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      startSession();
    }
  }, [startSession]);

  const currentRound = rounds[currentIdx] ?? null;

  const playWord = useCallback((slow: boolean = false) => {
    if (!currentRound) return;
    const word = currentRound.play === 'a' ? currentRound.word_a : currentRound.word_b;
    if (slow) {
      const prev = tts.rate;
      tts.setRate(0.7);
      tts.speak(word);
      // Restore after a short delay
      setTimeout(() => tts.setRate(prev), 100);
    } else {
      tts.speak(word);
    }
  }, [currentRound, tts]);

  const handleStartRound = useCallback(() => {
    playWord(false);
    setPhase('answering');
  }, [playWord]);

  const handleAnswer = useCallback((chosen: 'a' | 'b') => {
    if (!currentRound) return;
    const correct = chosen === currentRound.play;
    setResults(prev => [...prev, { round: currentRound, chosen, correct }]);
    setPhase('feedback');
  }, [currentRound]);

  const contrastSummary = useMemo(() => {
    const map = new Map<string, { correct: number; total: number }>();
    for (const r of results) {
      const c = r.round.contrast;
      const cur = map.get(c) ?? { correct: 0, total: 0 };
      cur.total += 1;
      if (r.correct) cur.correct += 1;
      map.set(c, cur);
    }
    return Array.from(map.entries()).map(([contrast, v]) => ({
      contrast, correct: v.correct, total: v.total,
    }));
  }, [results]);

  const finishSession = useCallback(async (allResults: RoundResult[]) => {
    setSaving(true);
    try {
      const correct = allResults.filter(r => r.correct).length;
      const total = allResults.length;
      const summary = new Map<string, { correct: number; total: number }>();
      for (const r of allResults) {
        const cur = summary.get(r.round.contrast) ?? { correct: 0, total: 0 };
        cur.total += 1;
        if (r.correct) cur.correct += 1;
        summary.set(r.round.contrast, cur);
      }
      const summaryArr = Array.from(summary.entries()).map(([c, v]) => ({
        contrast: c, correct: v.correct, total: v.total,
      }));
      await api.saveMinimalPairListeningResult(correct, total, summaryArr);
    } catch { /* ignore */ }
    finally {
      setSaving(false);
      setPhase('done');
    }
  }, []);

  const handleNext = useCallback(() => {
    const nextIdx = currentIdx + 1;
    if (nextIdx >= rounds.length) {
      void finishSession(results);
    } else {
      setCurrentIdx(nextIdx);
      setPhase('idle');
    }
  }, [currentIdx, rounds.length, results, finishSession]);

  const correctCount = results.filter(r => r.correct).length;
  const lastResult = results[results.length - 1];

  // Compute weakest contrast for results screen
  const weakestContrast = useMemo(() => {
    if (contrastSummary.length === 0) return null;
    return contrastSummary.reduce((a, b) => {
      const aRate = a.total > 0 ? a.correct / a.total : 1;
      const bRate = b.total > 0 ? b.correct / b.total : 1;
      return bRate < aRate ? b : a;
    });
  }, [contrastSummary]);

  if (!tts.isSupported) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Minimal Pairs</h2>
        <p>Your browser doesn't support speech synthesis. Try a recent Chrome or Safari.</p>
        <Link to="/">← Back home</Link>
      </div>
    );
  }

  return (
    <div data-testid="minimal-pairs-page" style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <Link
        to="/"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 12 }}
      >
        <ArrowLeft size={14} /> Back home
      </Link>

      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Ear size={24} color="#8b5cf6" />
          <h2 style={{ margin: 0, fontSize: 20 }}>Minimal Pairs</h2>
          {phase !== 'loading' && phase !== 'done' && (
            <span style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--text-secondary)' }}>
              {currentIdx + 1}/{rounds.length}
            </span>
          )}
        </div>
        <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: 14 }}>
          Train your ear to distinguish commonly confused English sounds.
          {contrast && <> Today: <strong style={{ color: 'var(--text)' }}>{contrast}</strong></>}
        </p>

        {phase === 'loading' && <p>Loading…</p>}

        {phase === 'error' && (
          <div>
            <p style={{ color: '#ef4444' }}>{errorMsg}</p>
            <button onClick={startSession} className="btn-primary">Retry</button>
          </div>
        )}

        {phase === 'idle' && currentRound && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p style={{ marginBottom: 16, fontSize: 15 }}>Listen carefully and choose the word you hear.</p>
            <button
              data-testid="play-sound-btn"
              onClick={handleStartRound}
              style={{
                padding: '12px 24px', border: 'none', borderRadius: 10,
                background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
                fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              <Volume2 size={18} /> Play Sound
            </button>
          </div>
        )}

        {phase === 'answering' && currentRound && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p style={{ marginBottom: 12, fontSize: 15 }}>Which word did you hear?</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {(['a', 'b'] as const).map(choice => (
                <button
                  key={choice}
                  data-testid={`choice-${choice}-btn`}
                  onClick={() => handleAnswer(choice)}
                  style={{
                    padding: '16px 32px', border: '2px solid var(--border)', borderRadius: 12,
                    background: 'var(--card-bg, white)', cursor: 'pointer',
                    fontSize: 20, fontWeight: 700, color: 'var(--text)', minWidth: 140,
                  }}
                >
                  {choice === 'a' ? currentRound.word_a : currentRound.word_b}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
              <button
                data-testid="replay-normal-btn"
                onClick={() => playWord(false)}
                style={{
                  padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 8,
                  background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Volume2 size={14} /> Replay
              </button>
              <button
                data-testid="replay-slow-btn"
                onClick={() => playWord(true)}
                style={{
                  padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 8,
                  background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Gauge size={14} /> Slow (0.7×)
              </button>
            </div>
          </div>
        )}

        {phase === 'feedback' && lastResult && currentRound && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{
              padding: '14px 18px', borderRadius: 10, marginBottom: 14,
              background: lastResult.correct ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            }}>
              {lastResult.correct ? (
                <p style={{ margin: 0, color: '#22c55e', fontWeight: 700, fontSize: 18 }}>
                  ✅ Correct!
                </p>
              ) : (
                <p style={{ margin: 0, color: '#ef4444', fontWeight: 700, fontSize: 18 }}>
                  ❌ It was "{lastResult.round.play === 'a' ? lastResult.round.word_a : lastResult.round.word_b}"
                </p>
              )}
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                <code>/{currentRound.ipa_a}/</code> vs <code>/{currentRound.ipa_b}/</code> · {currentRound.contrast}
              </p>
            </div>
            <button
              data-testid="next-round-btn"
              onClick={handleNext}
              style={{
                padding: '10px 20px', border: 'none', borderRadius: 10,
                background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
                fontSize: 15, fontWeight: 600,
              }}
            >
              {currentIdx + 1 >= rounds.length ? 'See Results' : 'Next Round'}
            </button>
          </div>
        )}

        {phase === 'done' && (
          <div data-testid="results-view" style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px' }}>
              {correctCount}/{results.length}
            </p>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
              {correctCount === results.length
                ? '🎯 Perfect ear!'
                : correctCount >= 3
                  ? '👍 Good listening!'
                  : '💪 Keep practicing!'}
            </p>

            {weakestContrast && weakestContrast.total > 0 && weakestContrast.correct < weakestContrast.total && (
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                Most struggled with: <strong>{weakestContrast.contrast}</strong>{' '}
                ({weakestContrast.correct}/{weakestContrast.total})
              </p>
            )}

            <div style={{ textAlign: 'left', maxWidth: 360, margin: '0 auto 16px' }}>
              {results.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                  fontSize: 14, color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border)',
                }}>
                  {r.correct ? <CheckCircle size={16} color="#22c55e" /> : <XCircle size={16} color="#ef4444" />}
                  <span>{r.round.word_a} vs {r.round.word_b}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>{r.round.contrast}</span>
                </div>
              ))}
            </div>

            <button
              data-testid="try-again-btn"
              onClick={startSession}
              disabled={saving}
              style={{
                padding: '10px 20px', border: 'none', borderRadius: 10,
                background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
                fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <RefreshCw size={16} /> Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

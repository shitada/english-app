import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import type { MinimalPairListeningRound } from '../api';
import { scoreSpeakAttempt, type SpeakAttemptScore } from '../utils/minimalPairs';

interface SpeakRoundResult {
  word_a: string;
  word_b: string;
  ipa_a: string;
  ipa_b: string;
  contrast: string;
  target: 'a' | 'b';
  attempts: number;
  firstTryCorrect: boolean;
  finalScore: SpeakAttemptScore;
}

interface Props {
  contrast: string;
  pairs: MinimalPairListeningRound[];
  onRestart: () => void;
}

const MAX_ATTEMPTS = 2;

export default function MinimalPairsSpeakMode({ contrast, pairs, onRestart }: Props) {
  const tts = useSpeechSynthesis();
  const asr = useSpeechRecognition({ lang: 'en-US', continuous: false, interimResults: false });

  const [currentIdx, setCurrentIdx] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [results, setResults] = useState<SpeakRoundResult[]>([]);
  const [lastScore, setLastScore] = useState<SpeakAttemptScore | null>(null);
  const [done, setDone] = useState(false);
  const [drillingMisses, setDrillingMisses] = useState(false);

  // Per-round randomized target ('a' or 'b'). Stable per round index.
  const targets = useMemo(
    () => pairs.map(() => (Math.random() < 0.5 ? 'a' : 'b') as 'a' | 'b'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pairs],
  );

  const round = pairs[currentIdx] ?? null;
  const target: 'a' | 'b' = targets[currentIdx] ?? 'a';
  const targetWord = round ? (target === 'a' ? round.word_a : round.word_b) : '';
  const otherWord  = round ? (target === 'a' ? round.word_b : round.word_a) : '';

  // Process incoming transcript.
  const lastProcessedTranscript = useRef('');
  useEffect(() => {
    if (!round) return;
    if (asr.isListening) return;
    const t = asr.transcript;
    if (!t || t === lastProcessedTranscript.current) return;
    lastProcessedTranscript.current = t;

    const score = scoreSpeakAttempt(t, targetWord, otherWord);
    setLastScore(score);
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    if (score === 'match' || newAttempts >= MAX_ATTEMPTS) {
      // Record the round result.
      setResults(prev => [
        ...prev,
        {
          word_a: round.word_a,
          word_b: round.word_b,
          ipa_a: round.ipa_a,
          ipa_b: round.ipa_b,
          contrast: round.contrast,
          target,
          attempts: newAttempts,
          firstTryCorrect: score === 'match' && newAttempts === 1,
          finalScore: score,
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asr.transcript, asr.isListening]);

  // Auto-advance + contrast playback after a recorded result.
  const playContrast = useCallback(() => {
    if (!round) return;
    // Play both words back-to-back at 0.85x.
    try {
      tts.speak(round.word_a, 'en-US', 0.85);
      // Small delay before second word.
      window.setTimeout(() => {
        tts.speak(round.word_b, 'en-US', 0.85);
      }, 850);
    } catch { /* ignore */ }
  }, [round, tts]);

  const advance = useCallback(() => {
    setLastScore(null);
    setAttempts(0);
    asr.reset();
    lastProcessedTranscript.current = '';
    const next = currentIdx + 1;
    if (next >= pairs.length) {
      setDone(true);
    } else {
      setCurrentIdx(next);
    }
  }, [asr, currentIdx, pairs.length]);

  // After a result is recorded for the current round, play contrast then advance.
  const lastResultsLen = useRef(0);
  useEffect(() => {
    if (results.length === lastResultsLen.current) return;
    lastResultsLen.current = results.length;
    playContrast();
    const handle = window.setTimeout(() => advance(), 2200);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  const handleMic = useCallback(() => {
    if (asr.isListening) {
      asr.stop();
      return;
    }
    asr.reset();
    lastProcessedTranscript.current = '';
    setLastScore(null);
    asr.start();
  }, [asr]);

  const handlePlayWord = useCallback((which: 'a' | 'b') => {
    if (!round) return;
    const w = which === 'a' ? round.word_a : round.word_b;
    tts.speak(w, 'en-US', 0.9);
  }, [round, tts]);

  // ---- Drill the misses ----
  const handleDrillMisses = useCallback(() => {
    const misses = results.filter(r => !r.firstTryCorrect);
    if (misses.length === 0) return;
    // Replay only failed pairs in a fresh sub-session by calling onRestart on
    // the parent? We can't re-seed the parent's pairs, so locally re-run them.
    // Easiest UX: reset internal state to use only the missed rounds.
    const missedPairs: MinimalPairListeningRound[] = misses.map(m => ({
      word_a: m.word_a,
      word_b: m.word_b,
      ipa_a: m.ipa_a,
      ipa_b: m.ipa_b,
      contrast: m.contrast,
      play: m.target,
    }));
    // Hack: mutate by replacing the underlying pairs reference is not possible;
    // instead surface a local mode that filters subsequent rounds.
    setDrillingMisses(true);
    setResults([]);
    setCurrentIdx(0);
    setAttempts(0);
    setLastScore(null);
    setDone(false);
    asr.reset();
    lastProcessedTranscript.current = '';
    // We can't change `pairs` prop here, but we *can* keep state for filtered
    // rendering using a ref override. Use a window event hook? Simpler: stash
    // misses in a ref-backed state and override `pairs` inside this component.
    drillMissesRef.current = missedPairs;
  }, [results, asr]);

  const drillMissesRef = useRef<MinimalPairListeningRound[] | null>(null);

  // If drilling misses, override `pairs` with the stashed list.
  const effectivePairs: MinimalPairListeningRound[] = drillingMisses && drillMissesRef.current
    ? drillMissesRef.current
    : pairs;
  const effectiveTargets = useMemo(() => {
    if (drillingMisses && drillMissesRef.current) {
      return drillMissesRef.current.map(p => (p.play === 'a' ? 'a' : 'b') as 'a' | 'b');
    }
    return targets;
  }, [drillingMisses, targets]);
  const effectiveRound = effectivePairs[currentIdx] ?? null;
  const effectiveTarget: 'a' | 'b' = effectiveTargets[currentIdx] ?? 'a';
  const effectiveTargetWord = effectiveRound
    ? (effectiveTarget === 'a' ? effectiveRound.word_a : effectiveRound.word_b)
    : '';
  const effectiveOtherWord = effectiveRound
    ? (effectiveTarget === 'a' ? effectiveRound.word_b : effectiveRound.word_a)
    : '';

  // ---- Results ----
  const total = results.length;
  const firstTryCorrect = results.filter(r => r.firstTryCorrect).length;
  const accuracyPct = total > 0 ? (firstTryCorrect / total) * 100 : 0;
  const stars = accuracyPct >= 100 ? 3 : accuracyPct >= 90 ? 2 : accuracyPct >= 80 ? 1 : 0;

  // Per-pair summary for results card.
  const pairSummary = useMemo(() => {
    const map = new Map<string, { label: string; correct: number; total: number }>();
    for (const r of results) {
      const key = `${r.word_a}|${r.word_b}`;
      const cur = map.get(key) ?? { label: `${r.word_a} vs ${r.word_b}`, correct: 0, total: 0 };
      cur.total += 1;
      if (r.firstTryCorrect) cur.correct += 1;
      map.set(key, cur);
    }
    return Array.from(map.values());
  }, [results]);

  // ---- Render ----
  if (!asr.isSupported) {
    return (
      <div
        role="alert"
        style={{
          padding: '12px 14px',
          borderRadius: 10,
          background: 'rgba(239,68,68,0.1)',
          color: 'var(--danger, #ef4444)',
          fontSize: 14,
        }}
      >
        🎤 Speech recognition is not supported in this browser — switch to Listen mode.
      </div>
    );
  }

  if (done) {
    return (
      <div data-testid="speak-results-view" style={{ textAlign: 'center', padding: '1rem 0' }}>
        <p style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>
          {firstTryCorrect}/{total} first-try
        </p>
        <p style={{ fontSize: 22, margin: '0 0 4px' }} aria-label={`${stars} stars out of 3`}>
          {stars > 0 ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆'}
        </p>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          {contrast} contrast
        </p>

        <div style={{ textAlign: 'left', maxWidth: 360, margin: '0 auto 16px' }}>
          {pairSummary.map((p, i) => {
            const acc = p.total > 0 ? Math.round((p.correct / p.total) * 100) : 0;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                fontSize: 14, color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border)',
              }}>
                {p.correct === p.total
                  ? <CheckCircle size={16} color="#22c55e" />
                  : <XCircle size={16} color="#ef4444" />}
                <span>{p.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8 }}>{acc}%</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {results.some(r => !r.firstTryCorrect) && (
            <button
              data-testid="drill-misses-btn"
              onClick={handleDrillMisses}
              style={{
                padding: '10px 18px', border: '1px solid var(--border)', borderRadius: 10,
                background: 'transparent', color: 'var(--text-primary, var(--text))',
                cursor: 'pointer', fontSize: 14, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <RefreshCw size={14} /> Drill the misses
            </button>
          )}
          <button
            data-testid="speak-restart-btn"
            onClick={() => {
              setResults([]);
              setCurrentIdx(0);
              setAttempts(0);
              setLastScore(null);
              setDone(false);
              setDrillingMisses(false);
              drillMissesRef.current = null;
              asr.reset();
              lastProcessedTranscript.current = '';
              onRestart();
            }}
            style={{
              padding: '10px 20px', border: 'none', borderRadius: 10,
              background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
              fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <RefreshCw size={16} /> New Session
          </button>
        </div>
      </div>
    );
  }

  if (!effectiveRound) {
    return <p>Loading…</p>;
  }

  const feedbackForScore = (s: SpeakAttemptScore | null) => {
    if (s === null) return null;
    if (s === 'match') {
      return {
        text: '✅ Clear contrast!',
        color: 'var(--success, #22c55e)',
        bg: 'rgba(34,197,94,0.1)',
        Icon: CheckCircle,
      };
    }
    if (s === 'confused') {
      return {
        text: `❌ Sounded like "${effectiveOtherWord}" — try again`,
        color: 'var(--danger, #ef4444)',
        bg: 'rgba(239,68,68,0.1)',
        Icon: XCircle,
      };
    }
    return {
      text: '⚠️ Couldn\'t catch that, retry',
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.1)',
      Icon: AlertTriangle,
    };
  };
  const fb = feedbackForScore(lastScore);
  const finishedThisRound = lastScore === 'match' || attempts >= MAX_ATTEMPTS;

  return (
    <div data-testid="speak-mode" style={{ padding: '0.5rem 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
        Round {currentIdx + 1}/{effectivePairs.length}
        {drillingMisses && <span style={{ marginLeft: 8 }}>(drilling misses)</span>}
      </div>

      {/* Word pair display */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16 }}>
        {(['a', 'b'] as const).map(w => {
          const word = w === 'a' ? effectiveRound.word_a : effectiveRound.word_b;
          const ipa  = w === 'a' ? effectiveRound.ipa_a  : effectiveRound.ipa_b;
          const isTarget = w === effectiveTarget;
          return (
            <div
              key={w}
              data-testid={`speak-word-${w}`}
              style={{
                flex: '1 1 140px', maxWidth: 200,
                padding: '12px 10px', borderRadius: 12,
                border: isTarget ? '2px solid var(--primary, #3b82f6)' : '2px solid var(--border)',
                background: 'var(--bg-secondary, var(--card-bg, white))',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary, var(--text))' }}>
                {word}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 6px' }}>
                /{ipa}/
              </div>
              <button
                data-testid={`speak-tts-${w}-btn`}
                aria-label={`Listen to "${word}"`}
                onClick={() => handlePlayWord(w)}
                style={{
                  padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  background: 'transparent', cursor: 'pointer', fontSize: 12,
                  color: 'var(--text-secondary)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Volume2 size={12} /> Play
              </button>
            </div>
          );
        })}
      </div>

      {/* Target prompt */}
      <div
        aria-live="polite"
        data-testid="speak-target-prompt"
        style={{
          textAlign: 'center', marginBottom: 14, fontSize: 16,
          color: 'var(--text-primary, var(--text))',
        }}
      >
        Say:{' '}
        <strong style={{ fontSize: 22, color: 'var(--primary, #3b82f6)' }}>
          {effectiveTargetWord.toUpperCase()}
        </strong>{' '}
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          (not {effectiveOtherWord})
        </span>
      </div>

      {/* Mic button */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <button
          data-testid="speak-mic-btn"
          aria-label={`Record pronunciation of ${effectiveTargetWord}`}
          onClick={handleMic}
          disabled={finishedThisRound}
          style={{
            padding: '14px 22px', borderRadius: 999, border: 'none',
            background: asr.isListening
              ? 'var(--danger, #ef4444)'
              : 'var(--primary, #3b82f6)',
            color: 'white', cursor: finishedThisRound ? 'not-allowed' : 'pointer',
            opacity: finishedThisRound ? 0.6 : 1,
            fontSize: 16, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          {asr.isListening ? <MicOff size={18} /> : <Mic size={18} />}
          {asr.isListening ? 'Listening…' : 'Tap to speak'}
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
          Attempt {Math.min(attempts + (finishedThisRound ? 0 : 1), MAX_ATTEMPTS)}/{MAX_ATTEMPTS}
        </div>
      </div>

      {/* Transcript / feedback */}
      {asr.transcript && (
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Heard: <em>"{asr.transcript.trim()}"</em>
        </div>
      )}

      {fb && (
        <div
          data-testid="speak-feedback"
          style={{
            padding: '10px 14px', borderRadius: 10,
            background: fb.bg, color: fb.color,
            fontWeight: 600, fontSize: 15, textAlign: 'center',
          }}
        >
          {fb.text}
        </div>
      )}

      {asr.error && !asr.isListening && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #ef4444)', textAlign: 'center' }}>
          {asr.error}
        </div>
      )}
    </div>
  );
}

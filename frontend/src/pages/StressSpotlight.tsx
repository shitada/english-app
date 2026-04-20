import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, RefreshCw, Volume2 } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  generateStressSpotlight,
  getStressSpotlightAudio,
  submitStressSpotlightAttempt,
  getStressSpotlightRecent,
  type StressSpotlightItem,
  type StressSpotlightRecentEntry,
} from '../api';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

type Phase = 'loading' | 'tapping' | 'revealed' | 'recording' | 'error';

export function precisionRecallF1(
  expected: number[],
  picked: number[]
): { precision: number; recall: number; f1: number } {
  const e = new Set(expected);
  const p = new Set(picked);
  if (e.size === 0 && p.size === 0) return { precision: 100, recall: 100, f1: 100 };
  if (p.size === 0) return { precision: 100, recall: 0, f1: 0 };
  if (e.size === 0) return { precision: 0, recall: 100, f1: 0 };
  let tp = 0;
  for (const i of p) if (e.has(i)) tp++;
  const precision = (100 * tp) / p.size;
  const recall = (100 * tp) / e.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    precision: Math.round(precision * 10) / 10,
    recall: Math.round(recall * 10) / 10,
    f1: Math.round(f1 * 10) / 10,
  };
}

function chipColor(
  isExpected: boolean,
  isPicked: boolean,
  revealed: boolean
): { bg: string; border: string; color: string } {
  if (!revealed) {
    if (isPicked) return { bg: '#dbeafe', border: '#3b82f6', color: '#1e40af' };
    return { bg: 'var(--bg-secondary, #f3f4f6)', border: 'var(--border, #d1d5db)', color: 'inherit' };
  }
  // Revealed:
  if (isPicked && isExpected) return { bg: '#dcfce7', border: '#16a34a', color: '#15803d' }; // green TP
  if (isPicked && !isExpected) return { bg: '#fee2e2', border: '#dc2626', color: '#b91c1c' }; // red FP
  if (!isPicked && isExpected) return { bg: '#fef3c7', border: '#d97706', color: '#a16207' }; // amber missed
  return { bg: 'var(--bg-secondary, #f3f4f6)', border: 'var(--border, #d1d5db)', color: 'inherit' };
}

export default function StressSpotlight() {
  const tts = useSpeechSynthesis();
  const recog = useSpeechRecognition({ lang: 'en-US', continuous: false, interimResults: true });

  const [item, setItem] = useState<StressSpotlightItem | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [scores, setScores] = useState<{ precision: number; recall: number; f1: number } | null>(null);
  const [shadowTranscript, setShadowTranscript] = useState('');
  const [recent, setRecent] = useState<StressSpotlightRecentEntry[]>([]);
  const initialized = useRef(false);

  const refreshRecent = useCallback(async () => {
    try {
      const r = await getStressSpotlightRecent(10);
      setRecent(r.items);
    } catch {
      /* best effort */
    }
  }, []);

  const loadItem = useCallback(
    async (diff: Difficulty) => {
      setPhase('loading');
      setErrorMsg('');
      setPicked(new Set());
      setScores(null);
      setShadowTranscript('');
      recog.reset();
      try {
        const it = await generateStressSpotlight(diff);
        setItem(it);
        setPhase('tapping');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load sentence.');
        setPhase('error');
      }
    },
    [recog]
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadItem(difficulty);
    refreshRecent();
  }, [difficulty, loadItem, refreshRecent]);

  const togglePick = (idx: number) => {
    if (phase !== 'tapping') return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const onReveal = useCallback(async () => {
    if (!item) return;
    const pickedArr = Array.from(picked).sort((a, b) => a - b);
    const local = precisionRecallF1(item.stressed_indices, pickedArr);
    setScores(local);
    setPhase('revealed');
    try {
      await submitStressSpotlightAttempt({
        sentence: item.sentence,
        words: item.words,
        expected_indices: item.stressed_indices,
        user_indices: pickedArr,
        difficulty: item.difficulty,
      });
      refreshRecent();
    } catch {
      /* best effort */
    }
  }, [item, picked, refreshRecent]);

  const onListenWithStress = useCallback(async () => {
    if (!item) return;
    try {
      const data = await getStressSpotlightAudio(item.sentence, item.stressed_indices);
      // Browser SpeechSynthesis ignores SSML — use the capitalization fallback,
      // which the browser will naturally emphasize via prosody on caps tokens
      // (and at minimum is a clearly different perception cue when read).
      tts.speak(data.fallback_text, 'en-US', 0.9);
    } catch {
      tts.speak(item.sentence, 'en-US', 0.9);
    }
  }, [item, tts]);

  const onShadow = useCallback(() => {
    if (!recog.isSupported) {
      setErrorMsg('Speech recognition is not supported in this browser.');
      return;
    }
    setShadowTranscript('');
    recog.reset();
    recog.start();
    setPhase('recording');
  }, [recog]);

  const onStopShadow = useCallback(() => {
    recog.stop();
    setShadowTranscript(recog.transcript);
    setPhase('revealed');
  }, [recog]);

  const onNext = () => loadItem(difficulty);

  const revealed = phase === 'revealed' || phase === 'recording';

  return (
    <div data-testid="stress-spotlight-page" style={{ maxWidth: 760, margin: '0 auto', padding: '1rem' }}>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', textDecoration: 'none', fontSize: 13 }}>
        <ArrowLeft size={14} /> Home
      </Link>
      <h1 style={{ marginTop: '0.5rem' }}>Stress Spotlight</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, fontSize: 14 }}>
        Tap the words you think carry primary sentence stress. Reveal to score
        your guesses, then listen with stress and shadow yourself.
      </p>

      {/* Difficulty picker */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map((d) => (
          <button
            key={d}
            data-testid={`ss-diff-${d}`}
            aria-pressed={difficulty === d}
            onClick={() => {
              setDifficulty(d);
              loadItem(d);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: difficulty === d ? 'var(--primary, #3b82f6)' : 'transparent',
              color: difficulty === d ? 'white' : 'inherit',
              cursor: 'pointer',
              fontSize: 13,
              textTransform: 'capitalize',
            }}
          >
            {d}
          </button>
        ))}
      </div>

      {phase === 'loading' && <div data-testid="ss-loading">Loading…</div>}
      {phase === 'error' && (
        <div data-testid="ss-error" role="alert" style={{ color: '#dc2626', padding: 12, border: '1px solid #fecaca', borderRadius: 8 }}>
          {errorMsg}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => loadItem(difficulty)} style={{ padding: '6px 12px' }}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      )}

      {item && phase !== 'loading' && phase !== 'error' && (
        <div className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          {/* Word chips */}
          <div data-testid="ss-words" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {item.words.map((w, idx) => {
              const isExpected = item.stressed_indices.includes(idx);
              const isPicked = picked.has(idx);
              const c = chipColor(isExpected, isPicked, revealed);
              return (
                <button
                  key={idx}
                  data-testid={`ss-chip-${idx}`}
                  data-picked={isPicked ? 'true' : 'false'}
                  data-expected={isExpected ? 'true' : 'false'}
                  onClick={() => togglePick(idx)}
                  disabled={revealed}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `2px solid ${c.border}`,
                    background: c.bg,
                    color: c.color,
                    cursor: revealed ? 'default' : 'pointer',
                    fontSize: 16,
                    fontWeight: isPicked || (revealed && isExpected) ? 600 : 400,
                  }}
                >
                  {w}
                </button>
              );
            })}
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {!revealed && (
              <button
                data-testid="ss-reveal"
                onClick={onReveal}
                disabled={picked.size === 0}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: 'var(--primary, #3b82f6)',
                  color: 'white',
                  border: 'none',
                  cursor: picked.size === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: picked.size === 0 ? 0.5 : 1,
                }}
              >
                Reveal
              </button>
            )}
            {revealed && (
              <>
                <button
                  data-testid="ss-listen-stress"
                  onClick={onListenWithStress}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Volume2 size={16} /> Listen with stress
                </button>
                {phase !== 'recording' ? (
                  <button
                    data-testid="ss-shadow"
                    onClick={onShadow}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Mic size={16} /> Shadow record
                  </button>
                ) : (
                  <button
                    data-testid="ss-stop"
                    onClick={onStopShadow}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    Stop
                  </button>
                )}
                <button
                  data-testid="ss-next"
                  onClick={onNext}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: 'transparent',
                    color: 'inherit',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  Next
                </button>
              </>
            )}
          </div>

          {/* Scores + rationale */}
          {revealed && scores && (
            <div data-testid="ss-scores" style={{ marginTop: 16, padding: 12, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, fontSize: 14 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                <span data-testid="ss-precision"><strong>Precision:</strong> {scores.precision}%</span>
                <span data-testid="ss-recall"><strong>Recall:</strong> {scores.recall}%</span>
                <span data-testid="ss-f1"><strong>F1:</strong> {scores.f1}%</span>
              </div>
              <div data-testid="ss-rationale" style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                {item.rationale}
              </div>
              {phase === 'recording' && (
                <div data-testid="ss-recording-indicator" style={{ marginTop: 8, color: '#dc2626' }}>
                  ● Recording…
                </div>
              )}
              {shadowTranscript && (
                <div data-testid="ss-transcript" style={{ marginTop: 8 }}>
                  <strong>You said:</strong> {shadowTranscript}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div data-testid="ss-recent" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Recent attempts</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recent.slice(0, 10).map((r) => (
              <li
                key={r.id}
                style={{
                  padding: 8,
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.sentence}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  F1 {r.f1_score}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

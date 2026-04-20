import { useState, useCallback, useEffect, useRef } from 'react';
import { Volume2, Mic, RefreshCw } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api } from '../api';

// ─── Pure helpers ───────────────────────────────────────────────────────────

export type PaceTarget = 'slow' | 'natural' | 'fast';

export const TARGET_KEY = 'quick-pace-match-target';
export const TOLERANCE_WPM = 15;
export const MAX_HISTORY = 5;

export interface PaceTargetDef {
  key: PaceTarget;
  label: string;
  emoji: string;
  wpm: number;
  ttsRate: number;
}

export const PACE_TARGETS: PaceTargetDef[] = [
  { key: 'slow', label: 'Slow', emoji: '🐢', wpm: 110, ttsRate: 0.8 },
  { key: 'natural', label: 'Natural', emoji: '🚶', wpm: 150, ttsRate: 1.0 },
  { key: 'fast', label: 'Fast', emoji: '⚡', wpm: 180, ttsRate: 1.2 },
];

export function getPaceTargetDef(key: PaceTarget): PaceTargetDef {
  return PACE_TARGETS.find(t => t.key === key) || PACE_TARGETS[1];
}

export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

export function computeAccuracy(reference: string, spoken: string): number {
  const refWords = normalizeText(reference).split(' ').filter(Boolean);
  const spokenWords = normalizeText(spoken).split(' ').filter(Boolean);
  if (refWords.length === 0) return 0;
  let matched = 0;
  for (const rw of refWords) {
    if (spokenWords.includes(rw)) matched++;
  }
  return Math.round((matched / refWords.length) * 100);
}

export function countSpokenWords(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function computeWpm(wordCount: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || wordCount <= 0) return 0;
  const seconds = elapsedMs / 1000;
  return Math.round((wordCount / seconds) * 60);
}

export type TempoVerdict = 'on_pace' | 'too_fast' | 'too_slow';

export interface TempoEvaluation {
  verdict: TempoVerdict;
  delta: number; // signed: spoken - target
  label: string;
}

export function evaluateTempo(
  spokenWpm: number,
  targetWpm: number,
  tolerance: number = TOLERANCE_WPM,
): TempoEvaluation {
  const delta = spokenWpm - targetWpm;
  if (Math.abs(delta) <= tolerance) {
    return { verdict: 'on_pace', delta, label: 'on pace ✓' };
  }
  if (delta > 0) {
    return { verdict: 'too_fast', delta, label: `+${delta} WPM — too fast` };
  }
  return { verdict: 'too_slow', delta, label: `${delta} WPM — too slow` };
}

/** Map a WPM value to a 0-100 % position on a gauge spanning [min..max] WPM. */
export function wpmToGaugePercent(wpm: number, min = 60, max = 230): number {
  if (max <= min) return 0;
  const clamped = Math.max(min, Math.min(max, wpm));
  return Math.round(((clamped - min) / (max - min)) * 100);
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ShadowSentence {
  text: string;
  topic: string;
}

function pickSentence(
  sentences: { text: string; topic: string }[],
  rng: () => number = Math.random,
): ShadowSentence | null {
  const eligible = sentences.filter(s => {
    const wc = countSpokenWords(s.text);
    return wc >= 10 && wc <= 18;
  });
  const pool = eligible.length > 0 ? eligible : sentences;
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

export default function QuickPaceMatchCard() {
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [target, setTarget] = useState<PaceTarget>(() => {
    try {
      const saved = localStorage.getItem(TARGET_KEY) as PaceTarget | null;
      if (saved && PACE_TARGETS.some(t => t.key === saved)) return saved;
    } catch { /* ignore */ }
    return 'natural';
  });

  const [sentence, setSentence] = useState<ShadowSentence | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'done'>('idle');
  const [spokenWpm, setSpokenWpm] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [initialized, setInitialized] = useState(false);
  const startTimeRef = useRef<number>(0);
  const wasListeningRef = useRef(false);

  const targetDef = getPaceTargetDef(target);

  const handleTargetChange = useCallback((t: PaceTarget) => {
    setTarget(t);
    try { localStorage.setItem(TARGET_KEY, t); } catch { /* ignore */ }
  }, []);

  const loadSentence = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = (() => {
        try {
          const d = localStorage.getItem('quick-practice-difficulty');
          if (d === 'beginner' || d === 'intermediate' || d === 'advanced') return d;
        } catch { /* ignore */ }
        return 'intermediate';
      })();
      const data = await api.getPronunciationSentences(difficulty as any);
      const picked = pickSentence(data.sentences || []);
      if (picked) {
        setSentence(picked);
        setPhase('idle');
        setSpokenWpm(0);
        setAccuracy(0);
        setInitialized(true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // React to difficulty changes from the Hub.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        loadSentence();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [loadSentence]);

  // When user stops speaking, compute WPM + accuracy.
  useEffect(() => {
    if (
      wasListeningRef.current &&
      !speech.isListening &&
      sentence &&
      phase === 'listening'
    ) {
      const elapsed = Date.now() - startTimeRef.current;
      const wc = countSpokenWords(speech.transcript);
      const wpm = computeWpm(wc, elapsed);
      const acc = computeAccuracy(sentence.text, speech.transcript);
      setSpokenWpm(wpm);
      setAccuracy(acc);
      if (wpm > 0) {
        setHistory(prev => {
          const next = [...prev, wpm];
          return next.slice(-MAX_HISTORY);
        });
      }
      setPhase('done');
    }
    wasListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, sentence, phase]);

  if (!tts.isSupported || !speech.isSupported) return null;

  const handleListen = useCallback(() => {
    if (!sentence) return;
    tts.speak(sentence.text, 'en-US', targetDef.ttsRate);
  }, [sentence, tts, targetDef.ttsRate]);

  const handleRecord = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
      return;
    }
    speech.reset();
    setPhase('listening');
    setSpokenWpm(0);
    setAccuracy(0);
    startTimeRef.current = Date.now();
    speech.start();
  }, [speech]);

  const handleTryAgain = useCallback(() => {
    setPhase('idle');
    setSpokenWpm(0);
    setAccuracy(0);
    speech.reset();
  }, [speech]);

  const evaluation = phase === 'done' && spokenWpm > 0
    ? evaluateTempo(spokenWpm, targetDef.wpm)
    : null;

  const verdictColor = !evaluation
    ? 'var(--text-secondary)'
    : evaluation.verdict === 'on_pace' ? '#22c55e'
      : evaluation.verdict === 'too_fast' ? '#f59e0b'
        : '#3b82f6';

  // Gauge geometry
  const GAUGE_MIN = 60;
  const GAUGE_MAX = 230;
  const bandLeftPct = wpmToGaugePercent(targetDef.wpm - TOLERANCE_WPM, GAUGE_MIN, GAUGE_MAX);
  const bandRightPct = wpmToGaugePercent(targetDef.wpm + TOLERANCE_WPM, GAUGE_MIN, GAUGE_MAX);
  const markerPct = wpmToGaugePercent(spokenWpm || 0, GAUGE_MIN, GAUGE_MAX);

  return (
    <div
      data-testid="quick-pace-match-card"
      style={{
        background: 'var(--card-bg, white)',
        borderRadius: 16,
        padding: 20,
        border: '1px solid var(--border)',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '1.3rem' }}>🎯</span>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Pace Match</h3>
      </div>

      <p style={{
        margin: '0 0 12px',
        color: 'var(--text-secondary)',
        fontSize: '0.85rem',
      }}>
        Pick a target pace, listen, then shadow at that tempo.
      </p>

      {/* Target picker */}
      <div
        role="radiogroup"
        aria-label="Pace target"
        data-testid="qpm-targets"
        style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}
      >
        {PACE_TARGETS.map(t => {
          const isActive = target === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-testid={`qpm-target-${t.key}`}
              onClick={() => handleTargetChange(t.key)}
              style={{
                flex: '1 1 auto',
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid',
                borderColor: isActive ? 'var(--primary, #3b82f6)' : 'var(--border, #d1d5db)',
                background: isActive ? 'var(--primary, #3b82f6)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: isActive ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {t.emoji} {t.label} · {t.wpm} WPM
            </button>
          );
        })}
      </div>

      {!initialized ? (
        <div style={{ textAlign: 'center' }}>
          <button
            data-testid="qpm-start"
            onClick={loadSentence}
            disabled={loading}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              cursor: 'pointer',
              border: 'none',
              background: 'var(--primary)',
              color: 'white',
              fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Loading...' : 'Start Practice'}
          </button>
        </div>
      ) : sentence ? (
        <div>
          <p style={{
            fontSize: '1.05rem',
            lineHeight: 1.5,
            marginBottom: 12,
            color: 'var(--text)',
            fontStyle: 'italic',
          }}>
            "{sentence.text}"
            <span style={{
              marginLeft: 8,
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              fontStyle: 'normal',
            }}>
              ({countSpokenWords(sentence.text)} words)
            </span>
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button
              data-testid="qpm-listen"
              onClick={handleListen}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
              }}
            >
              <Volume2 size={16} /> Listen ({targetDef.ttsRate}×)
            </button>

            <button
              data-testid="qpm-record"
              onClick={handleRecord}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: 'none',
                background: speech.isListening ? '#ef4444' : 'var(--primary)',
                color: 'white', fontSize: '0.9rem', fontWeight: 600,
              }}
            >
              <Mic size={16} /> {speech.isListening ? 'Stop' : 'Speak'}
            </button>

            {phase === 'done' && (
              <button
                data-testid="qpm-try-again"
                onClick={handleTryAgain}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
                }}
              >
                Try Again
              </button>
            )}

            <button
              data-testid="qpm-new-sentence"
              onClick={loadSentence}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
              }}
            >
              <RefreshCw size={16} /> New Sentence
            </button>
          </div>

          {speech.isListening && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
              🎙️ Listening... {speech.interimTranscript || speech.transcript || ''}
            </p>
          )}

          {/* Tempo gauge */}
          <div data-testid="qpm-gauge-wrap" style={{ marginTop: 8 }}>
            {/* History dots */}
            <div
              data-testid="qpm-history"
              style={{ position: 'relative', height: 14, marginBottom: 4 }}
            >
              {history.map((h, i) => {
                const pct = wpmToGaugePercent(h, GAUGE_MIN, GAUGE_MAX);
                return (
                  <span
                    key={i}
                    data-testid={`qpm-history-dot-${i}`}
                    title={`${h} WPM`}
                    style={{
                      position: 'absolute',
                      left: `calc(${pct}% - 4px)`,
                      top: 4,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--text-secondary, #9ca3af)',
                      opacity: 0.4 + 0.6 * ((i + 1) / Math.max(history.length, 1)),
                    }}
                  />
                );
              })}
            </div>

            <div
              data-testid="qpm-gauge"
              style={{
                position: 'relative',
                height: 18,
                background: 'var(--bg, #f3f4f6)',
                borderRadius: 9,
                border: '1px solid var(--border)',
              }}
            >
              {/* Target band */}
              <div
                data-testid="qpm-band"
                style={{
                  position: 'absolute',
                  left: `${bandLeftPct}%`,
                  width: `${Math.max(0, bandRightPct - bandLeftPct)}%`,
                  top: 0,
                  bottom: 0,
                  background: 'rgba(34, 197, 94, 0.25)',
                  borderLeft: '1px dashed #22c55e',
                  borderRight: '1px dashed #22c55e',
                }}
              />
              {/* Target tick */}
              <div
                style={{
                  position: 'absolute',
                  left: `calc(${wpmToGaugePercent(targetDef.wpm, GAUGE_MIN, GAUGE_MAX)}% - 1px)`,
                  top: -2,
                  bottom: -2,
                  width: 2,
                  background: '#22c55e',
                }}
              />
              {/* User marker */}
              {phase === 'done' && spokenWpm > 0 && (
                <div
                  data-testid="qpm-marker"
                  style={{
                    position: 'absolute',
                    left: `calc(${markerPct}% - 6px)`,
                    top: -3,
                    width: 12,
                    height: 24,
                    borderRadius: 4,
                    background: verdictColor,
                    border: '2px solid var(--card-bg, white)',
                  }}
                />
              )}
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: 'var(--text-secondary)',
              marginTop: 2,
            }}>
              <span>{GAUGE_MIN}</span>
              <span>Target {targetDef.wpm} WPM</span>
              <span>{GAUGE_MAX}</span>
            </div>
          </div>

          {phase === 'done' && (
            <div
              data-testid="qpm-result"
              style={{
                padding: 12,
                borderRadius: 8,
                marginTop: 10,
                background: 'var(--bg, #f9fafb)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 700, color: verdictColor }}>
                  {spokenWpm} WPM
                </span>
                {evaluation && (
                  <span
                    data-testid="qpm-delta-badge"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: verdictColor,
                      color: 'white',
                    }}
                  >
                    {evaluation.label}
                  </span>
                )}
                <span
                  data-testid="qpm-accuracy"
                  style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}
                >
                  Accuracy: {accuracy}%
                </span>
              </div>
              {speech.transcript && (
                <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  You said: "{speech.transcript}"
                </p>
              )}
              {accuracy < 50 && spokenWpm > 0 && (
                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#ef4444' }}>
                  ⚠️ Low word match — try not to game the meter; speak the actual sentence.
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

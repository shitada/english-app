import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Pause, Play, SkipForward, X, Flame } from 'lucide-react';

export const DEFAULT_WARMUP_SENTENCES: string[] = [
  'Hello! How are you doing today?',
  'I would like a cup of coffee, please.',
  'Could you tell me where the station is?',
  'The weather is really nice this afternoon.',
  'I am looking forward to the weekend.',
  'Thank you so much for your help.',
];

export const WARMUP_TARGET = 6;
export const WARMUP_STORAGE_KEY = 'listeningWarmup';

export interface WarmupState {
  lastWarmupAt: string | null; // YYYY-MM-DD
  warmupStreak: number;
}

export function todayKey(d: Date = new Date()): string {
  // Local date YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the new warmup streak.
 * - If lastDate is today: no-op (return prevStreak, min 1).
 * - If lastDate is yesterday: prevStreak + 1.
 * - If lastDate is older or null: reset to 1.
 */
export function computeWarmupStreak(
  prevStreak: number,
  lastDateIso: string | null,
  todayIso: string,
): number {
  if (!lastDateIso) return 1;
  if (lastDateIso === todayIso) return Math.max(prevStreak, 1);
  const today = new Date(todayIso + 'T00:00:00');
  const last = new Date(lastDateIso + 'T00:00:00');
  if (Number.isNaN(today.getTime()) || Number.isNaN(last.getTime())) return 1;
  const diffDays = Math.round((today.getTime() - last.getTime()) / 86400000);
  if (diffDays === 1) return prevStreak + 1;
  if (diffDays <= 0) return Math.max(prevStreak, 1);
  return 1;
}

export function readWarmupState(): WarmupState {
  if (typeof localStorage === 'undefined') {
    return { lastWarmupAt: null, warmupStreak: 0 };
  }
  try {
    const raw = localStorage.getItem(WARMUP_STORAGE_KEY);
    if (!raw) return { lastWarmupAt: null, warmupStreak: 0 };
    const parsed = JSON.parse(raw);
    return {
      lastWarmupAt:
        typeof parsed.lastWarmupAt === 'string' ? parsed.lastWarmupAt : null,
      warmupStreak:
        typeof parsed.warmupStreak === 'number' && parsed.warmupStreak >= 0
          ? parsed.warmupStreak
          : 0,
    };
  } catch {
    return { lastWarmupAt: null, warmupStreak: 0 };
  }
}

export function persistWarmupCompletion(today: string = todayKey()): WarmupState {
  const prev = readWarmupState();
  const newStreak = computeWarmupStreak(prev.warmupStreak, prev.lastWarmupAt, today);
  const next: WarmupState = { lastWarmupAt: today, warmupStreak: newStreak };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(WARMUP_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}

interface ListeningWarmupProps {
  open: boolean;
  onClose: () => void;
  sentences?: string[];
  onComplete?: (state: WarmupState) => void;
}

type Phase = 'playing' | 'paused' | 'done';

const RING_SIZE = 96;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

function hasSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function speak(
  text: string,
  rate: number,
  onEnd: () => void,
): SpeechSynthesisUtterance | null {
  if (!hasSpeech()) {
    // Fall back: schedule onEnd asynchronously.
    setTimeout(onEnd, 0);
    return null;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
  return u;
}

export default function ListeningWarmup({
  open,
  onClose,
  sentences,
  onComplete,
}: ListeningWarmupProps) {
  const list = (sentences && sentences.length > 0
    ? sentences
    : DEFAULT_WARMUP_SENTENCES
  ).slice(0, WARMUP_TARGET);

  const [index, setIndex] = useState(0);
  const [pass, setPass] = useState<0 | 1>(0); // 0 = slow (0.85), 1 = normal (1.0)
  const [phase, setPhase] = useState<Phase>('playing');
  const [finalState, setFinalState] = useState<WarmupState | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const phaseRef = useRef<Phase>('playing');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Reset whenever the panel opens.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setPass(0);
      setPhase('playing');
      setFinalState(null);
    } else {
      if (hasSpeech()) window.speechSynthesis.cancel();
    }
  }, [open]);

  const advance = useCallback(() => {
    // If user paused mid-utterance, ignore the auto-advance from onend.
    if (phaseRef.current === 'paused') return;
    setPass((p) => {
      if (p === 0) return 1;
      // pass === 1: move to next sentence
      setIndex((i) => {
        const nextI = i + 1;
        if (nextI >= list.length) {
          setPhase('done');
        }
        return nextI;
      });
      return 0;
    });
  }, [list.length]);

  // Drive playback.
  useEffect(() => {
    if (!open) return;
    if (phase !== 'playing') return;
    if (index >= list.length) return;
    const sentence = list[index];
    const rate = pass === 0 ? 0.85 : 1.0;
    if (hasSpeech()) window.speechSynthesis.cancel();
    utterRef.current = speak(sentence, rate, advance);
    return () => {
      // cleanup on unmount/dep change
      if (hasSpeech()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, phase, index, pass, list, advance]);

  // Persist completion.
  useEffect(() => {
    if (phase === 'done' && open && !finalState) {
      const next = persistWarmupCompletion();
      setFinalState(next);
      onComplete?.(next);
    }
  }, [phase, open, finalState, onComplete]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [open, onClose]);

  const handlePause = useCallback(() => {
    setPhase('paused');
    if (hasSpeech()) {
      try {
        window.speechSynthesis.pause();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleResume = useCallback(() => {
    setPhase('playing');
    if (hasSpeech()) {
      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleSkip = useCallback(() => {
    if (hasSpeech()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    setPass(0);
    setIndex((i) => {
      const nextI = i + 1;
      if (nextI >= list.length) {
        setPhase('done');
      }
      return nextI;
    });
  }, [list.length]);

  const handleStop = useCallback(() => {
    if (hasSpeech()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    onClose();
  }, [onClose]);

  if (!open) return null;

  const completed = Math.min(index, list.length);
  const progress = list.length > 0 ? completed / list.length : 0;
  const dashOffset = RING_CIRC * (1 - progress);

  return (
    <div
      data-testid="listening-warmup-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Listening Warmup"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleStop();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--card-bg, #ffffff)',
          color: 'var(--text, #111827)',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          border: '1px solid var(--border, #e5e7eb)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Headphones size={22} color="#6366f1" />
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Listening Warmup</h3>
          </div>
          <button
            type="button"
            onClick={handleStop}
            aria-label="Close warmup"
            data-testid="warmup-close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-secondary, #6b7280)',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            data-testid="warmup-progress-ring"
            aria-label={`Progress ${completed} of ${list.length}`}
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke="var(--border, #e5e7eb)"
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke="#6366f1"
              strokeWidth={RING_STROKE}
              fill="none"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              style={{ transition: 'stroke-dashoffset 0.4s ease' }}
            />
            <text
              x="50%"
              y="50%"
              dominantBaseline="middle"
              textAnchor="middle"
              fontSize="18"
              fontWeight="600"
              fill="currentColor"
            >
              {completed}/{list.length}
            </text>
          </svg>
        </div>

        {phase !== 'done' && index < list.length && (
          <div
            data-testid="warmup-current-sentence"
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--bg, #f9fafb)',
              border: '1px solid var(--border, #e5e7eb)',
              fontSize: '1.05rem',
              lineHeight: 1.5,
              textAlign: 'center',
              marginBottom: 16,
              minHeight: 64,
            }}
          >
            {list[index]}
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: 'var(--text-secondary, #6b7280)',
              }}
            >
              {pass === 0 ? 'Slow pass (0.85×)' : 'Normal pass (1.0×)'}
            </div>
          </div>
        )}

        {phase === 'done' && finalState && (
          <div
            data-testid="warmup-summary"
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--success-bg, #d1fae5)',
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 6 }}>
              Nice ear-training session! 🎧
            </div>
            <div
              style={{ fontSize: 14, color: 'var(--text-secondary, #374151)' }}
            >
              {list.length} sentences played. Streak:{' '}
              <strong>{finalState.warmupStreak} day{finalState.warmupStreak === 1 ? '' : 's'}</strong>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {phase === 'playing' && (
            <button
              type="button"
              onClick={handlePause}
              data-testid="warmup-pause"
              style={btnStyle('#f59e0b')}
            >
              <Pause size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Pause
            </button>
          )}
          {phase === 'paused' && (
            <button
              type="button"
              onClick={handleResume}
              data-testid="warmup-resume"
              style={btnStyle('#10b981')}
            >
              <Play size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Resume
            </button>
          )}
          {phase !== 'done' && (
            <button
              type="button"
              onClick={handleSkip}
              data-testid="warmup-skip"
              style={btnStyle('#6366f1')}
            >
              <SkipForward
                size={16}
                style={{ verticalAlign: 'middle', marginRight: 4 }}
              />
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={handleStop}
            data-testid="warmup-stop"
            style={btnStyle('#ef4444')}
          >
            <X size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {phase === 'done' ? 'Close' : 'Stop'}
          </button>
        </div>

        {finalState && finalState.warmupStreak > 1 && phase === 'done' && (
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              color: '#f59e0b',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Flame size={14} /> {finalState.warmupStreak}-day warmup streak!
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: color,
    color: 'white',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  };
}

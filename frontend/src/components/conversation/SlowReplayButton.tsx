import { useState, useMemo, useRef, useEffect } from 'react';
import { Turtle, Square, ChevronDown, SkipBack, SkipForward, Play } from 'lucide-react';

export interface SlowReplayButtonProps {
  text: string;
  speak: (text: string, lang?: string, rateOverride?: number) => void;
  stop: () => void;
  isSpeaking: boolean;
}

/**
 * Splits text into sentences using sentence terminators (. ! ?) followed by whitespace.
 * Filters out empty/whitespace-only fragments.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const SLOW_RATE = 0.6;
export const NORMAL_RATE = 0.9;

/**
 * Pure helper: compute next sentence index after a "next" or "prev" action.
 * Clamped to [0, total-1]. Returns 0 if total is 0.
 */
export function stepSentenceIdx(
  currentIdx: number,
  direction: 'prev' | 'next',
  total: number,
): number {
  if (total <= 0) return 0;
  const clamped = Math.max(0, Math.min(currentIdx, total - 1));
  if (direction === 'next') return Math.min(total - 1, clamped + 1);
  return Math.max(0, clamped - 1);
}

/**
 * Pure helper: rate to use given the slowMode toggle.
 */
export function rateForMode(slowMode: boolean): number {
  return slowMode ? SLOW_RATE : NORMAL_RATE;
}

/**
 * Pure helper: behavior of the primary 🐢/Stop button click.
 * - If currently speaking, stops playback.
 * - Otherwise, requests slow (0.6×) playback of the full text.
 *
 * Extracted so it can be unit-tested without a DOM.
 */
export function handleSlowReplayClick(opts: {
  text: string;
  isSpeaking: boolean;
  speak: (text: string, lang?: string, rateOverride?: number) => void;
  stop: () => void;
}): void {
  if (opts.isSpeaking) {
    opts.stop();
    return;
  }
  opts.speak(opts.text, 'en-US', SLOW_RATE);
}

export function SlowReplayButton({ text, speak, stop, isSpeaking }: SlowReplayButtonProps) {
  const [stepperOpen, setStepperOpen] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [slowMode, setSlowMode] = useState(true);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const sentences = useMemo(() => splitIntoSentences(text), [text]);
  const total = sentences.length;
  const safeIdx = total > 0 ? Math.min(currentIdx, total - 1) : 0;

  // Close popover on outside click
  useEffect(() => {
    if (!stepperOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setStepperOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [stepperOpen]);

  const handleSlowClick = () => {
    handleSlowReplayClick({ text, isSpeaking, speak, stop });
  };

  const handlePlaySentence = (idx: number) => {
    const sentence = sentences[idx];
    if (!sentence) return;
    if (isSpeaking) stop();
    speak(sentence, 'en-US', slowMode ? SLOW_RATE : NORMAL_RATE);
  };

  const handlePrev = () => {
    if (total === 0) return;
    const next = Math.max(0, safeIdx - 1);
    setCurrentIdx(next);
    handlePlaySentence(next);
  };

  const handleNext = () => {
    if (total === 0) return;
    const next = Math.min(total - 1, safeIdx + 1);
    setCurrentIdx(next);
    handlePlaySentence(next);
  };

  const buttonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 4px',
    opacity: 0.6,
    transition: 'opacity 0.15s',
    display: 'inline-flex',
    alignItems: 'center',
  };

  const iconColor = 'var(--primary, #6366f1)';

  return (
    <span
      ref={popoverRef}
      data-testid="slow-replay-wrapper"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 2 }}
    >
      <button
        type="button"
        onClick={handleSlowClick}
        aria-label={isSpeaking ? 'Stop slow replay' : 'Slow replay (0.6×)'}
        title={isSpeaking ? 'Stop' : 'Slow replay (0.6×)'}
        data-testid="slow-replay-button"
        style={buttonStyle}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
      >
        {isSpeaking ? (
          <Square size={14} color={iconColor} data-testid="slow-replay-stop-icon" />
        ) : (
          <Turtle size={14} color={iconColor} data-testid="slow-replay-turtle-icon" />
        )}
      </button>
      {total > 1 && (
        <button
          type="button"
          onClick={() => setStepperOpen((v) => !v)}
          aria-label="Toggle sentence stepper"
          aria-expanded={stepperOpen}
          title="Step through sentences"
          data-testid="slow-replay-stepper-toggle"
          style={{ ...buttonStyle, padding: '2px 2px' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
        >
          <ChevronDown size={12} color={iconColor} />
        </button>
      )}
      {stepperOpen && total > 0 && (
        <div
          role="dialog"
          aria-label="Sentence stepper"
          data-testid="slow-replay-stepper-popover"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            padding: '8px 10px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 50,
            whiteSpace: 'nowrap',
            color: 'var(--text-primary, #111827)',
            fontSize: 12,
          }}
        >
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous sentence"
            data-testid="slow-replay-prev"
            disabled={safeIdx === 0}
            style={{
              background: 'none',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 4,
              cursor: safeIdx === 0 ? 'default' : 'pointer',
              padding: '2px 4px',
              opacity: safeIdx === 0 ? 0.4 : 1,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <SkipBack size={12} color={iconColor} />
          </button>
          <button
            type="button"
            onClick={() => handlePlaySentence(safeIdx)}
            aria-label={`Play sentence ${safeIdx + 1} of ${total}`}
            data-testid="slow-replay-play-current"
            style={{
              background: 'none',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 4,
              cursor: 'pointer',
              padding: '2px 6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--text-primary, #111827)',
            }}
          >
            <Play size={12} color={iconColor} />
            <span data-testid="slow-replay-counter">
              Sentence {safeIdx + 1}/{total}
            </span>
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next sentence"
            data-testid="slow-replay-next"
            disabled={safeIdx >= total - 1}
            style={{
              background: 'none',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 4,
              cursor: safeIdx >= total - 1 ? 'default' : 'pointer',
              padding: '2px 4px',
              opacity: safeIdx >= total - 1 ? 0.4 : 1,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <SkipForward size={12} color={iconColor} />
          </button>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={slowMode}
              onChange={(e) => setSlowMode(e.target.checked)}
              aria-label="Toggle slow playback"
              data-testid="slow-replay-slow-toggle"
            />
            Slow
          </label>
        </div>
      )}
    </span>
  );
}

export default SlowReplayButton;

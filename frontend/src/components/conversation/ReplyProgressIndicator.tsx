import { useEffect, useRef, useState } from 'react';

/**
 * Pure helper: returns the staged label for a given elapsed wait time (ms).
 * Stages cycle roughly every 2.5s, but mapped to qualitative descriptions:
 *   0 – 2000ms : "Reviewing your message…"
 *   2000 – 6000ms : "Crafting reply…"
 *   6000ms+   : "Polishing the wording…"
 *
 * Exported separately so it can be unit-tested without rendering React or
 * pulling in jsdom / @testing-library.
 */
export function getStageLabel(elapsedMs: number): string {
  if (elapsedMs < 2000) return 'Reviewing your message…';
  if (elapsedMs < 6000) return 'Crafting reply…';
  return 'Polishing the wording…';
}

/**
 * Pure helper: the elapsed-seconds counter only appears after the wait
 * exceeds 3 seconds, to avoid flashing "0s" on fast responses.
 */
export function shouldShowElapsed(elapsedMs: number): boolean {
  return elapsedMs >= 3000;
}

export interface ReplyProgressIndicatorProps {
  /**
   * Optional epoch-ms timestamp captured by the parent at the moment the
   * user message was sent. Driving the timer from a parent-owned value keeps
   * the elapsed counter accurate across re-renders / parent state churn.
   * If omitted, the component falls back to its own mount time.
   */
  startedAt?: number;
}

/**
 * Animated typing bubble shown in the conversation thread while the
 * assistant reply is in flight. Cycles through staged status labels and
 * shows an elapsed-time counter once the wait exceeds 3 seconds.
 */
export function ReplyProgressIndicator({ startedAt }: ReplyProgressIndicatorProps) {
  const mountedAtRef = useRef<number>(Date.now());
  const start = startedAt ?? mountedAtRef.current;
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - start);
  const label = getStageLabel(elapsed);
  const showElapsed = shouldShowElapsed(elapsed);
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div
      className="message message-assistant reply-progress-indicator"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="reply-progress-indicator"
    >
      <span
        className="reply-progress-dots"
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          gap: 4,
          alignItems: 'center',
          marginRight: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            opacity: 0.55,
            animation: 'reply-progress-bounce 1.2s infinite ease-in-out',
            animationDelay: '0s',
          }}
        />
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            opacity: 0.55,
            animation: 'reply-progress-bounce 1.2s infinite ease-in-out',
            animationDelay: '0.2s',
          }}
        />
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            opacity: 0.55,
            animation: 'reply-progress-bounce 1.2s infinite ease-in-out',
            animationDelay: '0.4s',
          }}
        />
      </span>
      <span className="reply-progress-label" style={{ fontSize: 13, opacity: 0.85 }}>
        {label}
      </span>
      {showElapsed && (
        <span
          className="reply-progress-elapsed"
          data-testid="reply-progress-elapsed"
          style={{ marginLeft: 8, fontSize: 12, opacity: 0.6 }}
        >
          {seconds}s
        </span>
      )}
      <style>{`
        @keyframes reply-progress-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default ReplyProgressIndicator;

import { useState, useEffect, useRef } from 'react';

interface GrammarStreakBadgeProps {
  /** Current consecutive correct-grammar streak (0 = no streak). */
  currentStreak: number;
  /** Best streak achieved in this session. */
  bestStreak: number;
}

/**
 * Fire-emoji streak counter that appears when the user gets 2+
 * consecutive grammatically-correct messages.
 *
 * - Pulses (scale-up) whenever the streak increases.
 * - Briefly flashes "streak broken" when an error occurs after streak ≥ 2.
 * - Compact enough for mobile, respects dark-mode CSS variables.
 */
export function GrammarStreakBadge({ currentStreak, bestStreak }: GrammarStreakBadgeProps) {
  const [animating, setAnimating] = useState(false);
  const [broken, setBroken] = useState(false);
  const prevStreak = useRef(currentStreak);

  useEffect(() => {
    const prev = prevStreak.current;
    prevStreak.current = currentStreak;

    // Streak increased → pulse animation
    if (currentStreak > prev && currentStreak >= 2) {
      setAnimating(true);
      const id = setTimeout(() => setAnimating(false), 500);
      return () => clearTimeout(id);
    }

    // Streak broken (was ≥ 2, now reset to 0)
    if (prev >= 2 && currentStreak === 0) {
      setBroken(true);
      const id = setTimeout(() => setBroken(false), 1200);
      return () => clearTimeout(id);
    }
  }, [currentStreak]);

  // Show the "streak broken" flash even if current streak is 0
  if (broken) {
    return (
      <span
        data-testid="grammar-streak-badge"
        data-streak-broken="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 'inherit',
          fontWeight: 600,
          color: 'var(--danger, #ef4444)',
          animation: 'grammarStreakFadeOut 1.2s ease-out forwards',
        }}
      >
        <style>{`
          @keyframes grammarStreakFadeOut {
            0% { opacity: 1; transform: scale(1.1); }
            70% { opacity: 1; }
            100% { opacity: 0; transform: scale(0.9); }
          }
        `}</style>
        💔 streak broken
      </span>
    );
  }

  // Only show badge when streak ≥ 2
  if (currentStreak < 2) return null;

  return (
    <span
      data-testid="grammar-streak-badge"
      data-streak={currentStreak}
      title={`Grammar streak: ${currentStreak} in a row${bestStreak > currentStreak ? ` (best: ${bestStreak})` : ' (session best!)'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 'inherit',
        fontWeight: 600,
        color: currentStreak >= 5 ? 'var(--success, #22c55e)' : 'var(--warning, #f59e0b)',
        transform: animating ? 'scale(1.3)' : 'scale(1)',
        transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      <style>{`
        @keyframes grammarStreakPulse {
          0% { transform: scale(1); }
          40% { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
      `}</style>
      🔥 {currentStreak}
    </span>
  );
}

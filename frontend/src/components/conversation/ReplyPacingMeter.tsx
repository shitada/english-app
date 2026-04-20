import { useEffect, useState } from 'react';

export interface ReplyPacingMeterProps {
  /** Current (possibly in-progress) recognition transcript. */
  transcript: string;
  /** Whether the speech recognition is actively listening. */
  isRecording: boolean;
  /** Timestamp (ms) when the current mic turn started, or null. */
  startedAt: number | null;
  /** Recently completed turns' final WPMs (most recent last). */
  recentWpms: number[];
  /** WPM for the just-completed turn, used to render the coaching tip. */
  finalWpm?: number | null;
}

export type PaceZone = 'slow' | 'natural' | 'rushed';

/** Count whitespace-separated word tokens. Pure helper. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Compute words-per-minute from a word count and elapsed seconds. */
export function computeWpm(wordCount: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0 || wordCount <= 0) return 0;
  return Math.round(wordCount / (elapsedSeconds / 60));
}

/**
 * Classify a WPM value into a pacing zone.
 *  - slow:    < 100 wpm
 *  - natural: 100..160 wpm (inclusive)
 *  - rushed:  > 160 wpm
 */
export function getPaceZone(wpm: number): PaceZone {
  if (wpm < 100) return 'slow';
  if (wpm <= 160) return 'natural';
  return 'rushed';
}

/** Hex color for a given pacing zone. */
export function getZoneColor(zone: PaceZone): string {
  switch (zone) {
    case 'slow':
      return '#3b82f6';
    case 'natural':
      return '#22c55e';
    case 'rushed':
      return '#f97316';
  }
}

/** One-line coaching tip based on a final WPM. */
export function getCoachingTip(wpm: number): string {
  const zone = getPaceZone(wpm);
  if (zone === 'natural') return 'Nice natural pace ✨';
  if (zone === 'rushed') return 'Try slowing down for clarity';
  return 'You can speak a touch faster — sounded hesitant';
}

const GAUGE_MIN = 0;
const GAUGE_MAX = 220; // visual ceiling for needle position

/** Map WPM to a 0..100 percent position on the gauge. */
export function wpmToPercent(wpm: number): number {
  const clamped = Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, wpm));
  return ((clamped - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100;
}

/**
 * Compact horizontal pacing meter shown beside the user's mic input
 * during a Conversation reply turn. Purely presentational.
 */
export function ReplyPacingMeter({
  transcript,
  isRecording,
  startedAt,
  recentWpms,
  finalWpm,
}: ReplyPacingMeterProps) {
  // Force a periodic re-render while the mic is hot so the live WPM/needle
  // tracks elapsed time even when the transcript hasn't changed.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [isRecording]);

  // Render nothing when the user isn't recording AND we have no turn data.
  const hasTranscript = !!transcript && transcript.trim().length > 0;
  const hasFinal = finalWpm != null && finalWpm > 0;
  if (!isRecording && !hasTranscript && !hasFinal) return null;

  const elapsedSeconds =
    isRecording && startedAt != null ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
  const liveWpm = isRecording ? computeWpm(countWords(transcript), elapsedSeconds) : 0;
  const displayWpm = isRecording ? liveWpm : hasFinal ? (finalWpm as number) : 0;
  const zone = getPaceZone(displayWpm);
  const color = getZoneColor(zone);
  const needlePct = wpmToPercent(displayWpm);

  // Sparkline for the last few WPM values.
  const points = recentWpms.slice(-5);
  const sparkW = 60;
  const sparkH = 16;
  const maxPoint = Math.max(GAUGE_MAX, ...points, 1);
  const sparkCoords = points.map((v, i) => {
    const x = points.length === 1 ? sparkW / 2 : (i / (points.length - 1)) * sparkW;
    const y = sparkH - (Math.max(0, v) / maxPoint) * sparkH;
    return { x, y, v };
  });
  const sparkPath = sparkCoords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div
      data-testid="reply-pacing-meter"
      data-zone={zone}
      role="group"
      aria-label="Speaking pace meter"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 10px',
        fontSize: 12,
        color: 'var(--text-secondary, #64748b)',
        flexWrap: 'wrap',
      }}
    >
      {/* Three-zone gauge */}
      <div
        data-testid="reply-pacing-gauge"
        style={{
          position: 'relative',
          width: 140,
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--border, #e2e8f0)',
          display: 'flex',
        }}
        title={`${displayWpm} wpm`}
      >
        <div style={{ flex: (100 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN), background: 'rgba(59,130,246,0.35)' }} />
        <div style={{ flex: (160 - 100) / (GAUGE_MAX - GAUGE_MIN), background: 'rgba(34,197,94,0.35)' }} />
        <div style={{ flex: (GAUGE_MAX - 160) / (GAUGE_MAX - GAUGE_MIN), background: 'rgba(249,115,22,0.35)' }} />
        {/* Needle */}
        <div
          data-testid="reply-pacing-needle"
          style={{
            position: 'absolute',
            top: -2,
            left: `${needlePct}%`,
            width: 2,
            height: 12,
            background: color,
            borderRadius: 1,
            transform: 'translateX(-1px)',
            transition: 'left 0.2s linear',
          }}
        />
      </div>
      <span
        data-testid="reply-pacing-wpm"
        style={{ color, fontWeight: 700, minWidth: 56 }}
      >
        {displayWpm} wpm
      </span>
      {/* Coaching tip after the turn finishes (mic off, finalWpm available). */}
      {!isRecording && hasFinal && (
        <span
          data-testid="reply-pacing-tip"
          style={{ color, fontWeight: 600 }}
        >
          {getCoachingTip(finalWpm as number)}
        </span>
      )}
      {/* Tiny sparkline of recent WPMs */}
      {points.length > 0 && (
        <svg
          data-testid="reply-pacing-sparkline"
          width={sparkW}
          height={sparkH}
          viewBox={`0 0 ${sparkW} ${sparkH}`}
          aria-hidden="true"
        >
          {points.length > 1 && (
            <path
              d={sparkPath}
              fill="none"
              stroke="var(--muted, #94a3b8)"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {sparkCoords.map((p, i) => (
            <circle
              key={i}
              data-testid="reply-pacing-sparkline-point"
              cx={p.x}
              cy={p.y}
              r={1.6}
              fill={getZoneColor(getPaceZone(p.v))}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

export default ReplyPacingMeter;

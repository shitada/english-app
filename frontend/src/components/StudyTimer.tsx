import { useState } from 'react';
import { Timer, Play, Pause, RotateCcw, X } from 'lucide-react';
import { useStudyTimer } from '../hooks/useStudyTimer';

const PRESETS = [15, 25, 45];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function StudyTimer() {
  const [expanded, setExpanded] = useState(false);
  const timer = useStudyTimer();

  const modeLabel = timer.mode === 'focus' ? 'Focus' : timer.mode === 'break' ? 'Break' : 'Study Timer';
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - timer.progress);

  if (!expanded) {
    return (
      <button
        className={`study-timer-collapsed ${timer.isRunning ? 'study-timer-active' : ''} ${timer.mode === 'break' ? 'study-timer-break' : ''}`}
        onClick={() => setExpanded(true)}
        aria-label="Open study timer"
        title="Study Timer"
      >
        <Timer size={16} />
        {timer.mode !== 'idle' && <span className="study-timer-badge">{formatTime(timer.timeLeft)}</span>}
      </button>
    );
  }

  return (
    <div className={`study-timer-expanded ${timer.mode === 'break' ? 'study-timer-break-panel' : ''}`}>
      <div className="study-timer-header">
        <span className="study-timer-mode">{modeLabel}</span>
        <button className="study-timer-close" onClick={() => setExpanded(false)} aria-label="Close timer">
          <X size={16} />
        </button>
      </div>

      <div className="study-timer-ring-container">
        <svg viewBox="0 0 84 84" className="study-timer-ring">
          <circle cx="42" cy="42" r={radius} fill="none" stroke="var(--border)" strokeWidth="4" />
          <circle
            cx="42" cy="42" r={radius}
            fill="none"
            stroke={timer.mode === 'break' ? 'var(--success)' : 'var(--primary)'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
            transform="rotate(-90 42 42)"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <span className="study-timer-time">{formatTime(timer.timeLeft)}</span>
      </div>

      {timer.mode === 'idle' ? (
        <div className="study-timer-presets">
          {PRESETS.map(m => (
            <button key={m} className="study-timer-preset" onClick={() => timer.start(m)}>
              {m}m
            </button>
          ))}
        </div>
      ) : (
        <div className="study-timer-controls">
          {timer.isRunning ? (
            <button className="study-timer-btn" onClick={timer.pause} aria-label="Pause"><Pause size={18} /></button>
          ) : (
            <button className="study-timer-btn" onClick={timer.resume} aria-label="Resume"><Play size={18} /></button>
          )}
          <button className="study-timer-btn" onClick={timer.reset} aria-label="Reset"><RotateCcw size={18} /></button>
        </div>
      )}
    </div>
  );
}

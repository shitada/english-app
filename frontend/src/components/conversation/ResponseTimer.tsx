import { useState, useEffect, useRef } from 'react';

interface ResponseTimerProps {
  isSpeaking: boolean;
  lastAssistantIndex: number;
  userMessageCount: number;
  onTimeRecord: (seconds: number) => void;
}

export function ResponseTimer({ isSpeaking, lastAssistantIndex, userMessageCount, onTimeRecord }: ResponseTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const [active, setActive] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const prevSpeakingRef = useRef(false);
  const recordedForRef = useRef(-1);
  const lastAssistantRef = useRef(-1);

  // Start timer when TTS finishes speaking (isSpeaking: true → false)
  useEffect(() => {
    const wasSpeaking = prevSpeakingRef.current;
    prevSpeakingRef.current = isSpeaking;

    if (wasSpeaking && !isSpeaking && lastAssistantIndex >= 0) {
      startTimeRef.current = Date.now();
      lastAssistantRef.current = lastAssistantIndex;
      setElapsed(0);
      setActive(true);
    }
  }, [isSpeaking, lastAssistantIndex]);

  // Stop timer when user sends a message
  useEffect(() => {
    if (active && userMessageCount > 0 && startTimeRef.current && recordedForRef.current < lastAssistantRef.current) {
      const seconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      recordedForRef.current = lastAssistantRef.current;
      onTimeRecord(seconds);
      setActive(false);
      setElapsed(seconds);
    }
  }, [userMessageCount, active, onTimeRecord]);

  // Update elapsed display while active
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Math.round((Date.now() - startTimeRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [active]);

  if (!active || elapsed < 2) return null;

  const color = elapsed < 10 ? '#34a853' : elapsed < 20 ? '#fbbc04' : '#ea4335';
  const width = Math.min(100, (elapsed / 30) * 100);

  return (
    <div style={{ margin: '0 0 6px', padding: '4px 12px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>⏱️ Thinking: {elapsed}s</span>
      </div>
      <div style={{ marginTop: 3, height: 3, borderRadius: 2, background: 'var(--border, #ddd)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${width}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.5s ease, background 0.3s ease',
        }} />
      </div>
    </div>
  );
}

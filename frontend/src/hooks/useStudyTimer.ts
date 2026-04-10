import { useState, useEffect, useCallback, useRef } from 'react';

export type TimerMode = 'idle' | 'focus' | 'break';

interface TimerState {
  mode: TimerMode;
  timeLeft: number;
  duration: number;
  isRunning: boolean;
}

const STORAGE_KEY = 'study_timer';
const BREAK_DURATION = 5 * 60;
const DEFAULT_FOCUS = 25 * 60;

function loadState(): TimerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TimerState;
      if (parsed && typeof parsed.timeLeft === 'number') return { ...parsed, isRunning: false };
    }
  } catch { /* ignore */ }
  return { mode: 'idle', timeLeft: DEFAULT_FOCUS, duration: DEFAULT_FOCUS, isRunning: false };
}

function saveState(state: TimerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch { /* ignore */ }
}

function notify(title: string, body: string) {
  playBeep();
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

export function useStudyTimer() {
  const [state, setState] = useState<TimerState>(loadState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist on change
  useEffect(() => { saveState(state); }, [state]);

  // Countdown logic
  useEffect(() => {
    if (!state.isRunning) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setState(prev => {
        if (prev.timeLeft <= 1) {
          if (prev.mode === 'focus') {
            notify('Focus session complete!', 'Time for a break.');
            return { mode: 'break', timeLeft: BREAK_DURATION, duration: BREAK_DURATION, isRunning: true };
          }
          notify('Break over!', 'Ready for another round?');
          return { mode: 'idle', timeLeft: DEFAULT_FOCUS, duration: DEFAULT_FOCUS, isRunning: false };
        }
        return { ...prev, timeLeft: prev.timeLeft - 1 };
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.isRunning]);

  const start = useCallback((minutes?: number) => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const dur = minutes ? minutes * 60 : state.duration;
    setState({ mode: 'focus', timeLeft: dur, duration: dur, isRunning: true });
  }, [state.duration]);

  const pause = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: false }));
  }, []);

  const resume = useCallback(() => {
    setState(prev => prev.mode !== 'idle' ? { ...prev, isRunning: true } : prev);
  }, []);

  const reset = useCallback(() => {
    setState({ mode: 'idle', timeLeft: DEFAULT_FOCUS, duration: DEFAULT_FOCUS, isRunning: false });
  }, []);

  const progress = state.duration > 0 ? (state.duration - state.timeLeft) / state.duration : 0;

  return { ...state, progress, start, pause, resume, reset };
}

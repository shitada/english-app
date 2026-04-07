import { useState, useEffect, useRef, useCallback } from 'react';

export type HealthStatus = 'connected' | 'degraded' | 'disconnected';

interface HealthState {
  status: HealthStatus;
  uptime: number | null;
  lastChecked: Date | null;
}

const POLL_INTERVAL = 30_000;

export function useHealthCheck() {
  const [state, setState] = useState<HealthState>({
    status: 'connected',
    uptime: null,
    lastChecked: null,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    if (!navigator.onLine) {
      setState({ status: 'disconnected', uptime: null, lastChecked: new Date() });
      return;
    }
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (res.ok && data.status === 'ok' && data.database === 'ok') {
        setState({ status: 'connected', uptime: data.uptime_seconds ?? null, lastChecked: new Date() });
      } else {
        setState({ status: 'degraded', uptime: data.uptime_seconds ?? null, lastChecked: new Date() });
      }
    } catch {
      setState({ status: 'disconnected', uptime: null, lastChecked: new Date() });
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);
    const onOnline = () => check();
    const onOffline = () => setState({ status: 'disconnected', uptime: null, lastChecked: new Date() });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [check]);

  return state;
}

import { useEffect, useState } from 'react';
import { getSessionAnalytics, type SessionAnalyticsResponse } from '../../api';

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

const MODULE_COLORS: Record<string, string> = {
  conversation: '#3b82f6',
  pronunciation: '#f59e0b',
  vocabulary: '#22c55e',
};

const MODULE_LABELS: Record<string, string> = {
  conversation: 'Conversation',
  pronunciation: 'Pronunciation',
  vocabulary: 'Vocabulary',
};

export function SessionAnalytics() {
  const [data, setData] = useState<SessionAnalyticsResponse | null>(null);

  useEffect(() => {
    getSessionAnalytics(7).then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  const totalSeconds = data.modules.reduce((s, m) => s + m.total_seconds, 0);
  const maxDaily = Math.max(
    1,
    ...data.daily.map(
      (d) => d.conversation_seconds + d.pronunciation_seconds + d.vocabulary_seconds,
    ),
  );

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>📊 Session Analytics (7 days)</h3>

      {/* Module bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {data.modules.map((m) => {
          const pct = totalSeconds > 0 ? (m.total_seconds / totalSeconds) * 100 : 0;
          return (
            <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '100px', fontSize: '0.85rem', color: 'var(--text-secondary, #666)' }}>
                {MODULE_LABELS[m.module] ?? m.module}
              </span>
              <div
                style={{
                  flex: 1,
                  height: '20px',
                  background: 'var(--bg-secondary, #f3f4f6)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: MODULE_COLORS[m.module] ?? '#888',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease',
                    minWidth: pct > 0 ? '4px' : '0',
                  }}
                />
              </div>
              <span style={{ width: '55px', fontSize: '0.8rem', textAlign: 'right', color: 'var(--text-secondary, #666)' }}>
                {formatTime(m.total_seconds)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary, #666)' }}>
        Total: <strong>{formatTime(totalSeconds)}</strong> across{' '}
        {data.modules.reduce((s, m) => s + m.session_count, 0)} sessions
      </p>

      {/* Daily mini chart */}
      {data.daily.length > 0 && (
        <>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Daily Breakdown</h4>
          <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '60px' }}>
            {data.daily.map((d) => {
              const dayTotal = d.conversation_seconds + d.pronunciation_seconds + d.vocabulary_seconds;
              const h = (dayTotal / maxDaily) * 100;
              const convPct = dayTotal > 0 ? (d.conversation_seconds / dayTotal) * 100 : 0;
              const pronPct = dayTotal > 0 ? (d.pronunciation_seconds / dayTotal) * 100 : 0;
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${formatTime(dayTotal)}`}
                  style={{
                    flex: 1,
                    height: `${Math.max(h, 2)}%`,
                    borderRadius: '2px 2px 0 0',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ flex: `${convPct}`, background: MODULE_COLORS.conversation }} />
                  <div style={{ flex: `${pronPct}`, background: MODULE_COLORS.pronunciation }} />
                  <div style={{ flex: `${100 - convPct - pronPct}`, background: MODULE_COLORS.vocabulary }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '3px', marginTop: '2px' }}>
            {data.daily.map((d) => (
              <span
                key={d.date}
                style={{ flex: 1, fontSize: '0.6rem', textAlign: 'center', color: 'var(--text-secondary, #999)' }}
              >
                {d.date.slice(5)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

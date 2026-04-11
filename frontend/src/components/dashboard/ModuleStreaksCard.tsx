import { useState, useEffect } from 'react';
import { api, type ModuleStreaksResponse } from '../../api';

const MODULE_META: Record<string, { label: string; color: string; emoji: string }> = {
  conversation: { label: 'Conversation', color: '#6366f1', emoji: '💬' },
  vocabulary: { label: 'Vocabulary', color: '#10b981', emoji: '📚' },
  pronunciation: { label: 'Pronunciation', color: '#f59e0b', emoji: '🎙️' },
  listening: { label: 'Listening', color: '#ec4899', emoji: '🎧' },
};

export function ModuleStreaksCard() {
  const [data, setData] = useState<ModuleStreaksResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardModuleStreaks()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem' }}>🔥 Module Streaks</h3>
        <p style={{ color: 'var(--text-secondary, #6b7280)' }}>Loading…</p>
      </div>
    );
  }

  if (!data) return null;

  const modules = Object.entries(data.modules);
  const maxStreak = Math.max(...modules.map(([, m]) => m.current_streak), 1);

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>🔥 Module Streaks</h3>
        <span style={{
          fontSize: '0.85rem',
          fontWeight: 600,
          color: 'var(--text-secondary, #6b7280)',
        }}>
          Overall: {data.overall_streak} day{data.overall_streak !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {modules.map(([key, mod]) => {
          const meta = MODULE_META[key] || { label: key, color: '#9ca3af', emoji: '📊' };
          const pct = maxStreak > 0 ? (mod.current_streak / maxStreak) * 100 : 0;
          const isMostConsistent = data.most_consistent === key;
          const isLeastConsistent = data.least_consistent === key;

          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                  {meta.emoji} {meta.label}
                  {isMostConsistent && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#dcfce7', color: '#166534', padding: '0.1rem 0.4rem', borderRadius: '999px' }}>
                      ⭐ Most Consistent
                    </span>
                  )}
                  {isLeastConsistent && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#fef3c7', color: '#92400e', padding: '0.1rem 0.4rem', borderRadius: '999px' }}>
                      Needs Focus
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {mod.current_streak} day{mod.current_streak !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                background: 'var(--bg-secondary, #f3f4f6)',
                borderRadius: '4px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.max(pct, 2)}%`,
                  height: '100%',
                  background: mod.current_streak > 0 ? meta.color : '#d1d5db',
                  borderRadius: '4px',
                  transition: 'width 0.5s ease',
                }} />
              </div>
              {mod.last_active && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9ca3af)' }}>
                  Last active: {mod.last_active}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

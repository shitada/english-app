import { useState, useEffect } from 'react';
import { getSpeakingJournalProgress, type SpeakingJournalProgressResponse } from '../../api';

const trendEmoji: Record<string, string> = {
  improving: '📈',
  declining: '📉',
  stable: '➡️',
  insufficient_data: '📊',
};

const trendLabel: Record<string, string> = {
  improving: 'Improving',
  declining: 'Needs attention',
  stable: 'Stable',
  insufficient_data: 'Not enough data yet',
};

export function SpeakingJournalProgress() {
  const [data, setData] = useState<SpeakingJournalProgressResponse | null>(null);

  useEffect(() => {
    getSpeakingJournalProgress().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_entries === 0) return null;

  const totalMinutes = Math.round(data.total_speaking_time_seconds / 60);
  const maxWpm = Math.max(1, ...data.entries_by_date.map((d) => d.avg_wpm));

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        📖 Speaking Journal
        <span style={{ fontSize: 14, fontWeight: 'normal', color: 'var(--text-secondary)' }}>
          {trendEmoji[data.wpm_trend] || '📊'} {trendLabel[data.wpm_trend] || data.wpm_trend}
        </span>
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.total_entries}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Entries</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalMinutes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Minutes</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
            {Math.round(data.avg_wpm)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg WPM</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
            {Math.round(data.avg_vocabulary_diversity * 100)}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Vocab Diversity</div>
        </div>
      </div>

      {/* WPM by Date Chart */}
      {data.entries_by_date.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Daily WPM</h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
            {data.entries_by_date.slice(-14).map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${Math.round(d.avg_wpm)} WPM (${d.count} entries)`}
                style={{
                  flex: 1,
                  height: `${(d.avg_wpm / maxWpm) * 100}%`,
                  minHeight: 3,
                  background: 'var(--primary, #6366f1)',
                  borderRadius: '3px 3px 0 0',
                  opacity: 0.6 + 0.4 * (d.avg_wpm / maxWpm),
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Personal Bests */}
      {(data.highest_wpm || data.best_vocabulary_diversity || data.longest_entry) && (
        <div>
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>🏆 Personal Bests</h4>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {data.highest_wpm && (
              <div style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{Math.round(data.highest_wpm.wpm)} WPM</span>
                <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>fastest</span>
              </div>
            )}
            {data.best_vocabulary_diversity && (
              <div style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{Math.round(data.best_vocabulary_diversity.vocabulary_diversity * 100)}%</span>
                <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>best diversity</span>
              </div>
            )}
            {data.longest_entry && (
              <div style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{data.longest_entry.word_count} words</span>
                <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>longest</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

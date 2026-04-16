import { useState, useEffect } from 'react';
import { getSpeakingJournalProgress, getFillerWordAnalysis, type SpeakingJournalProgressResponse, type FillerAnalysisResponse } from '../../api';

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

function FillerWordTrends() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FillerAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    getFillerWordAnalysis()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, data]);

  const trendColors: Record<string, string> = {
    improving: '#22c55e',
    declining: '#ef4444',
    stable: '#eab308',
    insufficient_data: '#94a3b8',
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: 'var(--text-secondary)',
          padding: 0,
          fontWeight: 600,
        }}
      >
        {open ? '▾' : '▸'} 🗣️ Filler Word Trends
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {loading && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>}
          {data && data.total_entries === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No entries yet</div>
          )}
          {data && data.total_entries > 0 && (
            <>
              {/* Cleanliness score badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontWeight: 700,
                    fontSize: 16,
                    background: data.fluency_cleanliness_score >= 80 ? '#dcfce7' : data.fluency_cleanliness_score >= 50 ? '#fef9c3' : '#fee2e2',
                    color: data.fluency_cleanliness_score >= 80 ? '#166534' : data.fluency_cleanliness_score >= 50 ? '#854d0e' : '#991b1b',
                  }}
                >
                  {data.fluency_cleanliness_score}
                  <span style={{ fontSize: 11, fontWeight: 400 }}>/ 100 fluency</span>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: trendColors[data.trend_direction] || '#94a3b8',
                    fontWeight: 600,
                  }}
                >
                  {trendEmoji[data.trend_direction] || '📊'}{' '}
                  {trendLabel[data.trend_direction] || data.trend_direction}
                </span>
              </div>

              {/* Filler word pills */}
              {data.filler_breakdown.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {data.filler_breakdown.slice(0, 8).map((f) => (
                    <span
                      key={f.word}
                      style={{
                        fontSize: 12,
                        padding: '3px 10px',
                        borderRadius: 12,
                        background: 'var(--bg-secondary)',
                        fontWeight: 500,
                      }}
                    >
                      &ldquo;{f.word}&rdquo;{' '}
                      <span style={{ fontWeight: 700, color: 'var(--primary, #6366f1)' }}>{f.count}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Daily density mini chart */}
              {data.daily_trend.length > 1 && (() => {
                const maxDensity = Math.max(0.1, ...data.daily_trend.map((d) => d.density_per_min));
                return (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Fillers / min (last {data.daily_trend.length} days)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 32 }}>
                      {data.daily_trend.slice(-14).map((d) => (
                        <div
                          key={d.date}
                          title={`${d.date}: ${d.density_per_min.toFixed(1)}/min (${d.filler_count} fillers, ${d.entries} entries)`}
                          style={{
                            flex: 1,
                            height: `${(d.density_per_min / maxDensity) * 100}%`,
                            minHeight: 2,
                            background: d.density_per_min > maxDensity * 0.7 ? '#ef4444' : '#6366f1',
                            borderRadius: '2px 2px 0 0',
                            opacity: 0.7,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

      {/* Filler Word Trends */}
      <FillerWordTrends />

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
